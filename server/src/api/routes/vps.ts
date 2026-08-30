import { Router } from "express";
import { query } from "../../db/pool.js";
import { requireAuth } from "../../auth/session.js";
import { collectHostMetrics } from "../../host/metrics.js";
import { dockerEnabled } from "../../host/docker.js";
import { getSettings } from "../../settings.js";

export const vpsRouter: Router = Router();
vpsRouter.use(requireAuth);

vpsRouter.get("/", async (req, res) => {
  const range = String(req.query.range ?? "24h");
  const intervals: Record<string, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
  const interval = intervals[range] ?? "24 hours";

  const [latest, history, containers, settings] = await Promise.all([
    query("SELECT * FROM server_metrics ORDER BY collected_at DESC LIMIT 1"),
    query(
      `SELECT collected_at, cpu_percent, mem_percent, disk_percent, load1
       FROM server_metrics WHERE collected_at > now() - $1::interval
       ORDER BY collected_at ASC LIMIT 2000`,
      [interval],
    ),
    query(
      `SELECT DISTINCT ON (container_id) container_id, name, image, state, status_text, health,
              restart_count, started_at, collected_at
       FROM docker_container_metrics
       WHERE collected_at > now() - interval '10 minutes'
       ORDER BY container_id, collected_at DESC`,
    ),
    getSettings(),
  ]);

  const current = latest.rows[0] ?? (await collectHostMetrics());
  res.json({
    current,
    history: history.rows,
    containers: containers.rows,
    dockerEnabled: dockerEnabled(),
    thresholds: settings.vps,
  });
});
