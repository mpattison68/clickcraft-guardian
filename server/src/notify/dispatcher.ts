import { config } from "../config.js";
import { query } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { getSettings } from "../settings.js";
import { sendEmail } from "./email.js";
import { sendTelegram } from "./telegram.js";

const log = createLogger("notify");

export interface Notification {
  /** Stable key used for deduplication, e.g. `incident:12:opened`. */
  eventKey: string;
  subject: string;
  body: string;
  /** Bypass dedupe window (test notifications). */
  force?: boolean;
}

async function recentlySent(eventKey: string, minutes: number): Promise<boolean> {
  const res = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM notification_events
     WHERE event_key = $1 AND success = true AND created_at > now() - ($2 || ' minutes')::interval`,
    [eventKey, String(minutes)],
  );
  return Number(res.rows[0]?.count ?? 0) > 0;
}

async function record(
  channel: string,
  n: Notification,
  success: boolean,
  errorMessage: string | null,
) {
  await query(
    `INSERT INTO notification_events(channel, event_key, subject, body, success, error_message)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [channel, n.eventKey, n.subject, n.body, success, errorMessage],
  ).catch((e) =>
    log.error("failed to record notification event", {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
}

/**
 * Fan out a notification to all configured channels.
 * Failures are logged and recorded; they never interrupt monitoring.
 */
export async function dispatchNotification(n: Notification): Promise<void> {
  const settings = await getSettings();
  if (!n.force && (await recentlySent(n.eventKey, settings.alerts.dedupeMinutes))) {
    log.info("notification suppressed by dedupe window", { eventKey: n.eventKey });
    return;
  }

  const channels: Array<{ name: string; enabled: boolean; send: () => Promise<void> }> = [
    {
      name: "telegram",
      enabled: config.telegram.configured,
      send: () => sendTelegram(`${n.subject}\n\n${n.body}`),
    },
    {
      name: "email",
      enabled: config.smtp.configured,
      send: () => sendEmail(n.subject, n.body),
    },
  ];

  for (const channel of channels) {
    if (!channel.enabled) continue;
    try {
      await channel.send();
      log.info("notification sent", { channel: channel.name, eventKey: n.eventKey });
      await record(channel.name, n, true, null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log.error("notification failed", { channel: channel.name, eventKey: n.eventKey, message });
      await record(channel.name, n, false, message);
    }
  }
}

export function notificationChannelStatus() {
  return {
    telegram: { configured: config.telegram.configured },
    email: { configured: config.smtp.configured },
  };
}
