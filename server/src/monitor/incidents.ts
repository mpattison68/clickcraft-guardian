import { query } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { dispatchNotification } from "../notify/dispatcher.js";
import { getSettings } from "../settings.js";
import type { SiteRow } from "./types.js";

const log = createLogger("incidents");

export interface TimelineEntry {
  at: string;
  message: string;
}

export interface IncidentContext {
  type: string;
  errorMessage: string;
  failedChecks: number;
  httpStatus?: number | null;
  sslSummary?: string;
  dnsSummary?: string;
  endpointId?: number | null;
}

async function activeIncident(siteId: number) {
  const res = await query<{ id: number; timeline: TimelineEntry[]; last_reminder_at: Date | null; started_at: Date }>(
    `SELECT id, timeline, last_reminder_at, started_at FROM incidents
     WHERE site_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
    [siteId],
  );
  return res.rows[0] ?? null;
}

export async function appendTimeline(incidentId: number, message: string) {
  await query(
    `UPDATE incidents SET timeline = timeline || $2::jsonb WHERE id = $1`,
    [incidentId, JSON.stringify([{ at: new Date().toISOString(), message }])],
  );
}

export async function openIncident(site: SiteRow, ctx: IncidentContext, timeline: TimelineEntry[]) {
  const existing = await activeIncident(site.id);
  if (existing) {
    await appendTimeline(existing.id, ctx.errorMessage);
    return existing.id;
  }
  const startedAt = site.first_failure_at ?? new Date();
  const res = await query<{ id: number }>(
    `INSERT INTO incidents(site_id, endpoint_id, type, severity, status, error_message,
       started_at, confirmed_at, failed_checks, timeline)
     VALUES ($1,$2,$3,'critical','active',$4,$5,now(),$6,$7) RETURNING id`,
    [
      site.id,
      ctx.endpointId ?? null,
      ctx.type,
      ctx.errorMessage,
      startedAt,
      ctx.failedChecks,
      JSON.stringify([
        ...timeline,
        { at: new Date().toISOString(), message: `Incident opened after ${ctx.failedChecks} consecutive failures` },
      ]),
    ],
  );
  const incidentId = res.rows[0].id;
  log.warn("incident opened", { siteId: site.id, incidentId, type: ctx.type });

  await dispatchNotification({
    eventKey: `incident:${incidentId}:opened`,
    subject: "🔴 SITE DOWN",
    body:
      `${site.name}\n${site.url}\n\n` +
      `Reason: ${ctx.errorMessage}\n` +
      `Failed checks: ${ctx.failedChecks}\n` +
      `Incident started: ${new Date(startedAt).toISOString()}\n` +
      `SSL: ${ctx.sslSummary ?? "unknown"}\n` +
      `DNS: ${ctx.dnsSummary ?? "unknown"}`,
  });
  return incidentId;
}

export async function resolveIncident(
  site: SiteRow,
  info: { httpStatus: number | null; responseMs: number | null },
) {
  const existing = await activeIncident(site.id);
  if (!existing) return;
  const recoveredAt = new Date();
  const duration = Math.max(
    0,
    Math.round((recoveredAt.getTime() - new Date(existing.started_at).getTime()) / 1000),
  );
  await query(
    `UPDATE incidents SET status='resolved', recovered_at=$2, duration_seconds=$3,
       timeline = timeline || $4::jsonb WHERE id = $1`,
    [
      existing.id,
      recoveredAt,
      duration,
      JSON.stringify([
        { at: recoveredAt.toISOString(), message: `HTTP ${info.httpStatus ?? "?"} — recovered` },
        { at: recoveredAt.toISOString(), message: "Incident resolved" },
      ]),
    ],
  );
  log.info("incident resolved", { siteId: site.id, incidentId: existing.id, duration });

  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  await dispatchNotification({
    eventKey: `incident:${existing.id}:resolved`,
    subject: "🟢 SITE RECOVERED",
    body:
      `${site.name}\n\n` +
      `Downtime: ${mins}m ${secs}s\n` +
      `HTTP: ${info.httpStatus ?? "?"}\n` +
      `Response time: ${info.responseMs ?? "?"}ms`,
  });
}

/** Reminder notifications for prolonged incidents. */
export async function sendIncidentReminders() {
  const settings = await getSettings();
  if (!settings.alerts.remindersEnabled) return;
  const res = await query<{ id: number; name: string; url: string; started_at: Date; error_message: string }>(
    `SELECT i.id, s.name, s.url, i.started_at, i.error_message
     FROM incidents i JOIN sites s ON s.id = i.site_id
     WHERE i.status = 'active'
       AND coalesce(i.last_reminder_at, i.confirmed_at) < now() - ($1 || ' minutes')::interval`,
    [String(settings.alerts.reminderMinutes)],
  );
  for (const row of res.rows) {
    const minutes = Math.round((Date.now() - new Date(row.started_at).getTime()) / 60000);
    await dispatchNotification({
      force: true,
      eventKey: `incident:${row.id}:reminder`,
      subject: "🔴 SITE STILL DOWN",
      body: `${row.name}\n${row.url}\n\nOngoing for ${minutes} minutes.\nReason: ${row.error_message ?? "unknown"}`,
    });
    await query("UPDATE incidents SET last_reminder_at = now() WHERE id = $1", [row.id]);
  }
}
