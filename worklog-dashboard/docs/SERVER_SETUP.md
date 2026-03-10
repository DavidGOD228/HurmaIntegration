# Server Setup — worklog-dashboard

Deploy the worklog dashboard on Hetzner at **https://worklog-dashboard.development-test.website**

---

## Prerequisites

- Hetzner VPS (Ubuntu 22.04 or 24.04) — same server that runs `hurma-recorder`
- Docker + Docker Compose already installed (from hurma-recorder setup)
- DNS: an **A record** for `worklog-dashboard.development-test.website` pointing to the server IP
- Git access to `https://github.com/DavidGOD228/worklog-dashboard`

---

## Step 1 — Clone the repo on the server

```bash
cd /opt
sudo git clone https://github.com/DavidGOD228/worklog-dashboard.git
cd /opt/worklog-dashboard
```

---

## Step 2 — Configure environment

```bash
sudo cp .env.example .env
sudo nano .env
```

Fill in all required values:

```env
PORT=3200
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=postgres://worklog_user:YOUR_STRONG_DB_PASSWORD@localhost:5433/worklog_dashboard
POSTGRES_PASSWORD=YOUR_STRONG_DB_PASSWORD

# Same Hurma token as hurma-recorder
HURMA_BASE_URL=https://bestwork.hurma.work
HURMA_API_TOKEN=<paste from hurma-recorder .env>
HURMA_HR_API_VERSION=v1

# Redmine (mirko project)
REDMINE_BASE_URL=https://project.mirko.in.ua
REDMINE_API_KEY=xbQWWeN0JAcjyXInwSgg

# Dashboard admin login — change this!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose_a_strong_password_here

DEFAULT_WORK_HOURS_PER_DAY=8
OK_DELTA_THRESHOLD_HOURS=0.5
DEFAULT_TIMEZONE=Europe/Kiev
```

---

## Step 3 — Start the database

```bash
cd /opt/worklog-dashboard
sudo docker compose up -d postgres
```

Wait a few seconds for it to become healthy:

```bash
sudo docker compose ps
```

---

## Step 4 — Run database migrations

```bash
sudo docker compose --profile migrate run --rm migrate
```

You should see:

```
  apply 001_initial_schema.sql ...
  done  001_initial_schema.sql
Migrations complete.
```

---

## Step 5 — Build and start the app

```bash
sudo docker compose up -d app
```

Verify it is running:

```bash
sudo docker compose ps
curl -I http://localhost:3200/health
# Expect: HTTP/1.1 200 OK
```

---

## Step 6 — Set up Nginx + HTTPS

Make sure the DNS A record for `worklog-dashboard.development-test.website` already resolves to your server before running this.

```bash
cd /opt/worklog-dashboard
chmod +x scripts/setup-webserver.sh
sudo ./scripts/setup-webserver.sh worklog-dashboard.development-test.website
```

This script:
- Installs Nginx + Certbot (if not already installed)
- Creates `/etc/nginx/sites-available/worklog-dashboard` with correct proxy config
- Runs `certbot --nginx` to get a free HTTPS cert from Let's Encrypt
- Reloads Nginx

After the script finishes:

```bash
curl -I https://worklog-dashboard.development-test.website/health
# Expect: HTTP/1.1 200 OK
```

Open in browser: **https://worklog-dashboard.development-test.website**  
Login: the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set in `.env`

---

## Step 7 — First sync

Once the app is running, do an initial data sync:

```bash
curl -X POST https://worklog-dashboard.development-test.website/api/sync/run \
  -H "Authorization: Basic $(echo -n 'admin:YOUR_ADMIN_PASSWORD' | base64)" \
  -H "Content-Type: application/json" \
  -d '{"type":"all","from":"2026-03-01","to":"2026-03-31"}'
```

Or just click **↻ Sync Now** in the sidebar after logging in.

---

## Updating to a new version

```bash
cd /opt/worklog-dashboard
sudo git pull origin main
sudo docker compose build
sudo docker compose --profile migrate run --rm migrate
sudo docker compose up -d app
```

---

## Ports used

| Port | Service | Binding |
|------|---------|---------|
| 3200 | worklog-dashboard app | `127.0.0.1:3200` (internal only) |
| 5433 | PostgreSQL | `127.0.0.1:5433` (internal only) |
| 80 / 443 | Nginx (public) | `0.0.0.0` |

Port 3200 does **not** conflict with hurma-recorder (port 3000) or mirko-redmine-app (port 3100).

---

## Nginx config (created by setup script)

Located at `/etc/nginx/sites-available/worklog-dashboard`:

```nginx
server {
    listen 80;
    server_name worklog-dashboard.development-test.website;

    location / {
        proxy_pass         http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_set_header   Authorization     $http_authorization;
    }
}
```

Certbot automatically adds the HTTPS block + redirect.

---

## Logs and monitoring

```bash
# App logs (live)
sudo docker compose logs -f app

# Postgres logs
sudo docker compose logs -f postgres

# Nginx access log
sudo tail -f /var/log/nginx/access.log

# Check sync run history
curl -s https://worklog-dashboard.development-test.website/api/sync/runs \
  -H "Authorization: Basic $(echo -n 'admin:YOUR_ADMIN_PASSWORD' | base64)" | jq .
```

---

## Restart after server reboot

Docker Compose services are set to `restart: unless-stopped`, so they start automatically after a reboot.

To confirm:

```bash
sudo docker compose ps
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **502 Bad Gateway** | App not running: `sudo docker compose up -d app` |
| **401 from /health** | `/health` is unauthenticated — if getting 401, check Nginx isn't adding auth headers |
| **Certbot fails** | DNS not propagated yet; wait and retry `sudo certbot --nginx -d worklog-dashboard.development-test.website` |
| **DB migration fails** | Check `DATABASE_URL` in `.env` matches the `docker-compose.yml` postgres service credentials |
| **Hurma 403 on /employees** | Your Hurma plan may not include the HR module API; try `HURMA_HR_API_VERSION=v3` or contact Hurma support |
| **Redmine users endpoint 403** | Redmine API key must be an **admin** key to list users; non-admin keys can only fetch time entries |
| **No data after sync** | Open Issues page in dashboard; check `GET /api/sync/runs` for error_message |
