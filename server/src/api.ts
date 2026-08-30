import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import { config } from "./config.js";
import { pool, query, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { ensureAdminUser, seedDemoSites } from "./bootstrap.js";
import { createLogger } from "./logger.js";
import { requireCsrf } from "./auth/session.js";
import { authRouter } from "./api/routes/auth.js";
import { sitesRouter } from "./api/routes/sites.js";
import { dashboardRouter } from "./api/routes/dashboard.js";
import { incidentsRouter } from "./api/routes/incidents.js";
import { notificationsRouter } from "./api/routes/notifications.js";
import { vpsRouter } from "./api/routes/vps.js";
import { settingsRouter } from "./api/routes/settings.js";

const log = createLogger("api");
const app = express();

// Behind Nginx Proxy Manager: honour X-Forwarded-* so client IPs and protocol are correct.
if (config.trustProxy) app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

/**
 * Public health endpoint for external watchdogs.
 * Deliberately exposes no configuration, credentials or host details.
 */
app.get("/api/health", async (_req, res) => {
  let database: "healthy" | "unhealthy" = "unhealthy";
  let worker: "healthy" | "stale" | "unknown" = "unknown";
  try {
    await query("SELECT 1");
    database = "healthy";
    const beat = await query<{ stale: boolean }>(
      "SELECT (beat_at < now() - interval '3 minutes') AS stale FROM worker_heartbeats WHERE worker_name = 'monitor'",
    );
    if (beat.rows[0]) worker = beat.rows[0].stale ? "stale" : "healthy";
  } catch {
    database = "unhealthy";
  }
  const status = database === "healthy" && worker !== "stale" ? "healthy" : "degraded";
  res.status(status === "healthy" ? 200 : 503).json({
    status,
    database,
    worker,
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", requireCsrf);
app.use("/api/auth", authRouter);
app.use("/api/sites", sitesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/incidents", incidentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/vps", vpsRouter);
app.use("/api/settings", settingsRouter);

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// Serve the built single-page frontend when present (production image).
const here = dirname(fileURLToPath(import.meta.url));
const staticDir = resolve(here, "../public");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  app.get("*", (_req, res) => res.sendFile(join(staticDir, "index.html")));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled API error", { error: err.message });
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await waitForDatabase();
  await runMigrations();
  await ensureAdminUser();
  await seedDemoSites();
  app.listen(config.port, () => {
    log.info("api listening", { port: config.port, env: config.env, timezone: config.timezone });
  });
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log.info("api shutting down", { signal });
    void pool.end().finally(() => process.exit(0));
  });
}

process.on("unhandledRejection", (reason) => {
  log.error("unhandled rejection in api", { error: String(reason) });
});

main().catch((e) => {
  log.error("api failed to start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
