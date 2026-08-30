import pg from "pg";
import { config, connectionString } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("db");

export const pool = new pg.Pool({
  connectionString: connectionString(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: config.appName,
});

pool.on("error", (err) => {
  log.error("idle client error", { error: err.message });
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function withTransaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Wait for Postgres to accept connections; used on boot so containers can start in any order. */
export async function waitForDatabase(attempts = 60, delayMs = 2000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("select 1");
      log.info("database connection established");
      return;
    } catch (e) {
      log.warn("database not ready, retrying", {
        attempt: i,
        error: e instanceof Error ? e.message : String(e),
      });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("database unavailable after retries");
}
