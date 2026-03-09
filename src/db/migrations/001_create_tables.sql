-- Migration 001: Create all integration service tables
-- Run with: psql $DATABASE_URL -f src/db/migrations/001_create_tables.sql

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- meetings: core record linking a Fireflies transcript to a Hurma candidate
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
    id                      SERIAL PRIMARY KEY,
    fireflies_meeting_id    VARCHAR(255) UNIQUE NOT NULL,
    fireflies_transcript_id VARCHAR(255),
    hurma_candidate_id      VARCHAR(255),
    title                   TEXT,
    description             TEXT,
    source                  VARCHAR(50) DEFAULT 'fireflies',
    -- pending | matched | unmatched | processed | failed
    status                  VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- description_pattern | title_cid_pattern | client_reference_id |
    -- candidate_links | email_fallback | manual
    matched_by              VARCHAR(100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_fireflies_meeting_id  ON meetings (fireflies_meeting_id);
CREATE INDEX IF NOT EXISTS idx_meetings_hurma_candidate_id    ON meetings (hurma_candidate_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status                ON meetings (status);

-- ──────────────────────────────────────────────────────────────────────────────
-- transcripts: Fireflies transcript detail, stored for auditing and GDPR
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcripts (
    id                    SERIAL PRIMARY KEY,
    meeting_id            INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    transcript_url        TEXT,
    audio_url             TEXT,
    video_url             TEXT,
    short_summary         TEXT,
    action_items_json     JSONB,
    topics_discussed_json JSONB,
    raw_transcript_json   JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_id ON transcripts (meeting_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- webhooks: raw incoming webhook payloads for auditing and replay
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
    id                      SERIAL PRIMARY KEY,
    source                  VARCHAR(50) NOT NULL DEFAULT 'fireflies',
    event_type              VARCHAR(100),
    fireflies_meeting_id    VARCHAR(255),
    fireflies_transcript_id VARCHAR(255),
    payload_json            JSONB NOT NULL,
    signature_valid         BOOLEAN NOT NULL DEFAULT FALSE,
    received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    -- pending | processing | done | failed | duplicate | skipped
    processing_status       VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message           TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhooks_fireflies_meeting_id ON webhooks (fireflies_meeting_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_processing_status    ON webhooks (processing_status);

-- ──────────────────────────────────────────────────────────────────────────────
-- retries: exponential backoff retry tracking
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retries (
    id             SERIAL PRIMARY KEY,
    webhook_id     INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    next_retry_at  TIMESTAMPTZ NOT NULL,
    last_error     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retries_webhook_id    ON retries (webhook_id);
CREATE INDEX IF NOT EXISTS idx_retries_next_retry_at ON retries (next_retry_at);

-- ──────────────────────────────────────────────────────────────────────────────
-- hurma_notes: tracks notes pushed to Hurma to prevent duplicates
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hurma_notes (
    id                     SERIAL PRIMARY KEY,
    meeting_id             INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    hurma_candidate_id     VARCHAR(255) NOT NULL,
    hurma_note_external_id VARCHAR(255),
    -- SHA-256 hash of note content for idempotency checks
    content_hash           VARCHAR(64) NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hurma_notes_content_hash
    ON hurma_notes (hurma_candidate_id, content_hash);

CREATE INDEX IF NOT EXISTS idx_hurma_notes_meeting_id ON hurma_notes (meeting_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- candidate_links: optional pre-configured external → Hurma ID mappings
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_links (
    id                 SERIAL PRIMARY KEY,
    -- email address, Fireflies clientReferenceId, or other external marker
    external_reference VARCHAR(500) NOT NULL,
    hurma_candidate_id VARCHAR(255) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_links_external_ref
    ON candidate_links (external_reference);

-- ──────────────────────────────────────────────────────────────────────────────
-- manual_review_queue: unresolved meetings that need human intervention
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_review_queue (
    id                      SERIAL PRIMARY KEY,
    fireflies_meeting_id    VARCHAR(255),
    fireflies_transcript_id VARCHAR(255),
    -- reason why automatic matching failed
    reason                  TEXT NOT NULL,
    payload_json            JSONB,
    -- pending | resolved | ignored
    status                  VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_manual_review_status ON manual_review_queue (status);

-- ──────────────────────────────────────────────────────────────────────────────
-- schema_migrations: track applied migration files
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_create_tables')
    ON CONFLICT DO NOTHING;

COMMIT;
