#!/usr/bin/env bash
# Автоматизация развёртывания «Веб-системы управления согласованием ИТ-доступов» (Linux/macOS).
# Запуск: bash deploy.sh
set -e

MIN_NODE=18
PORT="${PORT:-3000}"
cd "$(dirname "$0")"

echo "=== Развёртывание системы согласования ИТ-доступов ==="

echo ""
echo "==> Проверка версии Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js не установлен"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  echo "  ✗ Требуется Node.js >= $MIN_NODE, установлена $(node -v)"
  exit 1
fi
echo "  ✓ Node.js $(node -v)"

echo ""
echo "==> Установка зависимостей (npm install)"
npm install
echo "  ✓ Зависимости установлены"

echo ""
echo "==> Генерация файла конфигурации .env"
if [ -f .env ]; then
  echo "  ✓ .env уже существует — пропускаем"
else
  SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  printf "PORT=%s\nSESSION_SECRET=%s\n" "$PORT" "$SECRET" > .env
  echo "  ✓ .env создан"
fi

echo ""
echo "==> Создание каталога uploads/"
mkdir -p uploads
echo "  ✓ Каталог uploads/ готов"

echo ""
echo "==> Инициализация базы данных и учётной записи администратора"
node -e "require('./db')"
echo "  ✓ Таблицы созданы, администратор по умолчанию добавлен (admin / admin123)"

echo ""
echo "==> Запуск сервера"
node server.js &
SERVER_PID=$!

echo "  ... ожидание готовности сервера"
for i in $(seq 1 15); do
  if curl -sf "http://localhost:$PORT/login.html" >/dev/null 2>&1; then
    echo "  ✓ Сервер доступен на http://localhost:$PORT"
    echo ""
    echo "Развёртывание завершено успешно. Сервер работает (PID $SERVER_PID, Ctrl+C для остановки)."
    wait $SERVER_PID
    exit 0
  fi
  sleep 1
done

echo "  ✗ Сервер не отвечает"
kill $SERVER_PID 2>/dev/null || true
exit 1
