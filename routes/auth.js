const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const audit = require('../audit');

const router = express.Router();

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

function lockedRemaining(user) {
  if (!user.locked_until) return 0;
  const until = new Date(user.locked_until.replace(' ', 'T') + 'Z').getTime();
  const diff = until - Date.now();
  return diff > 0 ? Math.ceil(diff / 60000) : 0;
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username и password обязательны' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (user) {
    const remaining = lockedRemaining(user);
    if (remaining > 0) {
      audit.record(username, audit.EVENTS.LOGIN_FAILED, req, `Попытка входа в заблокированную учётную запись`);
      return res.status(423).json({ error: `Учётная запись заблокирована. Повторите через ${remaining} мин.` });
    }
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    if (user) {
      const attempts = user.failed_attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        const until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString().slice(0, 19).replace('T', ' ');
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, until, user.id);
        audit.record(username, audit.EVENTS.LOCKOUT, req, `Учётная запись заблокирована на ${LOCK_MINUTES} мин. после ${attempts} неудачных попыток`);
        return res.status(423).json({ error: `Учётная запись заблокирована на ${LOCK_MINUTES} мин. после ${MAX_ATTEMPTS} неудачных попыток.` });
      }
      db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, user.id);
      audit.record(username, audit.EVENTS.LOGIN_FAILED, req, `Неверный пароль (попытка ${attempts} из ${MAX_ATTEMPTS})`);
    } else {
      audit.record(username, audit.EVENTS.LOGIN_FAILED, req, 'Неизвестный пользователь');
    }
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };
  audit.record(username, audit.EVENTS.LOGIN, req, 'Успешный вход');
  res.json(req.session.user);
});

router.post('/logout', (req, res) => {
  const login = req.session.user && req.session.user.username;
  if (login) audit.record(login, audit.EVENTS.LOGOUT, req, 'Выход из системы');
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/register', (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }

  const pwError = audit.validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

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

router.post('/change-password', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) {
    return res.status(400).json({ error: 'Укажите текущий и новый пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || !bcrypt.compareSync(old_password, user.password_hash)) {
    return res.status(400).json({ error: 'Текущий пароль неверен' });
  }

  const pwError = audit.validatePassword(new_password);
  if (pwError) return res.status(400).json({ error: pwError });

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  audit.record(user.username, audit.EVENTS.PASSWORD_CHANGED, req, 'Пароль изменён пользователем');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  res.json(req.session.user);
});

module.exports = router;
