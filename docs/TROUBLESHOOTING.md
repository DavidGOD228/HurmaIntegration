# Troubleshooting

## App container keeps restarting (`Restarting (1)`)

The app exits with code 1 on startup. **See the actual error** in one of these ways:

**Option A – run app in foreground (recommended):** you’ll see the error in the terminal.

```bash
cd /opt/hurma-recorder
docker compose run --rm app
```

Leave it running until it crashes; the last lines are the error. Then Ctrl+C.

**Option B – view logs (if the process wrote something before exiting):**

```bash
docker compose logs app 2>&1
# or
docker logs hurma-recorder-app-1 2>&1
```

### Common causes

**1. Invalid or missing env vars**

You’ll see something like:
```text
[config] Invalid environment configuration — fix .env and restart:
  HURMA_BASE_URL: Must be a valid URL
  FIREFLIES_API_KEY: Required
```

- Fix the listed variables in `/opt/hurma-recorder/.env`.
- Restart: `docker compose up -d --force-recreate app` or `docker compose restart app`.

**2. Database connection failed**

You’ll see:
```text
Cannot connect to database — aborting startup
```

- **Password mismatch:** `POSTGRES_PASSWORD` in `.env` must match the password the Postgres container was created with. If you changed it later, either:
  - Revert `.env` to the original password, or
  - Recreate the DB (data loss):  
    `docker compose down -v`  
    Set the new password in `.env`, then:  
    `docker compose --profile migrate run --rm migrate`  
    `docker compose up -d`
- **Host:** In Docker, the app must use hostname `postgres`, not `localhost`. The compose file sets `DATABASE_URL` for you; don’t override it in `.env` with `localhost`.

**3. Migrations not applied**

If the app starts but then crashes when handling requests, or logs show “relation X does not exist”, run migrations once:

```bash
docker compose --profile migrate run --rm migrate
docker compose restart app
```

---

## After fixing

1. Restart the app: `docker compose restart app`
2. Check: `docker compose ps` (app should be “Up”) and `curl http://localhost:3000/health`
