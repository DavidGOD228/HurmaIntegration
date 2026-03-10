-- worklog-dashboard initial schema
-- All tables are prefixed or clearly scoped; safe to run alongside other projects.

-- ── Employees ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id                  SERIAL PRIMARY KEY,
  hurma_employee_id   VARCHAR(255) UNIQUE,
  redmine_user_id     INTEGER,
  full_name           VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  department          VARCHAR(255),
  position            VARCHAR(255),
  work_hours_per_day  DECIMAL(4,2) NOT NULL DEFAULT 8.0,
  hurma_raw_json      JSONB,
  redmine_raw_json    JSONB,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_email            ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_redmine_user_id ON employees(redmine_user_id);

-- ── Monitoring settings ───────────────────────────────────────────────────────
-- One row per employee; monitoring_mode controls inclusion in dashboard.
CREATE TABLE IF NOT EXISTS employee_monitoring_settings (
  id              SERIAL      PRIMARY KEY,
  employee_id     INTEGER     NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  monitoring_mode VARCHAR(50) NOT NULL DEFAULT 'excluded',
  -- 'included'  → show in dashboard
  -- 'excluded'  → hide from dashboard
  -- 'ignored_fulltime_external_project' → skip silently
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id)
);

-- ── Public holidays ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_holidays (
  id           SERIAL    PRIMARY KEY,
  holiday_date DATE      NOT NULL UNIQUE,
  name         VARCHAR(255),
  country_code CHAR(2)   NOT NULL DEFAULT 'UA',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Absences / leave records ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS absences (
  id                 SERIAL       PRIMARY KEY,
  employee_id        INTEGER      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  hurma_absence_id   VARCHAR(255) UNIQUE,
  absence_type       VARCHAR(100) NOT NULL,
  -- sick_leave | vacation | unpaid_leave | maternity | other
  date_from          DATE         NOT NULL,
  date_to            DATE         NOT NULL,
  hours              DECIMAL(6,2),
  -- NULL = full-day absence; partial if < work_hours_per_day
  is_approved        BOOLEAN      NOT NULL DEFAULT true,
  raw_json           JSONB,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absences_employee_id ON absences(employee_id);
CREATE INDEX IF NOT EXISTS idx_absences_date_range  ON absences(date_from, date_to);

-- ── Redmine time entries ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS time_entries (
  id               SERIAL       PRIMARY KEY,
  employee_id      INTEGER      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  redmine_entry_id INTEGER      UNIQUE NOT NULL,
  entry_date       DATE         NOT NULL,
  hours            DECIMAL(6,2) NOT NULL,
  project_id       INTEGER,
  project_name     VARCHAR(255),
  issue_id         INTEGER,
  activity_name    VARCHAR(255),
  comments         TEXT,
  raw_json         JSONB,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_entries_employee_id ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_entry_date  ON time_entries(entry_date);

-- ── Daily summaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_employee_summary (
  id                  SERIAL       PRIMARY KEY,
  employee_id         INTEGER      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  summary_date        DATE         NOT NULL,
  expected_hours      DECIMAL(6,2) NOT NULL DEFAULT 0,
  actual_hours        DECIMAL(6,2) NOT NULL DEFAULT 0,
  delta_hours         DECIMAL(6,2) GENERATED ALWAYS AS (actual_hours - expected_hours) STORED,
  leave_type          VARCHAR(100),
  contradiction_count INTEGER      NOT NULL DEFAULT 0,
  status              VARCHAR(50)  NOT NULL DEFAULT 'EXCLUDED',
  -- OK | UNDERLOGGED | OVERLOGGED | ON_LEAVE | CONTRADICTION | UNMAPPED | EXCLUDED
  notes               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summary_date ON daily_employee_summary(summary_date);

-- ── Contradictions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contradictions (
  id                    SERIAL       PRIMARY KEY,
  employee_id           INTEGER      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contradiction_date    DATE         NOT NULL,
  contradiction_type    VARCHAR(100) NOT NULL,
  -- LOGGED_ON_SICK_LEAVE | LOGGED_ON_VACATION | LOGGED_ON_UNPAID_LEAVE
  -- NO_LOG_ON_WORKING_DAY | PARTIAL_DAY_MISMATCH
  -- HURMA_ONLY_NO_REDMINE_USER | REDMINE_ONLY_NO_HURMA_MAPPING
  -- EXCLUDED_BUT_HAS_WORKLOG_ACTIVITY | INCLUDED_BUT_NO_SYNCDATA
  severity              VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
  -- HIGH | MEDIUM | LOW
  description           TEXT         NOT NULL,
  related_absence_id    INTEGER      REFERENCES absences(id) ON DELETE SET NULL,
  related_time_entry_id INTEGER      REFERENCES time_entries(id) ON DELETE SET NULL,
  is_resolved           BOOLEAN      NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contradictions_employee_id ON contradictions(employee_id);
CREATE INDEX IF NOT EXISTS idx_contradictions_date        ON contradictions(contradiction_date);

-- ── Sync runs log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_runs (
  id                 SERIAL       PRIMARY KEY,
  source             VARCHAR(50)  NOT NULL,
  -- hurma_employees | hurma_absences | redmine_users | redmine_time_entries | summary | all
  started_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  status             VARCHAR(20)  NOT NULL DEFAULT 'running',
  -- running | success | failed
  records_processed  INTEGER      NOT NULL DEFAULT 0,
  date_range_from    DATE,
  date_range_to      DATE,
  error_message      TEXT
);

-- ── Employee mapping queue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_mapping_queue (
  id                   SERIAL       PRIMARY KEY,
  hurma_employee_id    VARCHAR(255),
  hurma_full_name      VARCHAR(255),
  hurma_email          VARCHAR(255),
  redmine_user_id      INTEGER,
  redmine_username     VARCHAR(255),
  redmine_email        VARCHAR(255),
  proposed_match_type  VARCHAR(50),
  -- email | name | manual
  status               VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- pending | confirmed | rejected
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
