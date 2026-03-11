#!/bin/bash
# Deploy worklog-dashboard. Run from project root: ./worklog-dashboard/deploy.sh
set -e
cd "$(dirname "$0")/.."
echo "Building worklog-dashboard..."
docker compose build worklog-dashboard --no-cache
echo "Running migrations..."
docker compose --profile migrate run --rm migrate-worklog 2>/dev/null || true
echo "Recreating container..."
docker compose up -d --force-recreate worklog-dashboard
echo "Done. Version: $(grep '"version"' worklog-dashboard/package.json | head -1)"