import type { Health } from "@/lib/format";

type Pill = { label: string; dot: string; text: string; bg: string };
const FALLBACK: Pill = { label: "Unknown", dot: "bg-unknown", text: "text-unknown", bg: "bg-unknown-soft/40" };
const MAP: Record<string, Pill> = {
  healthy: { label: "Healthy", dot: "bg-healthy", text: "text-healthy", bg: "bg-healthy-soft/40" },
  warning: { label: "Warning", dot: "bg-warning", text: "text-warning", bg: "bg-warning-soft/40" },
  critical: { label: "Critical", dot: "bg-critical", text: "text-critical", bg: "bg-critical-soft/40" },
  changed: { label: "Changed", dot: "bg-warning", text: "text-warning", bg: "bg-warning-soft/40" },
  failed: { label: "Failed", dot: "bg-critical", text: "text-critical", bg: "bg-critical-soft/40" },
  active: { label: "Active", dot: "bg-critical", text: "text-critical", bg: "bg-critical-soft/40" },
  resolved: { label: "Resolved", dot: "bg-healthy", text: "text-healthy", bg: "bg-healthy-soft/40" },
  disabled: { label: "Disabled", dot: "bg-unknown", text: "text-unknown", bg: "bg-unknown-soft/40" },
  unknown: { label: "Unknown", dot: "bg-unknown", text: "text-unknown", bg: "bg-unknown-soft/40" },
};

export function StatusPill({ status, label }: { status: Health; label?: string }) {
  const s = MAP[String(status)] ?? FALLBACK;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}
    >
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

export function StatusDot({ status }: { status: Health }) {
  const s = MAP[String(status)] ?? FALLBACK;
  return <span className={`inline-block size-2.5 rounded-full ${s.dot}`} title={s.label} />;
}
