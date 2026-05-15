# Web-based IT Access Approval Management System

Web application for submitting and approving IT access requests.

## Stack
- Node.js + Express
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS
- Auth: express-session + bcrypt

## Features
- Three roles: user, approver, admin
- Request lifecycle: новая → на_согласовании → согласована/отклонена/требуется_уточнение → выполнена → закрыта
- File attachments per request
- Comments and full change history
- Server-side status transition validation
- Built-in summary report

## Run
```
npm install
node server.js
```

Open http://localhost:3000

## Default accounts
| Login | Password | Role |
|-------|----------|------|
| admin | admin123 | admin |
| approver | approver123 | approver |
| user | user123 | user |

## API
- `POST /api/auth/login` / `POST /api/auth/logout` / `POST /api/auth/register` / `GET /api/auth/me`
- `GET /api/requests?status=&priority=&search=` — list (user sees only own)
- `POST /api/requests` — create
- `GET /api/requests/:id` — full detail (info + comments + files + history + steps)
- `PATCH /api/requests/:id/status` — change status (validated)
- `DELETE /api/requests/:id` — admin only
- `POST /api/requests/:id/approve` — approver/admin
- `POST /api/requests/:id/reject` — approver/admin (comment required)
- `POST /api/requests/:id/comment`
- `POST /api/requests/:id/files` — multipart
- `GET /api/requests/:id/files/:fid` — download
- `GET /api/report` — aggregated stats

## Database
SQLite file `data.db` is created automatically on first run.
Default users are seeded if the table is empty.
