import { Router } from "express";
import { query } from "../../db/pool.js";
import { requireAuth } from "../../auth/session.js";

export const incidentsRouter: Router = Router();
incidentsRouter.use(requireAuth);

incidentsRouter.get("/", async (req, res) => {
  const status = String(req.query.status ?? "all");
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const rows = await query(
    `SELECT i.*, s.name AS site_name, s.url AS site_url, e.name AS endpoint_name
     FROM incidents i
     JOIN sites s ON s.id = i.site_id
     LEFT JOIN endpoints e ON e.id = i.endpoint_id
     WHERE ($1 = 'all' OR i.status = $1)
       AND ($2::bigint IS NULL OR i.site_id = $2)
     ORDER BY i.started_at DESC LIMIT 300`,
    [status, siteId],
  );
  res.json({ incidents: rows.rows });
});

incidentsRouter.get("/:id", async (req, res) => {
  const rows = await query(
    `SELECT i.*, s.name AS site_name, s.url AS site_url FROM incidents i
     JOIN sites s ON s.id = i.site_id WHERE i.id = $1`,
    [Number(req.params.id)],
  );
  if (!rows.rows[0]) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json({ incident: rows.rows[0] });
});

incidentsRouter.delete("/:id", async (req, res) => {
  await query("DELETE FROM incidents WHERE id = $1", [Number(req.params.id)]);
  res.json({ ok: true });
});
