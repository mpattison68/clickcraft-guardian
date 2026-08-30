export type Health = "healthy" | "warning" | "critical" | "unknown" | "disabled" | string;

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  const diff = Math.round((Date.now() - then) / 1000);
  if (!Number.isFinite(diff)) return "never";
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function bytes(value: number | null | undefined): string {
  if (!value && value !== 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(value);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { hour12: false });
}

export function percent(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(digits)}%`;
}
