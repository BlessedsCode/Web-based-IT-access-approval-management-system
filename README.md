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
- **"My Approvals" panel** — pending queue with menu counter, quick filters (awaiting me / urgent / overdue) and bulk approval
- **Login audit** — audit log of logins, logouts, failed attempts, lockouts and password changes; account lockout for 15 min after 5 failed attempts; password complexity policy

## Run

Automated deployment (checks Node, installs deps, generates `.env`, initializes DB, starts and probes the server):
```
node deploy.js        # Windows / cross-platform
bash deploy.sh        # Linux / macOS
```

Or manually:
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
- `GET /api/requests/my-approvals` — pending queue (approver/admin)
- `GET /api/requests/count-pending` — pending counter (approver/admin)
- `POST /api/approval/bulk` — bulk approve selected requests (approver/admin)
- `POST /api/auth/change-password` — change own password (policy-checked)
- `GET /api/audit?event_type=&user=&from=&to=` — audit log (admin only)
- `GET /api/report` — aggregated stats

## Database
SQLite file `data.db` is created automatically on first run.
Default users are seeded if the table is empty.
`audit_log` stores login/security events; `users` carries `failed_attempts` and `locked_until` for lockout.

`node seed-demo.js` loads demonstration requests (used for screenshots; **replaces** existing request data).

## Screenshots
See `screenshots/` — deployment run, My Approvals panel, bulk approval, audit log, and account lockout.
