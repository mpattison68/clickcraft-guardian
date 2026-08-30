import { config } from "./config.js";
import { pool, query, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { createLogger } from "./logger.js";
import { ensureAdminUser, seedDemoSites } from "./bootstrap.js";
import { runSiteCheck } from "./monitor/engine.js";
import { sendIncidentReminders } from "./monitor/incidents.js";
import { runRetention } from "./monitor/retention.js";
import { collectHostMetrics } from "./host/metrics.js";
import { dockerEnabled, listContainers } from "./host/docker.js";
import { dispatchNotification } from "./notify/dispatcher.js";
import { getSettings } from "./settings.js";
import { purgeExpiredSessions } from "./auth/session.js";
import type { SiteRow } from "./monitor/types.js";

const log = createLogger("worker");

const inFlight = new Set<number>();
let running = true;

async function heartbeat(details: Record<string, unknown>) {
  await query(
    `INSERT INTO worker_heartbeats(worker_name, beat_at, details) VALUES ('monitor', now(), $1)
     ON CONFLICT (worker_name) DO UPDATE SET beat_at = now(), details = EXCLUDED.details`,
    [JSON.stringify(details)],
  ).catch((e) => log.error("heartbeat failed", { error: String(e) }));
}

async function dueSites(limit: number): Promise<SiteRow[]> {
  const res = await query<SiteRow>(
    `SELECT * FROM sites WHERE enabled = true AND next_check_at <= now()
     ORDER BY next_check_at ASC LIMIT $1`,
    [limit],
  );
  return res.rows.filter((s) => !inFlight.has(s.id));
}

async function monitorTick() {
  const sites = await dueSites(config.monitoring.workerConcurrency * 2);
  const queue = [...sites];
  const workers = Array.from({ length: config.monitoring.workerConcurrency }, async () => {
    for (;;) {
      const site = queue.shift();
      if (!site) return;
      inFlight.add(site.id);
      try {
        await runSiteCheck(site);
      } catch (e) {
        log.error("site check crashed", {
          siteId: site.id,
          error: e instanceof Error ? e.message : String(e),
        });
        await query(
          "UPDATE sites SET last_check_at = now(), next_check_at = now() + ($2 || ' seconds')::interval WHERE id = $1",
          [site.id, String(site.interval_seconds)],
        ).catch(() => undefined);
      } finally {
        inFlight.delete(site.id);
      }
    }
  });
  await Promise.all(workers);
  await heartbeat({ lastTick: new Date().toISOString(), checked: sites.length });
}

async function metricsTick() {
  const settings = await getSettings();
  const m = await collectHostMetrics();
  await query(
    `INSERT INTO server_metrics(uptime_seconds, cpu_percent, load1, load5, load15,
       mem_total_bytes, mem_used_bytes, mem_percent, swap_total_bytes, swap_used_bytes,
       disk_total_bytes, disk_used_bytes, disk_percent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      m.uptimeSeconds,
      m.cpuPercent,
      m.load1,
      m.load5,
      m.load15,
      m.memTotalBytes,
      m.memUsedBytes,
      m.memPercent,
      m.swapTotalBytes,
      m.swapUsedBytes,
      m.diskTotalBytes,
      m.diskUsedBytes,
      m.diskPercent,
    ],
  );

  const alerts: Array<[string, number | null, number, number]> = [
    ["CPU", m.cpuPercent, settings.vps.cpuWarn, settings.vps.cpuCritical],
    ["Memory", m.memPercent, settings.vps.memWarn, settings.vps.memCritical],
    ["Disk", m.diskPercent, settings.vps.diskWarn, settings.vps.diskCritical],
  ];
  for (const [label, value, warn, critical] of alerts) {
    if (value === null) continue;
    if (value >= critical) {
      await dispatchNotification({
        eventKey: `vps:${label}:critical`,
        subject: "🔴 VPS RESOURCE CRITICAL",
        body: `${label} usage is ${value}% (critical threshold ${critical}%).`,
      });
    } else if (value >= warn) {
      await dispatchNotification({
        eventKey: `vps:${label}:warning`,
        subject: "🟠 VPS RESOURCE WARNING",
        body: `${label} usage is ${value}% (warning threshold ${warn}%).`,
      });
    }
  }

  if (dockerEnabled()) {
    try {
      const containers = await listContainers();
      for (const c of containers) {
        await query(
          `INSERT INTO docker_container_metrics(container_id, name, image, state, status_text, health, restart_count, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [c.containerId, c.name, c.image, c.state, c.statusText, c.health, c.restartCount, c.startedAt],
        );
      }
    } catch (e) {
      log.warn("docker metrics unavailable", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

function loop(name: string, intervalMs: number, fn: () => Promise<void>) {
  const run = async () => {
    if (!running) return;
    try {
      await fn();
    } catch (e) {
      log.error(`${name} loop error`, { error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (running) setTimeout(run, intervalMs);
    }
  };
  void run();
}

async function main() {
  log.info("monitoring worker starting", { timezone: config.timezone });
  await waitForDatabase();
  await runMigrations();
  await ensureAdminUser();
  await seedDemoSites();

  loop("monitor", config.monitoring.tickIntervalMs, monitorTick);
  loop("metrics", 60_000, metricsTick);
  loop("reminders", 60_000, sendIncidentReminders);
  loop("retention", 3600_000, async () => {
    await runRetention();
    await purgeExpiredSessions();
  });

  log.info("monitoring worker ready");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log.info("worker shutting down", { signal });
    running = false;
    void pool.end().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection in worker", { error: String(reason) });
});

main().catch((e) => {
  log.error("worker failed to start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
