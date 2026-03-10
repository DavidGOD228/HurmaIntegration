-- Migration 004: Add Hurma OAuth2 token storage per user
-- The Hurma v3 API uses OAuth2 (password grant). We store the access/refresh
-- tokens here so we can auto-refresh without asking for credentials again.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hurma_oauth_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS hurma_oauth_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS hurma_oauth_token_expires_at TIMESTAMPTZ;
