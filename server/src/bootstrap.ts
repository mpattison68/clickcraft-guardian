import { config } from "./config.js";
import { query } from "./db/pool.js";
import { hashPassword } from "./auth/passwords.js";
import { createLogger } from "./logger.js";

const log = createLogger("bootstrap");

/**
 * Create the initial administrator from server-side environment configuration.
 * Credentials are never hard-coded and never leave the server.
 */
export async function ensureAdminUser(): Promise<void> {
  const existing = await query<{ count: string }>("SELECT count(*)::text AS count FROM users");
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  if (!config.admin.email || !config.admin.password) {
    log.warn(
      "no administrator exists and ADMIN_EMAIL / ADMIN_PASSWORD are not configured — set them in .env and restart",
    );
    return;
  }
  if (config.admin.password.length < 12) {
    log.error("ADMIN_PASSWORD must be at least 12 characters; administrator not created");
    return;
  }
  const hash = await hashPassword(config.admin.password);
  await query("INSERT INTO users(email, password_hash, role) VALUES ($1,$2,'admin')", [
    config.admin.email.toLowerCase(),
    hash,
  ]);
  log.info("initial administrator created", { email: config.admin.email });
}

const DEMO_SITES = [
  { name: "Flightpath Wealth", url: "https://wealth.clickcraft.tech" },
  { name: "Transcript", url: "https://transcript.clickcraft.tech" },
  { name: "Trip Balance", url: "https://trip-balance.clickcraft.tech" },
  { name: "Compliance", url: "https://compliance.clickcraft.tech" },
  { name: "Robin Hood Foundation", url: "https://robinhoodfoundation.co.za" },
];

/**
 * Optional demonstration sites, only created when SEED_DEMO_SITES=true.
 * They are ordinary rows and are monitored for real; delete them in the UI when done.
 */
export async function seedDemoSites(): Promise<void> {
  if (!config.seedDemoSites) return;
  const existing = await query<{ count: string }>("SELECT count(*)::text AS count FROM sites");
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;
  for (const s of DEMO_SITES) {
    await query(
      `INSERT INTO sites(name, url, hostname, description) VALUES ($1,$2,$3,$4)`,
      [s.name, s.url, new URL(s.url).hostname, "Seeded demonstration site — safe to delete"],
    );
  }
  log.info("demo sites seeded", { count: DEMO_SITES.length });
}
