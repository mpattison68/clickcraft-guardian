/** Structured JSON logging to stdout/stderr (visible via `docker compose logs`). */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /(password|token|secret|authorization|cookie|apikey|api_key)/i;

function redact(meta: Record<string, unknown> | undefined) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  }
  return out;
}

function emit(level: Level, service: string, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service,
    message,
    ...(redact(meta) ?? {}),
  });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export function createLogger(service: string) {
  return {
    debug: (m: string, meta?: Record<string, unknown>) => emit("debug", service, m, meta),
    info: (m: string, meta?: Record<string, unknown>) => emit("info", service, m, meta),
    warn: (m: string, meta?: Record<string, unknown>) => emit("warn", service, m, meta),
    error: (m: string, meta?: Record<string, unknown>) => emit("error", service, m, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
