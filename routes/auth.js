const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username и password обязательны' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };
  res.json(req.session.user);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/register', (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  const isAdmin = req.session.user && req.session.user.role === 'admin';
  const finalRole = (isAdmin && ['admin', 'approver', 'user'].includes(role)) ? role : 'user';

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)'
    ).run(username, hash, full_name, finalRole);

    res.status(201).json({
      id: result.lastInsertRowid,
      username,
      full_name,
      role: finalRole
    });
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    throw e;
  }
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  res.json(req.session.user);
});

module.exports = router;
