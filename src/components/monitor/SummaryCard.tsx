import type { ReactNode } from "react";

export function SummaryCard({
  label,
  value,
  tone = "neutral",
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "healthy" | "warning" | "critical";
  hint?: string;
  icon?: ReactNode;
}) {
  const toneClass = {
    neutral: "text-foreground",
    healthy: "text-healthy",
    warning: "text-warning",
    critical: "text-critical",
  }[tone];

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className={`numeric mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
