# HurmaRecorder

**Fireflies.ai → Hurma Recruitment integration service.**

Automatically pushes Fireflies interview transcripts, AI summaries, and action items into the correct candidate record in Hurma Recruitment after every recorded call.

---

## Table of Contents

1. [What this service does](#what-this-service-does)
2. [Architecture](#architecture)
3. [Hurma API endpoints used](#hurma-api-endpoints-used)
4. [Candidate matching logic](#candidate-matching-logic)
5. [Required Hurma calendar metadata format](#required-hurma-calendar-metadata-format)
6. [Fireflies webhook setup](#fireflies-webhook-setup)
7. [Environment variables](#environment-variables)
8. [Local development](#local-development)
9. [Docker deployment (local)](#docker-deployment-local)
10. [Hetzner deployment](#hetzner-deployment)
11. [curl test examples](#curl-test-examples)
12. [Example webhook payload](#example-fireflies-webhook-payload)
13. [Example Hurma note](#example-hurma-note-created)
14. [Retry and failure behavior](#retry-and-failure-behavior)
15. [Security and GDPR](#security-and-gdpr)
16. [Known limitations](#known-limitations)
17. [TODO / future versions](#todo--future-versions)

---

## What this service does

1. Receives a POST webhook from Fireflies when a meeting transcription is complete.
2. Verifies the HMAC-SHA256 signature using `x-hub-signature`.
3. Persists the raw webhook payload in PostgreSQL.
4. Fetches full transcript details (summary, action items, URLs) from the Fireflies GraphQL API.
5. Extracts the Hurma candidate ID from meeting metadata (`HURMA_CANDIDATE_ID=<id>` in description).
6. Creates a formatted comment on the matching Hurma candidate record via `POST /api/v3/candidates/{id}/comments`.
7. Handles retries with exponential backoff for transient failures.
8. Queues unresolved meetings for manual review.

---

## Architecture

```
Fireflies.ai
    │  POST /webhooks/fireflies
    ▼
[Rate Limiter]
[Raw Body Capture]        ← required for HMAC verification
[Signature Verify]        ← 403 if invalid
[Payload Validate]        ← Zod schema
[Persist Webhook to DB]   ← always before 200
    │
    └─ 200 OK (async)
         │
    [Fireflies GraphQL]   ← fetch transcript detail
         │
    [Matching Service]    ← resolve Hurma candidate ID
         │
    [Hurma API Client]    ← POST /api/v3/candidates/{id}/comments
         │
    [PostgreSQL]          ← store result, idempotency check
         │
    [Retry Poller]        ← re-runs failures with exponential backoff
```

### File structure

```
src/
├── app.js                          Express app factory
├── server.js                       Entry point, server + retry poller
├── config/index.js                 Env var validation (Zod)
├── utils/
│   ├── logger.js                   Pino structured logger
│   ├── signature.js                HMAC-SHA256 verification
│   ├── regex.js                    Candidate ID extraction patterns
│   └── idempotency.js              Content hash helpers
├── db/
│   ├── index.js                    pg Pool wrapper
│   ├── migrate.js                  Migration runner
│   ├── migrations/
│   │   └── 001_create_tables.sql
│   └── queries/
│       ├── webhooks.js
│       ├── meetings.js
│       ├── transcripts.js
│       ├── retries.js
│       ├── hurmaNote.js
│       ├── candidateLinks.js
│       └── manualReview.js
├── middleware/
│   ├── rawBody.js                  Capture raw body for HMAC
│   ├── rateLimit.js                express-rate-limit config
│   └── errorHandler.js             Centralized error handler
├── services/
│   ├── fireflies.service.js        Fireflies GraphQL client
│   ├── hurma.service.js            Hurma REST API client
│   ├── matching.service.js         Candidate resolution logic
│   ├── processing.service.js       Main orchestration
│   └── retry.service.js            Exponential backoff retry poller
├── controllers/
│   └── fireflies.controller.js     Webhook entry point
└── routes/
    └── webhooks.js
```

---

## Hurma API endpoints used

Discovered from **https://swagger-ui.hurma.work/** (Public API v3).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/v3/candidates/{id}` | Verify candidate exists before posting |
| `GET` | `/api/v3/candidates?filter[email]=...` | Email fallback candidate lookup |
| `POST` | `/api/v3/candidates/{id}/comments` | **Create interview note** |

**Authentication:** `Authorization: Bearer <HURMA_API_TOKEN>` on every request.

**Request body for comment creation:**
```json
{ "comment": "Interview synced automatically from Fireflies\n\n..." }
```

**Response:**
```json
{ "id": 42 }
```

> **Note:** All endpoints require an ATS PRO subscription in Hurma.

> **Note:** Hurma candidate IDs are alphanumeric encoded strings (e.g., `"Je"`), not plain integers.
> The `HURMA_CANDIDATE_ID` you embed in calendar descriptions must match this exact encoded format
> as shown in the Hurma Recruitment UI URL (e.g., `hurma.work/recruitment/candidates/Je`).

---

## Candidate matching logic

The service tries to resolve the Hurma candidate ID in this exact priority order:

| Priority | Method | Source |
|----------|--------|--------|
| 1 | `HURMA_CANDIDATE_ID=<id>` regex in meeting description | Fireflies webhook metadata |
| 2 | `CID:<id>` regex in meeting title | Fireflies transcript title |
| 3 | `clientReferenceId` from Fireflies webhook payload | Webhook body |
| 4 | `candidate_links` table lookup by attendee email | PostgreSQL |
| 5 | Hurma `/api/v3/candidates?filter[email]=` search | Hurma API (expensive) |
| 6 | **Manual review** | `manual_review_queue` table |

---

## Required Hurma calendar metadata format

When creating an interview in Hurma Recruitment, include the following in the **meeting description** field:

```
Intro call with Mirko Solutions
Candidate: Ivanna Bober
Vacancy: Lawyer
HURMA_CANDIDATE_ID=Je
```

Optionally also in the **meeting title** for redundancy:
```
Intro call | Ivanna Bober | CID:Je
```

> **Important:** The candidate ID value (e.g., `Je`) must match the alphanumeric ID shown in the Hurma UI URL for that candidate. Example: if the URL is `https://yourcompany.hurma.work/recruitment/candidates/Je`, the ID is `Je`.

This description is embedded into the Google Calendar event, which Fireflies reads and includes in the transcript metadata. The integration then extracts the ID using:
- Primary regex: `/HURMA_CANDIDATE_ID=([a-zA-Z0-9]+)/i`
- Fallback regex: `/CID:([a-zA-Z0-9]+)/i`

---

## Fireflies webhook setup

1. Log in to [Fireflies.ai](https://app.fireflies.ai)
2. Go to **Integrations → Apps → Webhooks**
3. Create a new webhook:
   - **URL:** `https://your-server.example.com/webhooks/fireflies`
   - **Events:** `Transcription complete`
   - **Secret:** choose a strong random string → set as `FIREFLIES_WEBHOOK_SECRET` in `.env`
4. Save and test using the Fireflies test button or the curl example below.

---

## Environment variables

Copy `.env.example` to `.env` and fill in all values:

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default `3000`) |
| `NODE_ENV` | No | `production` or `development` |
| `LOG_LEVEL` | No | `info`, `debug`, `warn`, etc. |
| `DATABASE_URL` | **Yes** | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | Yes (docker) | Used by docker-compose only |
| `FIREFLIES_API_KEY` | **Yes** | From Fireflies → API settings |
| `FIREFLIES_WEBHOOK_SECRET` | **Yes** | Shared secret for webhook HMAC |
| `HURMA_BASE_URL` | **Yes** | Your Hurma tenant URL, e.g. `https://yourcompany.hurma.work` |
| `HURMA_API_TOKEN` | **Yes** | Hurma OAuth2 Bearer access token |
| `DEFAULT_TIMEZONE` | No | Default `UTC` |
| `APP_BASE_URL` | No | Public URL of this service |

---

## Local development

### Prerequisites

- Node.js v20+
- PostgreSQL 14+ running locally

```bash
# 1. Clone and install
git clone <repo-url>
cd HurmaRecorder
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your real values

# 3. Run database migrations
npm run migrate

# 4. Start in dev mode (auto-restart on file change)
npm run dev
```

The service will be available at `http://localhost:3000`.

---

## Docker deployment (local)

```bash
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f app

# Run migrations manually if needed
docker compose run --rm migrate

# Stop all services
docker compose down

# Stop and remove volumes (wipes database!)
docker compose down -v
```

---

## Hetzner deployment

### 1. Provision a server

Create a Hetzner Cloud CX21 or larger (Ubuntu 24.04 LTS recommended).

### 2. Install Docker

```bash
ssh root@<your-server-ip>

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin
```

### 3. Deploy the application

```bash
# Clone the repo
git clone <repo-url> /opt/hurma-recorder
cd /opt/hurma-recorder

# Configure environment
cp .env.example .env
nano .env   # fill in all production values

# Start services (includes auto migration)
docker compose up --build -d

# Verify health
curl http://localhost:3000/health
```

### 4. Set up Nginx reverse proxy

```bash
apt-get install -y nginx certbot python3-certbot-nginx

# Create Nginx config
cat > /etc/nginx/sites-available/hurma-recorder << 'EOF'
server {
    listen 80;
    server_name your-server.example.com;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF

ln -s /etc/nginx/sites-available/hurma-recorder /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Issue TLS certificate
certbot --nginx -d your-server.example.com
```

### 5. Firewall

```bash
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
# Port 3000 is NOT opened externally — Nginx proxies to it
```

### 6. PostgreSQL backup

```bash
# Manual backup
docker exec $(docker compose ps -q postgres) \
  pg_dump -U hurma_recorder hurma_recorder \
  > /opt/backups/hurma_recorder_$(date +%Y%m%d_%H%M%S).sql

# Automated daily backup via cron
echo "0 3 * * * root docker exec \$(docker compose -f /opt/hurma-recorder/docker-compose.yml ps -q postgres) pg_dump -U hurma_recorder hurma_recorder > /opt/backups/hurma_\$(date +\%Y\%m\%d).sql" > /etc/cron.d/hurma-backup
```

---

## curl test examples

### 1. Health check
```bash
curl http://localhost:3000/health
```

### 2. Valid webhook with HURMA_CANDIDATE_ID in description

```bash
# Generate valid HMAC signature
SECRET="your_fireflies_webhook_secret_here"
PAYLOAD='{"eventType":"Transcription complete","meetingId":"meet_abc123","transcriptId":"tr_xyz789","description":"Intro call with Mirko Solutions\nCandidate: Ivanna Bober\nHURMA_CANDIDATE_ID=Je"}'

SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: $SIG" \
  -d "$PAYLOAD"
```

### 3. Valid webhook with title fallback (CID pattern)

```bash
PAYLOAD='{"eventType":"Transcription complete","meetingId":"meet_abc124","transcriptId":"tr_xyz790","title":"Intro call | Ivanna Bober | CID:Je"}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: $SIG" \
  -d "$PAYLOAD"
```

### 4. Invalid signature (expect 403)

```bash
curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: invalidsig" \
  -d '{"eventType":"Transcription complete","meetingId":"meet_abc125"}'
```

### 5. Duplicate webhook replay (expect `duplicate` status)

```bash
# Send the exact same valid webhook twice
curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: $SIG" \
  -d "$PAYLOAD"
```

### 6. Unsupported event type (expect 200 + skipped)

```bash
PAYLOAD2='{"eventType":"Meeting started","meetingId":"meet_abc126"}'
SIG2=$(echo -n "$PAYLOAD2" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: $SIG2" \
  -d "$PAYLOAD2"
```

### 7. Missing candidate metadata (expect manual review queue entry)

```bash
PAYLOAD3='{"eventType":"Transcription complete","meetingId":"meet_no_id","transcriptId":"tr_no_id"}'
SIG3=$(echo -n "$PAYLOAD3" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/fireflies \
  -H "Content-Type: application/json" \
  -H "x-hub-signature: $SIG3" \
  -d "$PAYLOAD3"
```

### 8. Test Hurma comment creation directly

```bash
curl -X POST https://yourcompany.hurma.work/api/v3/candidates/Je/comments \
  -H "Authorization: Bearer $HURMA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"comment":"Test comment from integration service"}'
```

---

## Example Fireflies webhook payload

```json
{
  "eventType": "Transcription complete",
  "meetingId": "meet_abc123",
  "transcriptId": "tr_xyz789",
  "title": "Intro call | Ivanna Bober | CID:Je",
  "description": "Intro call with Mirko Solutions\nCandidate: Ivanna Bober\nVacancy: Lawyer\nHURMA_CANDIDATE_ID=Je",
  "meetingDescription": "Intro call with Mirko Solutions\nCandidate: Ivanna Bober\nVacancy: Lawyer\nHURMA_CANDIDATE_ID=Je"
}
```

---

## Example Hurma note created

```
Interview synced automatically from Fireflies

Meeting title: Intro call with Mirko Solutions
Meeting date:  2025-11-15
Duration:      45 min
Fireflies meeting ID:    meet_abc123
Fireflies transcript ID: tr_xyz789

Participants:
  - Ivanna Bober <ivanna.bober@example.com>
  - Roman Recruiter <roman@yourcompany.com>

Summary:
The candidate demonstrated strong legal background with 7 years experience in
commercial law. Discussed salary expectations of $2500/month. Positive impression.

Action items:
  - Send test task to candidate by Friday
  - Check references from previous employer
  - Schedule second round with team lead

Transcript: https://app.fireflies.ai/view/tr_xyz789
Audio:      https://storage.fireflies.ai/audio/meet_abc123.mp3

---
Sync source: Fireflies -> Integration Service -> Hurma
```

---

## Retry and failure behavior

| Failure scenario | What happens |
|-----------------|--------------|
| Fireflies API fails | Webhook status = `failed`, retry record created |
| Hurma API 5xx | Webhook status = `failed`, retry record created |
| Hurma candidate not found (404) | Manual review queue entry |
| No candidate ID in metadata | Manual review queue entry |
| Duplicate webhook | Status = `duplicate`, no action |
| Invalid signature | HTTP 403, not persisted |
| Max retries exceeded (5) | Permanent `failed` status |

**Retry schedule (exponential backoff):**

| Attempt | Delay |
|---------|-------|
| 1 | 2 min |
| 2 | 4 min |
| 3 | 8 min |
| 4 | 16 min |
| 5 | 32 min → permanent failure |

The retry poller runs every 60 seconds. It is **restart-safe**: all retry state is in the database, so container restarts do not lose pending retries.

---

## Security and GDPR

### Security measures

- HMAC-SHA256 signature verification on every webhook (rejects unauthenticated requests with 403)
- Secrets never logged (Pino `redact` config)
- Parameterized SQL queries throughout (no SQL injection risk)
- Helmet middleware for HTTP security headers
- Rate limiting on webhook endpoint (120 req/min)
- Non-root Docker container user
- Internal PostgreSQL port not exposed externally

### GDPR considerations

Interview transcripts may contain personal data of candidates (names, voice recordings, opinions). This service stores:
- Raw Fireflies webhook payloads (in `webhooks` table)
- Full transcript JSON including attendee information (in `transcripts.raw_transcript_json`)
- Meeting summaries and action items

**Recommended retention policy:**
- Webhook payloads: delete after 90 days
- Raw transcript JSON: delete after 180 days or upon candidate deletion request
- Hurma note records: retain as long as the candidate record exists in Hurma

**Right to erasure (GDPR Art. 17):**
To delete all data for a candidate, run:
```sql
DELETE FROM meetings WHERE hurma_candidate_id = 'Je';
-- Cascades to: transcripts, hurma_notes (via ON DELETE CASCADE)
-- Also clean up webhooks manually:
DELETE FROM webhooks WHERE fireflies_meeting_id IN (
  SELECT fireflies_meeting_id FROM meetings WHERE hurma_candidate_id = 'Je'
);
```

---

## Known limitations

1. **Fireflies meeting description passthrough:** Fireflies does not always expose the Google Calendar event description in the transcript API. If `meetingDescription` is not present in the webhook payload, the `HURMA_CANDIDATE_ID` pattern cannot be matched from description alone — title fallback or email fallback will be used.

2. **Hurma candidate ID format:** Hurma uses opaque alphanumeric encoded IDs (e.g., `"Je"`), not plain integers. Recruiters must use the exact ID shown in the Hurma UI URL.

3. **ATS PRO requirement:** All Hurma API endpoints used (`/api/v3/candidates/*`) require an ATS PRO subscription. The service will fail with 403 on standard accounts.

4. **No recruitment stage update:** The Hurma Public API v3 (as of Swagger inspection on 2026-03-08) does not expose an endpoint to update a candidate's recruitment stage. This feature is marked as a TODO placeholder.

5. **Fireflies GraphQL schema:** The `sentences` field (full transcript text) is fetched but currently stored as raw JSON only. Full text search or display in notes is not implemented.

6. **OAuth token refresh:** The service uses a static Bearer token. Hurma supports OAuth2 token refresh (`/api/v3/oauth/token` with `grant_type=refresh_token`). This is not implemented — tokens must be renewed manually.

---

## TODO / future versions

- [ ] **Hurma OAuth2 token refresh** — automatic access token renewal when it expires
- [ ] **Recruitment stage update** — if Hurma exposes the endpoint in a future API version, update candidate stage to "Interview completed" after note creation
- [ ] **Fireflies meeting description via Google Calendar API** — if Fireflies webhook doesn't include description, fetch it from Google Calendar directly using the meeting link
- [ ] **Admin UI** — simple web interface to view manual review queue and resolve items
- [ ] **Prometheus metrics** — expose `/metrics` for Grafana monitoring
- [ ] **Webhook replay endpoint** — `POST /admin/webhooks/:id/replay` to retry a specific webhook
- [ ] **Transcript text in note** — include full transcript sentences in the Hurma note (currently only summary)
- [ ] **Hurma v1 API compatibility** — check Public API v1 for any additional candidate endpoints
- [ ] **Multi-tenant support** — support multiple Hurma organizations with different API tokens
- [ ] **Automated GDPR purge job** — scheduled job to delete stale transcript data past retention period
