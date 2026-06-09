const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (req, file, cb) => {
      const safe = Date.now() + '_' + file.originalname.replace(/[^\w.\-А-Яа-я]/g, '_');
      cb(null, safe);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const TRANSITIONS = {
  'новая': ['на_согласовании'],
  'на_согласовании': ['согласована', 'отклонена', 'требуется_уточнение'],
  'требуется_уточнение': ['на_согласовании'],
  'согласована': ['выполнена'],
  'выполнена': ['закрыта'],
  'отклонена': ['закрыта'],
  'закрыта': []
};

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

function generateNumber() {
  const year = new Date().getFullYear();
  const count = db.prepare("SELECT COUNT(*) AS c FROM requests WHERE number LIKE ?").get(`REQ-${year}-%`).c;
  return `REQ-${year}-${String(count + 1).padStart(4, '0')}`;
}

router.use(requireAuth);

router.get('/', (req, res) => {
  const { status, priority, search } = req.query;
  const user = req.session.user;

  const conds = [];
  const params = [];

  if (user.role === 'user') {
    conds.push('r.applicant_id = ?');
    params.push(user.id);
  }
  if (status) {
    conds.push('r.status = ?');
    params.push(status);
  }
  if (priority) {
    conds.push('r.priority = ?');
    params.push(priority);
  }
  if (search) {
    conds.push('(r.number LIKE ? OR r.resource LIKE ? OR r.department LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT r.*, u.full_name AS applicant_name
    FROM requests r
    JOIN users u ON u.id = r.applicant_id
    ${where}
    ORDER BY r.created_at DESC
  `).all(...params);

  res.json(rows);
});

router.post('/', (req, res) => {
  const { department, resource, access_type, justification, priority, valid_until } = req.body || {};
  if (!department || !resource || !access_type || !justification) {
    return res.status(400).json({ error: 'Заполните обязательные поля' });
  }

  const number = generateNumber();
  const result = db.prepare(`
    INSERT INTO requests (number, applicant_id, department, resource, access_type, justification, priority, valid_until)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(number, req.session.user.id, department, resource, access_type, justification, priority || 'normal', valid_until || null);

  db.prepare(`
    INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
    VALUES (?,?,?,?,?)
  `).run(result.lastInsertRowid, req.session.user.id, null, 'новая', 'Заявка создана');

  res.status(201).json({ id: result.lastInsertRowid, number });
});

// «Мои согласования»: заявки, ожидающие решения согласующего.
router.get('/my-approvals', requireRole('approver', 'admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.full_name AS applicant_name
    FROM requests r JOIN users u ON u.id = r.applicant_id
    WHERE r.status = 'на_согласовании'
    ORDER BY
      CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      r.created_at ASC
  `).all();
  res.json(rows);
});

// Счётчик ожидающих заявок для пункта меню.
router.get('/count-pending', requireRole('approver', 'admin'), (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS c FROM requests WHERE status = 'на_согласовании'").get().c;
  res.json({ count });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = req.session.user;

  const row = db.prepare(`
    SELECT r.*, u.full_name AS applicant_name, u.username AS applicant_username
    FROM requests r JOIN users u ON u.id = r.applicant_id
    WHERE r.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  if (user.role === 'user' && row.applicant_id !== user.id) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  const comments = db.prepare(`
    SELECT c.*, u.full_name AS author_name
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.request_id = ? ORDER BY c.created_at
  `).all(id);

  const files = db.prepare('SELECT id, filename, size, uploaded_at FROM files WHERE request_id = ?').all(id);

  const history = db.prepare(`
    SELECT h.*, u.full_name AS changed_by_name
    FROM history h JOIN users u ON u.id = h.changed_by
    WHERE h.request_id = ? ORDER BY h.changed_at
  `).all(id);

  const steps = db.prepare(`
    SELECT s.*, u.full_name AS approver_name
    FROM approval_steps s JOIN users u ON u.id = s.approver_id
    WHERE s.request_id = ? ORDER BY s.order_index
  `).all(id);

  res.json({ ...row, comments, files, history, approval_steps: steps });
});

router.patch('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status: newStatus, comment } = req.body || {};
  const user = req.session.user;

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  const allowed = TRANSITIONS[row.status] || [];
  if (!allowed.includes(newStatus)) {
    return res.status(400).json({ error: `Недопустимый переход: ${row.status} → ${newStatus}` });
  }

  if (user.role === 'user') {
    const userAllowed = (row.status === 'новая' && newStatus === 'на_согласовании')
      || (row.status === 'требуется_уточнение' && newStatus === 'на_согласовании');
    if (!userAllowed || row.applicant_id !== user.id) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
  }

  const tx = db.transaction(() => {
    db.prepare("UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, id);
    db.prepare(`
      INSERT INTO history (request_id, changed_by, old_status, new_status, comment)
      VALUES (?,?,?,?,?)
    `).run(id, user.id, row.status, newStatus, comment || null);
  });
  tx();

  res.json({ ok: true, status: newStatus });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare('DELETE FROM requests WHERE id = ?').run(id);
  if (!result.changes) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ ok: true });
});

router.post('/:id/files', upload.single('file'), (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Файл не передан' });

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  if (!row) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Заявка не найдена' });
  }

  const result = db.prepare(`
    INSERT INTO files (request_id, filename, filepath, size) VALUES (?,?,?,?)
  `).run(id, req.file.originalname, req.file.filename, req.file.size);

  res.status(201).json({ id: result.lastInsertRowid, filename: req.file.originalname, size: req.file.size });
});

router.get('/:id/files/:fid', (req, res) => {
  const fid = Number(req.params.fid);
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND request_id = ?').get(fid, Number(req.params.id));
  if (!file) return res.status(404).json({ error: 'Файл не найден' });

  const fullPath = path.join(__dirname, '..', 'uploads', file.filepath);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Файл отсутствует на диске' });

  res.download(fullPath, file.filename);
});

router.post('/:id/comment', (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Пустой комментарий' });

  const row = db.prepare('SELECT id FROM requests WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });

  const result = db.prepare(`
    INSERT INTO comments (request_id, author_id, text) VALUES (?,?,?)
  `).run(id, req.session.user.id, text.trim());

  res.status(201).json({ id: result.lastInsertRowid });
});

module.exports = router;
