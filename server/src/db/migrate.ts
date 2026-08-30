import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pool, query, waitForDatabase } from "./pool.js";
import { createLogger } from "../logger.js";

const log = createLogger("migrate");

const here = dirname(fileURLToPath(import.meta.url));

/** Advisory lock id so API and worker never apply migrations concurrently on boot. */
const MIGRATION_LOCK_ID = 8123471;

function migrationsDir(): string {
  const candidates = [
    join(here, "migrations"), // compiled: dist/db/migrations (copied at build time)
    resolve(here, "../../src/db/migrations"), // running from dist during local dev
    resolve(here, "../../../server/src/db/migrations"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`migrations directory not found (looked in: ${candidates.join(", ")})`);
}

export async function runMigrations(): Promise<void> {
  await waitForDatabase();
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  // Serialise migration runs across every process/container.
  const lockClient = await pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

    const applied = new Set(
      (await query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      log.info("applying migration", { file });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    }
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    lockClient.release();
  }
  log.info("migrations up to date", { count: files.length });
}


const invokedDirectly = process.argv[1] && process.argv[1].includes("migrate");
if (invokedDirectly) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      log.error("migration failed", { error: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    });
}
