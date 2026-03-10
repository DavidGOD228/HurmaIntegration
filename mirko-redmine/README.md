# Mirko Redmine App

Separate Dockerized app that talks to the Redmine API at **https://project.mirko.in.ua/**.

## Run with Docker

```bash
cd mirko-redmine-app
cp .env.example .env
# Edit .env if needed (REDMINE_API_KEY is already set for Mirko)
docker compose up -d
```

App is available at **http://localhost:3100**.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/redmine/me` | Current Redmine user (validates API key) |
| GET | `/api/redmine/projects` | List projects (`?limit=&offset=`) |
| GET | `/api/redmine/issues` | List issues (`?project_id=&limit=&offset=&status_id=&tracker_id=`) |
| GET | `/api/redmine/issues/:id` | Get one issue (`?include=journals,attachments`) |
| POST | `/api/redmine/issues` | Create issue (body: Redmine issue object) |
| PATCH | `/api/redmine/issues/:id` | Update issue (body: fields to update) |

## Environment

| Variable | Required | Default |
|----------|----------|---------|
| `REDMINE_BASE_URL` | No | `https://project.mirko.in.ua` |
| `REDMINE_API_KEY` | Yes | — |
| `PORT` | No | `3100` |

## Run locally (no Docker)

```bash
cd mirko-redmine-app
npm install
cp .env.example .env
npm run dev
```
