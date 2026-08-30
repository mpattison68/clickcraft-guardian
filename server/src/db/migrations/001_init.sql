-- ClickCraft Site Monitor :: initial schema

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS application_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id                     BIGSERIAL PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  url                    TEXT NOT NULL,
  hostname               TEXT NOT NULL,
  enabled                BOOLEAN NOT NULL DEFAULT true,
  interval_seconds       INTEGER NOT NULL DEFAULT 60,
  timeout_ms             INTEGER NOT NULL DEFAULT 10000,
  expected_status        TEXT NOT NULL DEFAULT '200-299',
  failure_threshold      INTEGER NOT NULL DEFAULT 3,
  warn_response_ms       INTEGER NOT NULL DEFAULT 1500,
  critical_response_ms   INTEGER NOT NULL DEFAULT 3000,
  follow_redirects       BOOLEAN NOT NULL DEFAULT true,
  expected_content       TEXT[] NOT NULL DEFAULT '{}',
  forbidden_content      TEXT[] NOT NULL DEFAULT '{}',
  content_failure_mode   TEXT NOT NULL DEFAULT 'failure', -- failure | warning
  status                 TEXT NOT NULL DEFAULT 'unknown', -- healthy | warning | critical | unknown | disabled
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  consecutive_successes  INTEGER NOT NULL DEFAULT 0,
  first_failure_at       TIMESTAMPTZ,
  last_check_at          TIMESTAMPTZ,
  last_success_at        TIMESTAMPTZ,
  next_check_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error             TEXT,
  config_error           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_next_check_idx ON sites(enabled, next_check_at);

CREATE TABLE IF NOT EXISTS endpoints (
  id               BIGSERIAL PRIMARY KEY,
  site_id          BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  path             TEXT NOT NULL DEFAULT '/',
  expected_status  TEXT NOT NULL DEFAULT '200-299',
  timeout_ms       INTEGER NOT NULL DEFAULT 10000,
  expected_content TEXT[] NOT NULL DEFAULT '{}',
  forbidden_content TEXT[] NOT NULL DEFAULT '{}',
  is_critical      BOOLEAN NOT NULL DEFAULT true,
  enabled          BOOLEAN NOT NULL DEFAULT true,
  status           TEXT NOT NULL DEFAULT 'unknown',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_check_at    TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS endpoints_site_idx ON endpoints(site_id);

CREATE TABLE IF NOT EXISTS site_checks (
  id             BIGSERIAL PRIMARY KEY,
  site_id        BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  success        BOOLEAN NOT NULL,
  status         TEXT NOT NULL,
  http_status    INTEGER,
  response_ms    INTEGER,
  final_url      TEXT,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  error_type     TEXT,
  error_message  TEXT
);
CREATE INDEX IF NOT EXISTS site_checks_site_time_idx ON site_checks(site_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS endpoint_checks (
  id            BIGSERIAL PRIMARY KEY,
  endpoint_id   BIGINT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  site_id       BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  success       BOOLEAN NOT NULL,
  status        TEXT NOT NULL,
  http_status   INTEGER,
  response_ms   INTEGER,
  error_type    TEXT,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS endpoint_checks_ep_time_idx ON endpoint_checks(endpoint_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS endpoint_checks_site_time_idx ON endpoint_checks(site_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS ssl_checks (
  id             BIGSERIAL PRIMARY KEY,
  site_id        BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL,        -- healthy | warning | critical | unknown
  valid          BOOLEAN NOT NULL DEFAULT false,
  issuer         TEXT,
  subject        TEXT,
  valid_from     TIMESTAMPTZ,
  valid_to       TIMESTAMPTZ,
  days_remaining INTEGER,
  hostname_match BOOLEAN,
  chain_valid    BOOLEAN,
  handshake_ok   BOOLEAN,
  error_message  TEXT
);
CREATE INDEX IF NOT EXISTS ssl_checks_site_time_idx ON ssl_checks(site_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS dns_checks (
  id            BIGSERIAL PRIMARY KEY,
  site_id       BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL,          -- healthy | changed | failed
  a_records     TEXT[] NOT NULL DEFAULT '{}',
  aaaa_records  TEXT[] NOT NULL DEFAULT '{}',
  cname_records TEXT[] NOT NULL DEFAULT '{}',
  changed       BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS dns_checks_site_time_idx ON dns_checks(site_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS dns_baselines (
  site_id       BIGINT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  a_records     TEXT[] NOT NULL DEFAULT '{}',
  aaaa_records  TEXT[] NOT NULL DEFAULT '{}',
  cname_records TEXT[] NOT NULL DEFAULT '{}',
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_checks (
  id          BIGSERIAL PRIMARY KEY,
  site_id     BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  findings    JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS security_checks_site_time_idx ON security_checks(site_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id             BIGSERIAL PRIMARY KEY,
  site_id        BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  endpoint_id    BIGINT REFERENCES endpoints(id) ON DELETE SET NULL,
  type           TEXT NOT NULL,      -- unavailable | http_error | timeout | dns_failure | ssl_failure | content_failed | endpoint_failure
  severity       TEXT NOT NULL DEFAULT 'critical',
  status         TEXT NOT NULL DEFAULT 'active', -- active | resolved
  error_message  TEXT,
  started_at     TIMESTAMPTZ NOT NULL,
  confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovered_at   TIMESTAMPTZ,
  duration_seconds INTEGER,
  failed_checks  INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  timeline       JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS incidents_site_idx ON incidents(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(status);

CREATE TABLE IF NOT EXISTS notification_events (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel     TEXT NOT NULL,      -- telegram | email
  event_key   TEXT NOT NULL,      -- dedup key
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  success     BOOLEAN NOT NULL,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS notification_events_key_idx ON notification_events(event_key, created_at DESC);

CREATE TABLE IF NOT EXISTS server_metrics (
  id             BIGSERIAL PRIMARY KEY,
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  uptime_seconds BIGINT,
  cpu_percent    NUMERIC(5,2),
  load1          NUMERIC(6,2),
  load5          NUMERIC(6,2),
  load15         NUMERIC(6,2),
  mem_total_bytes BIGINT,
  mem_used_bytes  BIGINT,
  mem_percent     NUMERIC(5,2),
  swap_total_bytes BIGINT,
  swap_used_bytes  BIGINT,
  disk_total_bytes BIGINT,
  disk_used_bytes  BIGINT,
  disk_percent     NUMERIC(5,2)
);
CREATE INDEX IF NOT EXISTS server_metrics_time_idx ON server_metrics(collected_at DESC);

CREATE TABLE IF NOT EXISTS docker_container_metrics (
  id             BIGSERIAL PRIMARY KEY,
  collected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  container_id   TEXT NOT NULL,
  name           TEXT NOT NULL,
  image          TEXT,
  state          TEXT,
  status_text    TEXT,
  health         TEXT,
  restart_count  INTEGER,
  started_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS docker_metrics_time_idx ON docker_container_metrics(collected_at DESC);

-- Aggregated rollups kept long-term after raw checks are purged.
CREATE TABLE IF NOT EXISTS site_check_hourly (
  site_id        BIGINT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  bucket         TIMESTAMPTZ NOT NULL,
  checks_total   INTEGER NOT NULL,
  checks_success INTEGER NOT NULL,
  avg_response_ms INTEGER,
  max_response_ms INTEGER,
  PRIMARY KEY (site_id, bucket)
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT PRIMARY KEY,
  beat_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  details     JSONB NOT NULL DEFAULT '{}'
);
