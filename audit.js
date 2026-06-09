const db = require('./db');

const insertEvent = db.prepare(`
  INSERT INTO audit_log (user_login, event_type, ip_address, details)
  VALUES (?,?,?,?)
`);

// Типы событий аудита входа.
const EVENTS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  LOCKOUT: 'lockout',
  PASSWORD_CHANGED: 'password_changed'
};

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}

function record(login, eventType, req, details) {
  insertEvent.run(login || null, eventType, clientIp(req), details || null);
}

// Сложность пароля: минимум 8 символов, есть буква и цифра.
function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Пароль должен содержать не менее 8 символов';
  }
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) {
    return 'Пароль должен содержать буквы и цифры';
  }
  return null;
}

module.exports = { record, validatePassword, clientIp, EVENTS };
