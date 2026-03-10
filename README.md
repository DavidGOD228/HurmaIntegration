# HurmaRecorder — Monorepo

Internal tooling for Hurma ↔ Fireflies ↔ Redmine integrations.  
All services run from **one `docker compose up`** command.

---

## Services

| Service | Port | Domain | Description |
|---------|------|--------|-------------|
| `hurma-recorder` | 3000 | [hurmarecorder.development-test.website](https://hurmarecorder.development-test.website) | Fireflies → Hurma integration + Chrome extension backend |
| `worklog-dashboard` | 3200 | [worklog-dashboard.development-test.website](https://worklog-dashboard.development-test.website) | Worklog & attendance dashboard (Hurma vs Redmine) |
| `mirko-redmine` | 3100 | internal | Redmine REST API proxy for project.mirko.in.ua |
| `postgres` | 5432 | internal | Shared PostgreSQL (two databases) |

---

## Project Structure

```
/
├── docker-compose.yml          ← run everything from here
├── .env.example                ← copy to .env and fill in values
├── postgres/
│   └── init.sql                ← creates all databases on first start
├── hurma-recorder/             ← Fireflies→Hurma service
│   ├── Dockerfile
│   ├── src/
│   ├── scripts/                ← Nginx setup script
│   └── docs/
├── worklog-dashboard/          ← Worklog dashboard (React + Node)
│   ├── Dockerfile
│   ├── frontend/               ← React + Tailwind SPA
│   ├── src/
│   └── docs/
├── mirko-redmine/              ← Redmine API proxy
│   ├── Dockerfile
│   └── src/
└── extension/                  ← Chrome extension (MV3)
```

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/DavidGOD228/HurmaIntegration.git
cd HurmaIntegration
cp .env.example .env
nano .env   # fill in all required values
```

### 2. Start everything

```bash
# Start shared database
docker compose up -d postgres

# Run DB migrations (first time only)
docker compose --profile migrate run --rm migrate-hurma-recorder
docker compose --profile migrate run --rm migrate-worklog

# Start all services
docker compose up -d
```

### 3. Verify

```bash
docker compose ps
curl http://localhost:3000/health    # hurma-recorder
curl http://localhost:3200/health    # worklog-dashboard
curl http://localhost:3100/health    # mirko-redmine
```

---

## Deploy on Hetzner

### Prerequisites
- Ubuntu VPS with Docker + Docker Compose installed
- DNS A records pointing to the server:
  - `hurmarecorder.development-test.website` → server IP
  - `worklog-dashboard.development-test.website` → server IP

### Steps

```bash
# On the server
git clone https://github.com/DavidGOD228/HurmaIntegration.git /opt/hurma
cd /opt/hurma

cp .env.example .env && nano .env

docker compose up -d postgres
docker compose --profile migrate run --rm migrate-hurma-recorder
docker compose --profile migrate run --rm migrate-worklog
docker compose up -d

# Set up Nginx + HTTPS for each subdomain
chmod +x hurma-recorder/scripts/setup-webserver.sh
sudo ./hurma-recorder/scripts/setup-webserver.sh hurmarecorder.development-test.website

chmod +x worklog-dashboard/scripts/setup-webserver.sh
sudo ./worklog-dashboard/scripts/setup-webserver.sh worklog-dashboard.development-test.website
```

---

## Update

```bash
cd /opt/hurma
git pull origin main
docker compose build
docker compose --profile migrate run --rm migrate-hurma-recorder
docker compose --profile migrate run --rm migrate-worklog
docker compose up -d
```

---

## Per-service docs

- [hurma-recorder/README.md](hurma-recorder/README.md)
- [worklog-dashboard/README.md](worklog-dashboard/README.md)
- [hurma-recorder/docs/WEB_SERVER_SETUP.md](hurma-recorder/docs/WEB_SERVER_SETUP.md)
- [worklog-dashboard/docs/SERVER_SETUP.md](worklog-dashboard/docs/SERVER_SETUP.md)
