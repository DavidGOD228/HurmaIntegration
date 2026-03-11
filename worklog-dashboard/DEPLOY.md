# Worklog Dashboard — Deploy & Update

## Quick deploy (on server)

```bash
cd /opt/hurma-recorder
git pull
./worklog-dashboard/deploy.sh
```

Or manually:

```bash
cd /opt/hurma-recorder
git pull
docker compose build worklog-dashboard --no-cache
docker compose --profile migrate run --rm migrate-worklog   # if new migrations
docker compose up -d --force-recreate worklog-dashboard
```

## Bump version before deploy

Edit `package.json` and change `"version": "1.0.1"` to e.g. `"1.0.2"`.

Or use npm:

```bash
cd worklog-dashboard
npm run version:patch   # 1.0.1 → 1.0.2
# or
npm run version:minor   # 1.0.1 → 1.1.0
```

## Full deploy checklist

1. **Local:** Bump version in `worklog-dashboard/package.json`
2. **Local:** Commit & push (if using git)
3. **Server:** SSH in and run the Quick deploy commands above
4. **Verify:** Open the app — version shows next to Sync button (e.g. v1.0.2)

## Server path

- Project: `/opt/hurma-recorder`
- URL: `https://worklog-dashboard.development-test.website`
