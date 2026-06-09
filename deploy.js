#!/usr/bin/env node
/*
 * Автоматизация развёртывания «Веб-системы управления согласованием ИТ-доступов».
 * Запуск: node deploy.js
 * Шаги: проверка Node.js -> установка зависимостей -> .env -> каталог uploads ->
 *       инициализация БД и учётной записи администратора -> запуск сервера -> проверка доступности.
 */
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIN_NODE = 18;
const PORT = process.env.PORT || 3000;

function step(msg) { console.log('\n\x1b[36m==>\x1b[0m ' + msg); }
function ok(msg) { console.log('  \x1b[32m✓\x1b[0m ' + msg); }
function fail(msg) { console.error('  \x1b[31m✗\x1b[0m ' + msg); }

function checkNode() {
  step('Проверка версии Node.js');
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE) {
    fail(`Требуется Node.js >= ${MIN_NODE}, установлена ${process.version}`);
    process.exit(1);
  }
  ok(`Node.js ${process.version}`);
}

function installDeps() {
  step('Установка зависимостей (npm install)');
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  ok('Зависимости установлены');
}

function ensureEnv() {
  step('Генерация файла конфигурации .env');
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    ok('.env уже существует — пропускаем');
    return;
  }
  const secret = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(envPath, `PORT=${PORT}\nSESSION_SECRET=${secret}\n`);
  ok('.env создан');
}

function ensureUploads() {
  step('Создание каталога uploads/');
  const dir = path.join(ROOT, 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  ok('Каталог uploads/ готов');
}

function initDb() {
  step('Инициализация базы данных и учётной записи администратора');
  execSync('node -e "require(\'./db\')"', { cwd: ROOT, stdio: 'inherit' });
  ok('Таблицы созданы, администратор по умолчанию добавлен (admin / admin123)');
}

function waitForServer(retries, delay) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get({ host: 'localhost', port: PORT, path: '/login.html', timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => {
        if (left <= 0) return reject(new Error('Сервер не отвечает'));
        setTimeout(() => attempt(left - 1), delay);
      });
      req.on('timeout', () => req.destroy());
    };
    attempt(retries);
  });
}

async function startAndCheck() {
  step('Запуск сервера');
  const child = spawn('node', ['server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT } });
  child.on('exit', (code) => { if (code) process.exit(code); });

  try {
    const status = await waitForServer(15, 1000);
    ok(`Сервер доступен на http://localhost:${PORT} (HTTP ${status})`);
    console.log('\n\x1b[32mРазвёртывание завершено успешно.\x1b[0m Сервер работает (Ctrl+C для остановки).');
  } catch (e) {
    fail(e.message);
    child.kill();
    process.exit(1);
  }
}

(async () => {
  console.log('=== Развёртывание системы согласования ИТ-доступов ===');
  checkNode();
  installDeps();
  ensureEnv();
  ensureUploads();
  initDb();
  await startAndCheck();
})();
