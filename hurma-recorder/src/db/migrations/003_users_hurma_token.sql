-- Migration 003: add per-user Hurma API token
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS hurma_api_token VARCHAR(255);

INSERT INTO schema_migrations (version) VALUES ('003_users_hurma_token')
    ON CONFLICT DO NOTHING;

COMMIT;
