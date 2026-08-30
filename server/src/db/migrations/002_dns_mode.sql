-- Per-site DNS monitoring mode (static vs dynamic/CDN) + nameserver tracking.
-- Safe for existing deployments: additive columns with defaults, no data loss.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS dns_mode TEXT NOT NULL DEFAULT 'static'; -- static | dynamic

ALTER TABLE dns_checks
  ADD COLUMN IF NOT EXISTS ns_records TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE dns_baselines
  ADD COLUMN IF NOT EXISTS ns_records TEXT[] NOT NULL DEFAULT '{}';
