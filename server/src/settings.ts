import { query } from "./db/pool.js";
import { config } from "./config.js";

export interface AppSettings {
  monitoring: {
    defaultIntervalSeconds: number;
    defaultTimeoutMs: number;
    failureThreshold: number;
    warnResponseMs: number;
    criticalResponseMs: number;
  };
  ssl: {
    warningDays: number[];
  };
  alerts: {
    remindersEnabled: boolean;
    reminderMinutes: number;
    dedupeMinutes: number;
  };
  vps: {
    cpuWarn: number;
    cpuCritical: number;
    memWarn: number;
    memCritical: number;
    diskWarn: number;
    diskCritical: number;
    metricsIntervalSeconds: number;
  };
  data: {
    rawCheckRetentionDays: number;
    aggregateRetentionDays: number;
    metricsRetentionDays: number;
  };
  application: {
    appName: string;
    timezone: string;
  };
}

export const defaultSettings: AppSettings = {
  monitoring: {
    defaultIntervalSeconds: 60,
    defaultTimeoutMs: 10_000,
    failureThreshold: 3,
    warnResponseMs: 1500,
    criticalResponseMs: 3000,
  },
  ssl: { warningDays: [30, 14, 7, 3, 1] },
  alerts: { remindersEnabled: true, reminderMinutes: 60, dedupeMinutes: 30 },
  vps: {
    cpuWarn: 80,
    cpuCritical: 95,
    memWarn: 80,
    memCritical: 90,
    diskWarn: 80,
    diskCritical: 90,
    metricsIntervalSeconds: 60,
  },
  data: { rawCheckRetentionDays: 30, aggregateRetentionDays: 365, metricsRetentionDays: 30 },
  application: { appName: config.appName, timezone: config.timezone },
};

function merge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object") return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

let cache: { value: AppSettings; at: number } | null = null;

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.value;
  const res = await query<{ value: AppSettings }>(
    "SELECT value FROM application_settings WHERE key = 'app'",
  );
  const value = merge(defaultSettings, res.rows[0]?.value ?? {});
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(true);
  const next = merge(current, patch);
  await query(
    `INSERT INTO application_settings(key, value, updated_at) VALUES ('app', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  cache = { value: next, at: Date.now() };
  return next;
}
