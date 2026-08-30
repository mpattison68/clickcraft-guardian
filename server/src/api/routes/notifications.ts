import { Router } from "express";
import { query } from "../../db/pool.js";
import { requireAuth } from "../../auth/session.js";
import { dispatchNotification, notificationChannelStatus } from "../../notify/dispatcher.js";
import { sendEmail } from "../../notify/email.js";
import { sendTelegram } from "../../notify/telegram.js";
import { config } from "../../config.js";
import { getSettings } from "../../settings.js";

export const notificationsRouter: Router = Router();
notificationsRouter.use(requireAuth);

/** Status only — secret values are never returned to the browser. */
notificationsRouter.get("/status", async (_req, res) => {
  const settings = await getSettings();
  res.json({
    channels: notificationChannelStatus(),
    reminders: settings.alerts,
  });
});

notificationsRouter.get("/events", async (_req, res) => {
  const rows = await query(
    `SELECT id, created_at, channel, event_key, subject, success, error_message
     FROM notification_events ORDER BY created_at DESC LIMIT 200`,
  );
  res.json({ events: rows.rows });
});

notificationsRouter.post("/test/:channel", async (req, res) => {
  const channel = req.params.channel;
  const subject = "✅ ClickCraft Site Monitor test notification";
  const body = `Test notification sent from ${config.appName} at ${new Date().toISOString()}.`;
  try {
    if (channel === "telegram") {
      if (!config.telegram.configured) throw new Error("Telegram is not configured on the server");
      await sendTelegram(`${subject}\n\n${body}`);
    } else if (channel === "email") {
      if (!config.smtp.configured) throw new Error("SMTP is not configured on the server");
      await sendEmail(subject, body);
    } else {
      res.status(400).json({ error: "Unknown channel" });
      return;
    }
    await query(
      `INSERT INTO notification_events(channel, event_key, subject, body, success) VALUES ($1,'test',$2,$3,true)`,
      [channel, subject, body],
    );
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Test notification failed";
    await query(
      `INSERT INTO notification_events(channel, event_key, subject, body, success, error_message)
       VALUES ($1,'test',$2,$3,false,$4)`,
      [channel, subject, body, message],
    ).catch(() => undefined);
    res.status(502).json({ error: message });
  }
});

notificationsRouter.post("/test-broadcast", async (_req, res) => {
  await dispatchNotification({
    force: true,
    eventKey: "test:broadcast",
    subject: "✅ ClickCraft Site Monitor test",
    body: "All configured notification channels received this test message.",
  });
  res.json({ ok: true });
});
