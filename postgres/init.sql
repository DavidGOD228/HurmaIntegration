-- Initialise databases for all services.
-- This script runs automatically on first postgres container start (empty data dir).
-- hurma_recorder is created by POSTGRES_DB env var; we only need worklog_dashboard here.

CREATE DATABASE worklog_dashboard;
