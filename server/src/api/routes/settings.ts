import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../auth/session.js";
import { getSettings, saveSettings } from "../../settings.js";
import { notificationChannelStatus } from "../../notify/dispatcher.js";

export const settingsRouter: Router = Router();
settingsRouter.use(requireAuth);

const schema = z.object({
  monitoring: z
    .object({
      defaultIntervalSeconds: z.number().int().min(60).max(3600),
      defaultTimeoutMs: z.number().int().min(1000).max(120_000),
      failureThreshold: z.number().int().min(1).max(20),
      warnResponseMs: z.number().int().min(100).max(120_000),
      criticalResponseMs: z.number().int().min(100).max(120_000),
    })
    .partial()
    .optional(),
  ssl: z.object({ warningDays: z.array(z.number().int().min(1).max(365)).max(10) }).partial().optional(),
  alerts: z
    .object({
      remindersEnabled: z.boolean(),
      reminderMinutes: z.number().int().min(5).max(1440),
      dedupeMinutes: z.number().int().min(1).max(1440),
    })
    .partial()
    .optional(),
  vps: z
    .object({
      cpuWarn: z.number().min(1).max(100),
      cpuCritical: z.number().min(1).max(100),
      memWarn: z.number().min(1).max(100),
      memCritical: z.number().min(1).max(100),
      diskWarn: z.number().min(1).max(100),
      diskCritical: z.number().min(1).max(100),
      metricsIntervalSeconds: z.number().int().min(30).max(3600),
    })
    .partial()
    .optional(),
  data: z
    .object({
      rawCheckRetentionDays: z.number().int().min(1).max(365),
      aggregateRetentionDays: z.number().int().min(30).max(3650),
      metricsRetentionDays: z.number().int().min(1).max(365),
    })
    .partial()
    .optional(),
  application: z
    .object({ appName: z.string().min(1).max(80), timezone: z.string().min(1).max(64) })
    .partial()
    .optional(),
});

settingsRouter.get("/", async (_req, res) => {
  res.json({ settings: await getSettings(true), channels: notificationChannelStatus() });
});

settingsRouter.put("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
    return;
  }
  const settings = await saveSettings(parsed.data);
  res.json({ settings });
});
