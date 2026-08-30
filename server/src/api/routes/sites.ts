import { Router } from "express";
import { z } from "zod";
import { query } from "../../db/pool.js";
import { requireAuth } from "../../auth/session.js";
import { probeUrl, runSiteCheck } from "../../monitor/engine.js";
import { assertSafeUrl } from "../../checks/ssrf.js";
import { getSettings } from "../../settings.js";
import type { SiteRow } from "../../monitor/types.js";
import { createLogger } from "../../logger.js";

const log = createLogger("api.sites");
export const sitesRouter: Router = Router();
sitesRouter.use(requireAuth);

const endpointSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(500),
  expected_status: z.string().max(64).default("200-299"),
  timeout_ms: z.number().int().min(1000).max(120_000).default(10_000),
  expected_content: z.array(z.string().max(500)).max(20).default([]),
  forbidden_content: z.array(z.string().max(500)).max(20).default([]),
  is_critical: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

const siteSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).default(""),
  url: z.string().url().max(2000),
  enabled: z.boolean().default(true),
  interval_seconds: z.number().int().min(60).max(3600).default(60),
  timeout_ms: z.number().int().min(1000).max(120_000).default(10_000),
  expected_status: z.string().max(64).default("200-299"),
  failure_threshold: z.number().int().min(1).max(20).default(3),
  warn_response_ms: z.number().int().min(100).max(120_000).default(1500),
  critical_response_ms: z.number().int().min(100).max(120_000).default(3000),
  follow_redirects: z.boolean().default(true),
  expected_content: z.array(z.string().max(500)).max(20).default([]),
  forbidden_content: z.array(z.string().max(500)).max(20).default([]),
  content_failure_mode: z.enum(["failure", "warning"]).default("failure"),
  endpoints: z.array(endpointSchema).max(25).default([]),
});

async function getSite(id: number): Promise<SiteRow | null> {
  const res = await query<SiteRow>("SELECT * FROM sites WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

sitesRouter.get("/", async (_req, res) => {
  const rows = await query(
    `SELECT s.*,
       (SELECT row_to_json(x) FROM (
          SELECT status, days_remaining, valid_to, issuer FROM ssl_checks
          WHERE site_id = s.id ORDER BY checked_at DESC LIMIT 1) x) AS ssl,
       (SELECT row_to_json(y) FROM (
          SELECT status, a_records, changed FROM dns_checks
          WHERE site_id = s.id ORDER BY checked_at DESC LIMIT 1) y) AS dns,
       (SELECT row_to_json(z) FROM (
          SELECT http_status, response_ms FROM site_checks
          WHERE site_id = s.id ORDER BY checked_at DESC LIMIT 1) z) AS last_check
     FROM sites s ORDER BY s.name`,
  );
  res.json({ sites: rows.rows });
});

sitesRouter.post("/", async (req, res) => {
  const parsed = siteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid site configuration", details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;
  let hostname: string;
  try {
    hostname = assertSafeUrl(data.url).hostname;
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const inserted = await query<{ id: number }>(
    `INSERT INTO sites(name, description, url, hostname, enabled, interval_seconds, timeout_ms,
       expected_status, failure_threshold, warn_response_ms, critical_response_ms, follow_redirects,
       expected_content, forbidden_content, content_failure_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [
      data.name,
      data.description,
      data.url,
      hostname,
      data.enabled,
      data.interval_seconds,
      data.timeout_ms,
      data.expected_status,
      data.failure_threshold,
      data.warn_response_ms,
      data.critical_response_ms,
      data.follow_redirects,
      data.expected_content,
      data.forbidden_content,
      data.content_failure_mode,
    ],
  );
  const siteId = inserted.rows[0].id;
  for (const ep of data.endpoints) {
    await query(
      `INSERT INTO endpoints(site_id, name, path, expected_status, timeout_ms, expected_content, forbidden_content, is_critical, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [siteId, ep.name, ep.path, ep.expected_status, ep.timeout_ms, ep.expected_content, ep.forbidden_content, ep.is_critical, ep.enabled],
    );
  }
  log.info("site created", { siteId, name: data.name });
  res.status(201).json({ id: siteId });
});

sitesRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const site = await getSite(id);
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const [endpoints, ssl, dns, baseline, security, incident] = await Promise.all([
    query("SELECT * FROM endpoints WHERE site_id = $1 ORDER BY id", [id]),
    query("SELECT * FROM ssl_checks WHERE site_id = $1 ORDER BY checked_at DESC LIMIT 20", [id]),
    query("SELECT * FROM dns_checks WHERE site_id = $1 ORDER BY checked_at DESC LIMIT 20", [id]),
    query("SELECT * FROM dns_baselines WHERE site_id = $1", [id]),
    query("SELECT * FROM security_checks WHERE site_id = $1 ORDER BY checked_at DESC LIMIT 1", [id]),
    query("SELECT * FROM incidents WHERE site_id = $1 AND status='active' ORDER BY started_at DESC LIMIT 1", [id]),
  ]);

  const uptime = await query(
    `SELECT
       coalesce(avg(CASE WHEN success THEN 1.0 ELSE 0 END) FILTER (WHERE checked_at > now() - interval '24 hours'), 0) * 100 AS d1,
       coalesce(avg(CASE WHEN success THEN 1.0 ELSE 0 END) FILTER (WHERE checked_at > now() - interval '7 days'), 0) * 100 AS d7,
       coalesce(avg(CASE WHEN success THEN 1.0 ELSE 0 END) FILTER (WHERE checked_at > now() - interval '30 days'), 0) * 100 AS d30,
       count(*) FILTER (WHERE checked_at > now() - interval '24 hours') AS checks_24h,
       avg(response_ms) FILTER (WHERE checked_at > now() - interval '24 hours') AS avg24,
       avg(response_ms) FILTER (WHERE checked_at > now() - interval '7 days') AS avg7d,
       avg(response_ms) FILTER (WHERE checked_at > now() - interval '30 days') AS avg30d
     FROM site_checks WHERE site_id = $1`,
    [id],
  );

  res.json({
    site,
    endpoints: endpoints.rows,
    ssl: ssl.rows,
    dns: dns.rows,
    dnsBaseline: baseline.rows[0] ?? null,
    security: security.rows[0] ?? null,
    activeIncident: incident.rows[0] ?? null,
    uptime: uptime.rows[0],
  });
});

sitesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = siteSchema.partial({ endpoints: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid site configuration", details: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  let hostname: string;
  try {
    hostname = assertSafeUrl(d.url).hostname;
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }
  const result = await query(
    `UPDATE sites SET name=$2, description=$3, url=$4, hostname=$5, enabled=$6, interval_seconds=$7,
       timeout_ms=$8, expected_status=$9, failure_threshold=$10, warn_response_ms=$11,
       critical_response_ms=$12, follow_redirects=$13, expected_content=$14, forbidden_content=$15,
       content_failure_mode=$16, updated_at=now() WHERE id=$1`,
    [
      id, d.name, d.description, d.url, hostname, d.enabled, d.interval_seconds, d.timeout_ms,
      d.expected_status, d.failure_threshold, d.warn_response_ms, d.critical_response_ms,
      d.follow_redirects, d.expected_content, d.forbidden_content, d.content_failure_mode,
    ],
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  res.json({ ok: true });
});

sitesRouter.patch("/:id/enabled", async (req, res) => {
  const id = Number(req.params.id);
  const enabled = Boolean(req.body?.enabled);
  await query(
    `UPDATE sites SET enabled=$2, status = CASE WHEN $2 THEN 'unknown' ELSE 'disabled' END,
       next_check_at = now(), updated_at = now() WHERE id=$1`,
    [id, enabled],
  );
  res.json({ ok: true });
});

sitesRouter.delete("/:id", async (req, res) => {
  await query("DELETE FROM sites WHERE id = $1", [Number(req.params.id)]);
  res.json({ ok: true });
});

sitesRouter.post("/:id/check", async (req, res) => {
  const site = await getSite(Number(req.params.id));
  if (!site) {
    res.status(404).json({ error: "Site not found" });
    return;
  }
  const outcome = await runSiteCheck(site, { manual: true });
  res.json({ outcome });
});

sitesRouter.post("/:id/dns-baseline", async (req, res) => {
  const id = Number(req.params.id);
  const latest = await query<{ a_records: string[]; aaaa_records: string[]; cname_records: string[] }>(
    "SELECT a_records, aaaa_records, cname_records FROM dns_checks WHERE site_id=$1 ORDER BY checked_at DESC LIMIT 1",
    [id],
  );
  const row = latest.rows[0];
  if (!row) {
    res.status(400).json({ error: "No DNS results recorded yet" });
    return;
  }
  await query(
    `INSERT INTO dns_baselines(site_id, a_records, aaaa_records, cname_records, accepted_at)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (site_id) DO UPDATE SET a_records=EXCLUDED.a_records,
       aaaa_records=EXCLUDED.aaaa_records, cname_records=EXCLUDED.cname_records, accepted_at=now()`,
    [id, row.a_records, row.aaaa_records, row.cname_records],
  );
  await query("UPDATE dns_checks SET changed=false WHERE site_id=$1 AND changed=true", [id]);
  res.json({ ok: true });
});

sitesRouter.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  const range = String(req.query.range ?? "24h");
  const intervals: Record<string, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
  const interval = intervals[range] ?? "24 hours";
  const checks = await query(
    `SELECT checked_at, success, status, http_status, response_ms, error_message
     FROM site_checks WHERE site_id=$1 AND checked_at > now() - $2::interval
     ORDER BY checked_at DESC LIMIT 2000`,
    [id, interval],
  );
  res.json({ checks: checks.rows.reverse() });
});

sitesRouter.get("/:id/endpoint-history", async (req, res) => {
  const rows = await query(
    `SELECT ec.*, e.name FROM endpoint_checks ec JOIN endpoints e ON e.id = ec.endpoint_id
     WHERE ec.site_id = $1 ORDER BY ec.checked_at DESC LIMIT 200`,
    [Number(req.params.id)],
  );
  res.json({ checks: rows.rows });
});

sitesRouter.post("/:id/endpoints", async (req, res) => {
  const parsed = endpointSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid endpoint" });
    return;
  }
  const e = parsed.data;
  const out = await query<{ id: number }>(
    `INSERT INTO endpoints(site_id, name, path, expected_status, timeout_ms, expected_content, forbidden_content, is_critical, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [Number(req.params.id), e.name, e.path, e.expected_status, e.timeout_ms, e.expected_content, e.forbidden_content, e.is_critical, e.enabled],
  );
  res.status(201).json({ id: out.rows[0].id });
});

sitesRouter.delete("/:id/endpoints/:endpointId", async (req, res) => {
  await query("DELETE FROM endpoints WHERE id=$1 AND site_id=$2", [
    Number(req.params.endpointId),
    Number(req.params.id),
  ]);
  res.json({ ok: true });
});

/** Wizard step 4 — run a live probe without saving anything. */
sitesRouter.post("/probe", async (req, res) => {
  const schema = z.object({ url: z.string().url().max(2000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid URL is required" });
    return;
  }
  try {
    const settings = await getSettings();
    const result = await probeUrl(parsed.data.url, settings.monitoring.defaultTimeoutMs);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Probe failed" });
  }
});
