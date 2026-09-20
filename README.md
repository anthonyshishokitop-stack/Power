# City of Tshwane – Smart Outage Management System

**Fully operational** production-style platform (not a localStorage demo).

- **Backend**: Node.js + Express + SQLite (better-sqlite3) + JWT auth + Socket.io real-time
- **Frontend**: Vanilla SPA (HTML/CSS/JS) with Leaflet maps and Chart.js
- **Data**: Persistent SQLite database with proper schema, history, notifications, audit log
- **Roles**: Admin, Dispatcher, Technician (role-based access control)

## What is operational

| Capability | Implementation |
|------------|----------------|
| Report outage | Authenticated API, validation, duplicate detection (geo + account) |
| Prioritise | Server-side priority score (severity + affected + age) |
| Dispatch / Assign | Manual + smart nearest-available matching with workload limits |
| Track | Real technician GPS location updates + live map |
| Status workflow | En Route → Nearby → On Site → In Progress → Resolved |
| Customer notify | Notification records + console/SMS-ready hook (Twilio-ready) |
| Close job | Work performed, free technician capacity |
| Analytics | Response/resolution times, status/severity/type breakdowns |
| Real-time | Socket.io broadcasts outage & location changes to all clients |
| Auth | JWT + bcrypt, role checks on every protected route |
| Audit | Status history + audit_log table |

## Quick start (local)

```bash
cd backend
npm install
npm start
```

Open **http://localhost:3000**

### Default logins

| Role | Email | Password |
|------|-------|----------|
| Dispatcher | dispatcher@tshwane.gov.za | Dispatch@123 |
| Admin | admin@tshwane.gov.za | Admin@123 |
| Technician | thabo.molefe@tshwane.gov.za | Tech@123 |

(Other technicians: lerato.nkosi@…, johan.vdberg@…, nomsa.dlamini@…, pieter.botha@… — same password `Tech@123`)

## Project structure

```
tshwane-outage-ops/
├── backend/
│   ├── server.js          # Express API + Socket.io
│   ├── db.js              # SQLite schema + seed
│   ├── package.json
│   └── data/              # Created at runtime (outages.db)
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js         # API client
│       └── app.js         # SPA router + views
└── README.md
```

## Deploy

### Option A – Single process (simplest)

1. `cd backend && npm install && npm start`
2. Put behind nginx / Caddy or deploy the whole folder to any Node host (Render, Railway, Fly.io, VPS).

### Option B – Split

- Frontend → GitHub Pages / Netlify / Cloudflare Pages (set `API` base URL in `api.js`)
- Backend → any Node host; set env:

```bash
PORT=3000
JWT_SECRET=your-long-random-secret
FRONTEND_ORIGIN=https://your-frontend-domain
DB_PATH=/data/outages.db
```

### Production checklist

- [ ] Change `JWT_SECRET`
- [ ] Restrict `FRONTEND_ORIGIN`
- [ ] Put SQLite on persistent volume (or migrate to PostgreSQL)
- [ ] Wire real SMS (Twilio) / email in `queueNotification()`
- [ ] Enable HTTPS
- [ ] Add rate limiting & backup strategy

## API overview

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | public | Login → JWT |
| GET | /api/outages | dispatcher, tech, admin | List (filtered) |
| POST | /api/outages | any auth | Create + dedupe |
| POST | /api/outages/:id/assign | dispatcher, admin | Assign tech |
| POST | /api/outages/:id/smart-assign | dispatcher, admin | Auto nearest |
| PATCH | /api/outages/:id/status | tech, dispatcher, admin | Status update + notify |
| PATCH | /api/technicians/me/location | technician | GPS update |
| GET | /api/technicians | dispatcher, admin, tech | Crew list |
| GET | /api/analytics/summary | dispatcher, admin | KPIs |

## Licence

Operational reference implementation for the City of Tshwane Energy & Electricity Supply challenge. Adapt for production use under municipal policy.
