const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    next();
  };
}

router.use(requireAuth);

router.post('/requests/:id/approve', requireRole('approver', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const { comment } = req.body || {};

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  if (row.status !== 'на_согласовании') {
    return res.status(400).json({ error: 'Заявка не на согласовании' });
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE requests SET status = 'согласована', updated_at = datetime('now') WHERE id = ?").run(id);
    const order = db.prepare('SELECT COALESCE(MAX(order_index),0) AS m FROM approval_steps WHERE request_id = ?').get(id).m + 1;
    db.prepare(`
      INSERT INTO approval_steps (request_id, approver_id, order_index, status, comment, decided_at)
      VALUES (?,?,?,?,?, datetime('now'))
    `).run(id, req.session.user.id, order, 'approved', comment || null);
    db.prepare(`
      INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
      VALUES (?,?,?,?,?)
    `).run(id, req.session.user.id, row.status, 'согласована', comment || 'Согласовано');
  });
  tx();

  res.json({ ok: true });
});

router.post('/requests/:id/reject', requireRole('approver', 'admin'), (req, res) => {
  const id = Number(req.params.id);
  const { comment } = req.body || {};

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  if (row.status !== 'на_согласовании') {
    return res.status(400).json({ error: 'Заявка не на согласовании' });
  }

  if (!comment || !comment.trim()) {
    return res.status(400).json({ error: 'Укажите причину отклонения' });
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE requests SET status = 'отклонена', updated_at = datetime('now') WHERE id = ?").run(id);
    const order = db.prepare('SELECT COALESCE(MAX(order_index),0) AS m FROM approval_steps WHERE request_id = ?').get(id).m + 1;
    db.prepare(`
      INSERT INTO approval_steps (request_id, approver_id, order_index, status, comment, decided_at)
      VALUES (?,?,?,?,?, datetime('now'))
    `).run(id, req.session.user.id, order, 'rejected', comment.trim());
    db.prepare(`
      INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
      VALUES (?,?,?,?,?)
    `).run(id, req.session.user.id, row.status, 'отклонена', comment.trim());
  });
  tx();

  res.json({ ok: true });
});

router.post('/approval/bulk', requireRole('approver', 'admin'), (req, res) => {
  const { ids, comment } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'Не выбрано ни одной заявки' });
  }

  let approved = 0;
  const skipped = [];

  const tx = db.transaction(() => {
    for (const rawId of ids) {
      const id = Number(rawId);
      const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
      if (!row || row.status !== 'на_согласовании') {
        skipped.push(rawId);
        continue;
      }
      db.prepare("UPDATE requests SET status = 'согласована', updated_at = datetime('now') WHERE id = ?").run(id);
      const order = db.prepare('SELECT COALESCE(MAX(order_index),0) AS m FROM approval_steps WHERE request_id = ?').get(id).m + 1;
      db.prepare(`
        INSERT INTO approval_steps (request_id, approver_id, order_index, status, comment, decided_at)
        VALUES (?,?,?,?,?, datetime('now'))
      `).run(id, req.session.user.id, order, 'approved', comment || 'Массовое согласование');
      db.prepare(`
        INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
        VALUES (?,?,?,?,?)
      `).run(id, req.session.user.id, row.status, 'согласована', comment || 'Массовое согласование');
      approved++;
    }
  });
  tx();

  res.json({ approved, skipped });
});

router.get('/report', requireRole('approver', 'admin'), (req, res) => {
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS count FROM requests GROUP BY status
  `).all();

  const byPriority = db.prepare(`
    SELECT priority, COUNT(*) AS count FROM requests GROUP BY priority
  `).all();

  const byDepartment = db.prepare(`
    SELECT department, COUNT(*) AS count FROM requests GROUP BY department ORDER BY count DESC
  `).all();

  const total = db.prepare('SELECT COUNT(*) AS c FROM requests').get().c;

  const recent = db.prepare(`
    SELECT r.id, r.number, r.status, r.created_at, u.full_name AS applicant_name
    FROM requests r JOIN users u ON u.id = r.applicant_id
    ORDER BY r.created_at DESC LIMIT 10
  `).all();

  res.json({ total, by_status: byStatus, by_priority: byPriority, by_department: byDepartment, recent });
});

module.exports = router;
