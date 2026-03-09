-- Migration 002: Multi-user support
BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id                        SERIAL PRIMARY KEY,
    name                      VARCHAR(255) NOT NULL,
    email                     VARCHAR(255),
    -- Unique token used in the webhook URL: /webhooks/fireflies/:token
    webhook_token             VARCHAR(64) UNIQUE NOT NULL,
    fireflies_api_key         VARCHAR(255) NOT NULL,
    fireflies_webhook_secret  VARCHAR(255) NOT NULL,
    active                    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_webhook_token ON users (webhook_token);

-- Link existing tables to users (nullable so legacy single-user data still works)
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);

INSERT INTO schema_migrations (version) VALUES ('002_add_users')
    ON CONFLICT DO NOTHING;

COMMIT;
