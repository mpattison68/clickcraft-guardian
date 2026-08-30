import { Router } from "express";
import { query } from "../../db/pool.js";
import { requireAuth } from "../../auth/session.js";
import { getSettings } from "../../settings.js";

export const dashboardRouter: Router = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (_req, res) => {
  const settings = await getSettings();
  const maxWarn = Math.max(...settings.ssl.warningDays, 30);

  const [summary, sites, incidents, expiring] = await Promise.all([
    query<{ total: string; healthy: string; warning: string; critical: string; disabled: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status='healthy')::text AS healthy,
              count(*) FILTER (WHERE status='warning')::text AS warning,
              count(*) FILTER (WHERE status='critical')::text AS critical,
              count(*) FILTER (WHERE enabled = false)::text AS disabled
       FROM sites`,
    ),
    query(
      `SELECT s.id, s.name, s.url, s.hostname, s.status, s.enabled, s.last_check_at, s.last_success_at,
              s.last_error, s.consecutive_failures,
              lc.http_status, lc.response_ms,
              sc.status AS ssl_status, sc.days_remaining AS ssl_days_remaining,
              dc.status AS dns_status
       FROM sites s
       LEFT JOIN LATERAL (
         SELECT http_status, response_ms FROM site_checks WHERE site_id = s.id
         ORDER BY checked_at DESC LIMIT 1) lc ON true
       LEFT JOIN LATERAL (
         SELECT status, days_remaining FROM ssl_checks WHERE site_id = s.id
         ORDER BY checked_at DESC LIMIT 1) sc ON true
       LEFT JOIN LATERAL (
         SELECT status FROM dns_checks WHERE site_id = s.id
         ORDER BY checked_at DESC LIMIT 1) dc ON true
       ORDER BY
         CASE s.status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'unknown' THEN 2 ELSE 3 END,
         s.name`,
    ),
    query<{ count: string }>("SELECT count(*)::text AS count FROM incidents WHERE status='active'"),
    query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
         SELECT DISTINCT ON (site_id) site_id, days_remaining FROM ssl_checks
         ORDER BY site_id, checked_at DESC) latest
       WHERE days_remaining IS NOT NULL AND days_remaining <= $1`,
      [maxWarn],
    ),
  ]);

  res.json({
    summary: {
      total: Number(summary.rows[0].total),
      healthy: Number(summary.rows[0].healthy),
      warning: Number(summary.rows[0].warning),
      critical: Number(summary.rows[0].critical),
      disabled: Number(summary.rows[0].disabled),
      activeIncidents: Number(incidents.rows[0].count),
      sslExpiringSoon: Number(expiring.rows[0].count),
    },
    sites: sites.rows,
  });
});
