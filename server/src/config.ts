/**
 * Central environment configuration.
 * All values are read from the server-side environment only.
 * Nothing in this module may ever be returned to the browser.
 */

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    return "";
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  env: str("NODE_ENV", "development"),
  isProd: str("NODE_ENV", "development") === "production",
  port: num("APP_PORT", 4000),
  publicUrl: str("APP_PUBLIC_URL", "http://localhost:4000"),
  timezone: str("APP_TIMEZONE", "Africa/Johannesburg"),
  appName: str("APP_NAME", "ClickCraft Site Monitor"),
  trustProxy: bool("TRUST_PROXY", true),

  database: {
    url: str("DATABASE_URL", ""),
    host: str("POSTGRES_HOST", "db"),
    port: num("POSTGRES_PORT", 5432),
    name: str("POSTGRES_DB", "clickcraft_monitor"),
    user: str("POSTGRES_USER", "clickcraft"),
    password: str("POSTGRES_PASSWORD", ""),
  },

  auth: {
    sessionSecret: str("SESSION_SECRET", ""),
    sessionTtlHours: num("SESSION_TTL_HOURS", 12),
    cookieName: "ccsm_session",
    loginRateLimitMax: num("LOGIN_RATE_LIMIT_MAX", 8),
    loginRateLimitWindowMs: num("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  },

  admin: {
    email: str("ADMIN_EMAIL", ""),
    password: str("ADMIN_PASSWORD", ""),
  },

  telegram: {
    botToken: str("TELEGRAM_BOT_TOKEN", ""),
    chatId: str("TELEGRAM_CHAT_ID", ""),
    get configured() {
      return Boolean(str("TELEGRAM_BOT_TOKEN", "") && str("TELEGRAM_CHAT_ID", ""));
    },
  },

  smtp: {
    host: str("SMTP_HOST", ""),
    port: num("SMTP_PORT", 587),
    user: str("SMTP_USER", ""),
    password: str("SMTP_PASSWORD", ""),
    secure: bool("SMTP_SECURE", false),
    requireTls: bool("SMTP_REQUIRE_TLS", true),
    from: str("SMTP_FROM", ""),
    to: str("ALERT_EMAIL_TO", ""),
    get configured() {
      return Boolean(str("SMTP_HOST", "") && str("SMTP_FROM", "") && str("ALERT_EMAIL_TO", ""));
    },
  },

  monitoring: {
    workerConcurrency: num("WORKER_CONCURRENCY", 8),
    tickIntervalMs: num("WORKER_TICK_INTERVAL_MS", 10_000),
    /** Allow monitoring of private/loopback ranges (SSRF guard override). */
    allowPrivateTargets: bool("ALLOW_PRIVATE_TARGETS", false),
    /** Comma separated list of explicitly allowed hostnames even if private. */
    privateAllowlist: str("PRIVATE_TARGET_ALLOWLIST", "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    dockerSocket: str("DOCKER_SOCKET_PATH", ""),
    hostProcPath: str("HOST_PROC_PATH", "/proc"),
    hostRootPath: str("HOST_ROOT_PATH", "/"),
  },

  seedDemoSites: bool("SEED_DEMO_SITES", false),
} as const;

export function connectionString(): string {
  if (config.database.url) return config.database.url;
  const { user, password, host, port, name } = config.database;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}
