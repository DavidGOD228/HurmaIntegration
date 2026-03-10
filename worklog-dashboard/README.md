# Worklog Dashboard

Internal management dashboard for comparing **expected work hours** (from Hurma) against **actual logged hours** (from Redmine).

Live at: **https://worklog-dashboard.development-test.website**  
Repo: **https://github.com/DavidGOD228/worklog-dashboard**

---

## Deploy on Server (Hetzner — same server as hurma-recorder)

> Full step-by-step guide: [docs/SERVER_SETUP.md](docs/SERVER_SETUP.md)

```bash
# 1. SSH into the server
ssh root@YOUR_SERVER_IP

# 2. Clone the repo
cd /opt
git clone https://github.com/DavidGOD228/worklog-dashboard.git
cd /opt/worklog-dashboard

# 3. Configure environment
cp .env.example .env
nano .env   # fill in HURMA_API_TOKEN, ADMIN_PASSWORD, POSTGRES_PASSWORD

# 4. Start DB + migrate
docker compose up -d postgres
docker compose --profile migrate run --rm migrate

# 5. Start the app
docker compose up -d app

# 6. Set up Nginx + HTTPS (DNS must already point to this server)
chmod +x scripts/setup-webserver.sh
sudo ./scripts/setup-webserver.sh worklog-dashboard.development-test.website
```

Done. Open **https://worklog-dashboard.development-test.website**

---

## Update to a new version

```bash
cd /opt/worklog-dashboard
git pull origin main
docker compose build
docker compose --profile migrate run --rm migrate
docker compose up -d app
```

---

## What This Dashboard Does

1. **Pulls employees** from Hurma HR module (v1 API) and syncs them to a local PostgreSQL database.
2. **Pulls absence/leave records** (sick leave, vacation, unpaid leave) from Hurma.
3. **Pulls time entries** from Redmine for all monitored employees.
4. **Calculates expected hours** per employee per day, accounting for weekends, public holidays, and approved leave.
5. **Detects contradictions** such as logging hours on a sick-leave day or missing logs on a normal working day.
6. **Shows a daily and monthly summary** so management can identify problems at a glance.
7. **Lets admins configure** which employees are monitored and which are excluded.

---

## Quick Start (Docker)

```bash
cd worklog-dashboard

# 1. Create your .env file
cp .env.example .env
# Edit .env — set HURMA_API_TOKEN, ADMIN_PASSWORD, etc.

# 2. Start PostgreSQL
docker compose up -d postgres

# 3. Run database migrations (one-time)
docker compose --profile migrate run --rm migrate

# 4. Start the app
docker compose up -d app

# 5. Open the dashboard
open http://localhost:3200
# Username: admin, Password: whatever you set in ADMIN_PASSWORD
```

---

## First Use

1. Open **Settings** → click **↻ Sync Now** to pull all employees from Hurma.
2. Set each employee's monitoring mode (**Included / Excluded / Ext. project**).
3. Any employee without a Redmine match appears in the **unmapped queue** at the top of Settings — enter their Redmine user ID manually.
4. Sync again (or wait for the next scheduled sync) to pull absences and time entries.
5. Navigate to **Daily** or **Monthly** to see the dashboard.

---

## How Employee Inclusion/Exclusion Works

Each employee has one of three monitoring modes:

| Mode | Behaviour |
|------|-----------|
| `included` | Shown in daily/monthly dashboards; contradictions detected |
| `excluded` | Hidden from dashboards; flagged if they still log time in Redmine |
| `ignored_fulltime_external_project` | Silently ignored; no contradiction checking |

**Default for new employees:** `excluded`. You must explicitly set `included` for each person you want monitored.

All settings are persisted in the `employee_monitoring_settings` database table.

---

## How Contradictions Are Calculated

The contradiction engine runs after every sync. It creates a record in the `contradictions` table for each finding:

| Type | Severity | Meaning |
|------|----------|---------|
| `LOGGED_ON_SICK_LEAVE` | HIGH | Employee has Redmine time entries on a Hurma sick-leave day |
| `LOGGED_ON_VACATION` | HIGH | Same for vacation |
| `LOGGED_ON_UNPAID_LEAVE` | HIGH | Same for unpaid leave |
| `LOGGED_ON_OTHER_LEAVE` | MEDIUM | Any other approved leave |
| `NO_LOG_ON_WORKING_DAY` | MEDIUM | Normal Mon-Fri day, no absences, zero Redmine hours |
| `PARTIAL_DAY_MISMATCH` | MEDIUM | Partial absence but logged hours diverge from expected by >1h |
| `HURMA_ONLY_NO_REDMINE_USER` | MEDIUM | Employee is monitored but has no Redmine user mapped |
| `EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY` | LOW | Excluded employee still logging hours in Redmine |
| `INCLUDED_BUT_NO_SYNCDATA` | LOW | Monitored, mapped, but zero time entries in range |

Contradictions can be manually resolved via the **Issues** page.

### Status values per day

| Status | Meaning |
|--------|---------|
| `OK` | Delta within ±`OK_DELTA_THRESHOLD_HOURS` (default 0.5h) |
| `UNDERLOGGED` | Logged less than expected by more than threshold |
| `OVERLOGGED` | Logged more than expected by more than threshold |
| `ON_LEAVE` | Full leave day, no hours expected or logged |
| `CONTRADICTION` | One or more active contradictions detected |
| `UNMAPPED` | Employee has no Redmine user mapping |
| `EXCLUDED` | Employee is excluded or on an external project |

---

## How Employee Mapping Works

Hurma employees are matched to Redmine users in this order:

1. **Saved mapping** — if `employees.redmine_user_id` is already set in DB, use it.
2. **Email match** — Hurma `email` compared to Redmine `mail` (case-insensitive).
3. **Name match** — `"firstname lastname"` compared (case-insensitive).
4. **Manual queue** — if no match found, a row is created in `employee_mapping_queue` (visible in Settings → unmapped banner).

Aggressive guessing is avoided — uncertain matches go to the queue for human review.

---

## How to Run Sync Manually

**Via UI:** Click the **↻ Sync Now** button in the sidebar.

**Via API:**
```bash
curl -X POST http://localhost:3200/api/sync/run \
  -H "Authorization: Basic $(echo -n 'admin:yourpassword' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"type":"all","from":"2026-03-01","to":"2026-03-31"}'
```

Types: `all` | `employees` | `absences` | `time_entries` | `summaries`

**Via Docker exec (migrations only):**
```bash
docker compose --profile migrate run --rm migrate
```

---

## Scheduled Syncs

| Schedule | Action |
|----------|--------|
| Daily at 06:00 | Full sync for current month |
| Every hour | Incremental sync for today only |

Schedules run inside the app container via `node-cron`. No external cron required.

---

## Hurma API Notes

The dashboard uses the **Hurma HR module** endpoints, which are different from the ATS/Recruitment endpoints used by the main `HurmaRecorder` service.

| What | Endpoint (v1) | Notes |
|------|--------------|-------|
| Employee list | `GET /api/v1/employees` | Paginated |
| Single employee | `GET /api/v1/employees/{id}` | |
| Absences | `GET /api/v1/absences?from=&to=` | Paginated |

**Verify these paths against your Hurma instance at https://swagger-ui.hurma.work/**

If your Hurma subscription exposes these under `/api/v3/` instead, set `HURMA_HR_API_VERSION=v3` in `.env`.

If `/api/v1/employees` returns 403 or 404, your plan may not include HR module API access. Check with Hurma support.

---

## Redmine API Notes

| What | Endpoint | Notes |
|------|----------|-------|
| User list | `GET /users.json` | Requires **admin** API key |
| Time entries | `GET /time_entries.json?user_id=X&from=Y&to=Z` | Standard; auto-paginated |
| Current user | `GET /my/account.json` | Used to validate key |

The API key `REDMINE_API_KEY` must belong to an **admin** account to fetch the full user list (`/users.json`). If it's a non-admin key, employee auto-mapping from Redmine will not work — you'll need to set `redmine_user_id` manually in Settings.

---

## Hetzner Deployment

### Prerequisites

- A Hetzner VPS with Docker + Docker Compose installed
- A domain or IP with port 80/443 accessible
- Nginx or Caddy as reverse proxy

### Steps

```bash
# On the server
git clone <your-repo>
cd HurmaRecorder/worklog-dashboard

cp .env.example .env
# Edit .env — set strong ADMIN_PASSWORD, correct API tokens, POSTGRES_PASSWORD

# Build and start
docker compose up -d postgres
docker compose --profile migrate run --rm migrate
docker compose up -d app
```

### Nginx reverse proxy snippet

```nginx
server {
    listen 443 ssl;
    server_name worklog.yourcompany.internal;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Caddy (simpler)

```
worklog.yourcompany.internal {
    reverse_proxy localhost:3200
}
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3200` | App port |
| `NODE_ENV` | No | `development` | `production` in prod |
| `LOG_LEVEL` | No | `info` | `debug`/`info`/`warn`/`error` |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `HURMA_BASE_URL` | **Yes** | — | Hurma instance URL |
| `HURMA_API_TOKEN` | **Yes** | — | Hurma Bearer token |
| `HURMA_HR_API_VERSION` | No | `v1` | `v1` or `v3` |
| `REDMINE_BASE_URL` | **Yes** | `https://project.mirko.in.ua` | Redmine URL |
| `REDMINE_API_KEY` | **Yes** | — | Redmine API key (admin) |
| `ADMIN_USERNAME` | No | `admin` | Dashboard login |
| `ADMIN_PASSWORD` | **Yes** | — | Dashboard password |
| `DEFAULT_WORK_HOURS_PER_DAY` | No | `8` | Expected hours per working day |
| `OK_DELTA_THRESHOLD_HOURS` | No | `0.5` | Delta tolerance for OK status |
| `DEFAULT_TIMEZONE` | No | `Europe/Kiev` | Timezone label |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/api/dashboard/daily` | Daily overview |
| `GET` | `/api/dashboard/monthly` | Monthly overview |
| `GET` | `/api/dashboard/employees/:id` | Employee details |
| `GET` | `/api/settings/employees` | All employees with settings |
| `PATCH` | `/api/settings/employees/:id` | Update monitoring settings |
| `POST` | `/api/sync/run` | Trigger manual sync |
| `GET` | `/api/sync/runs` | Sync history |
| `GET` | `/api/contradictions` | List contradictions |
| `PATCH` | `/api/contradictions/:id/resolve` | Resolve a contradiction |
| `GET` | `/api/mappings/unresolved` | Unmapped employees queue |
| `PATCH` | `/api/mappings/:id` | Confirm/reject a mapping |

---

## Database Schema

Tables created in `001_initial_schema.sql`:

- `employees` — Hurma + Redmine employee records with mapping
- `employee_monitoring_settings` — per-employee inclusion mode
- `absences` — Hurma leave records
- `time_entries` — Redmine time entries
- `daily_employee_summary` — computed daily status (expected/actual/delta/status)
- `contradictions` — detected conflicts
- `sync_runs` — sync history log
- `employee_mapping_queue` — unresolved employee matches
- `public_holidays` — Ukrainian public holidays (auto-seeded)
- `wld_schema_migrations` — migration tracker

---

## Future Extension Points

### Telegram reminders
The contradiction engine already writes structured records with severity levels. To add Telegram alerts:
1. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env`
2. After `detectContradictions()` in `sync.service.js`, call a new `notifyService.sendHighSeverityAlerts(from, to)` that queries `contradictions WHERE severity = 'HIGH' AND created_at > NOW() - interval '1 hour'` and formats a message.

### Work schedule per employee
Currently all employees default to 8h/day Mon-Fri. To support custom schedules:
1. Add a `work_schedules` table with day-of-week and hours.
2. Pass the schedule to `getDayExpectation()` instead of the flat `work_hours_per_day`.

### OAuth / SSO
Replace the Basic Auth middleware in `src/middleware/auth.js` with a JWT or session-based system using `passport.js` or a similar library.

### Redmine project filtering
The time entries sync currently fetches all projects. To restrict to specific projects, add `REDMINE_PROJECT_IDS=123,456` to `.env` and pass them to `syncTimeEntries()`.
