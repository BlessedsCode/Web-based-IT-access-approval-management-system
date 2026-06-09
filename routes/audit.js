const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав' });
  next();
}

router.get('/', requireAdmin, (req, res) => {
  const { event_type, user, from, to } = req.query;
  const conds = [];
  const params = [];

  if (event_type) { conds.push('event_type = ?'); params.push(event_type); }
  if (user) { conds.push('user_login LIKE ?'); params.push(`%${user}%`); }
  if (from) { conds.push('created_at >= ?'); params.push(from + ' 00:00:00'); }
  if (to) { conds.push('created_at <= ?'); params.push(to + ' 23:59:59'); }

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT id, user_login, event_type, ip_address, created_at, details
    FROM audit_log ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT 500
  `).all(...params);

  res.json(rows);
});

module.exports = router;
