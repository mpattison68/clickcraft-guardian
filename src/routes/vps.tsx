import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { SummaryCard } from "@/components/monitor/SummaryCard";
import { apiGet } from "@/lib/api";
import { bytes, dateTime, duration, percent } from "@/lib/format";

export const Route = createFileRoute("/vps")({
  head: () => ({
    meta: [
      { title: "VPS Health — ClickCraft Site Monitor" },
      { name: "description", content: "CPU, memory, disk, load and Docker container health for the ClickCraft Hostinger VPS." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "VPS Health — ClickCraft Site Monitor" },
      { property: "og:description", content: "Server resource usage and Docker container status." },
    ],
  }),
  component: VpsPage,
});

interface VpsResponse {
  current: {
    collected_at?: string;
    uptime_seconds: number | null;
    cpu_percent: string | number | null;
    load1: string | number | null;
    mem_total_bytes: number | null;
    mem_used_bytes: number | null;
    mem_percent: string | number | null;
    swap_total_bytes: number | null;
    swap_used_bytes: number | null;
    disk_total_bytes: number | null;
    disk_used_bytes: number | null;
    disk_percent: string | number | null;
  };
  history: Array<{ collected_at: string; cpu_percent: string | null; mem_percent: string | null; disk_percent: string | null }>;
  containers: Array<{
    container_id: string;
    name: string;
    state: string | null;
    status_text: string | null;
    health: string | null;
    restart_count: number | null;
    started_at: string | null;
  }>;
  dockerEnabled: boolean;
  thresholds: { cpuWarn: number; cpuCritical: number; memWarn: number; memCritical: number; diskWarn: number; diskCritical: number };
}

function tone(value: number | null, warn: number, critical: number) {
  if (value === null) return "neutral" as const;
  if (value >= critical) return "critical" as const;
  if (value >= warn) return "warning" as const;
  return "healthy" as const;
}

function VpsPage() {
  const [range, setRange] = useState("24h");
  const vps = useQuery({
    queryKey: ["vps", range],
    queryFn: () => apiGet<VpsResponse>(`/vps?range=${range}`),
    refetchInterval: 60_000,
  });

  const c = vps.data?.current;
  const t = vps.data?.thresholds;
  const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
  const chart = (vps.data?.history ?? []).map((h) => ({
    t: new Date(h.collected_at).toLocaleTimeString(undefined, { hour12: false }),
    cpu: h.cpu_percent === null ? null : Number(h.cpu_percent),
    mem: h.mem_percent === null ? null : Number(h.mem_percent),
    disk: h.disk_percent === null ? null : Number(h.disk_percent),
  }));

  return (
    <AppShell
      title="VPS Health"
      actions={
        <div className="flex gap-1 text-xs">
          {["1h", "24h", "7d", "30d"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2 py-1 ${range === r ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {r}
            </button>
          ))}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Host uptime" value={duration(c?.uptime_seconds ?? null)} />
        <SummaryCard
          label="CPU"
          value={percent(num(c?.cpu_percent))}
          tone={tone(num(c?.cpu_percent), t?.cpuWarn ?? 80, t?.cpuCritical ?? 95)}
          hint={`load ${num(c?.load1)?.toFixed(2) ?? "—"}`}
        />
        <SummaryCard
          label="Memory"
          value={percent(num(c?.mem_percent))}
          tone={tone(num(c?.mem_percent), t?.memWarn ?? 80, t?.memCritical ?? 90)}
          hint={`${bytes(c?.mem_used_bytes)} of ${bytes(c?.mem_total_bytes)}`}
        />
        <SummaryCard
          label="Disk (root)"
          value={percent(num(c?.disk_percent))}
          tone={tone(num(c?.disk_percent), t?.diskWarn ?? 80, t?.diskCritical ?? 90)}
          hint={`${bytes(c?.disk_used_bytes)} of ${bytes(c?.disk_total_bytes)}`}
        />
      </div>

      {c?.swap_total_bytes ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Swap: {bytes(c.swap_used_bytes)} of {bytes(c.swap_total_bytes)} used.
        </p>
      ) : null}

      <div className="panel mt-4 p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Resource usage</div>
        {chart.length < 3 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Collecting metrics — charts appear once enough samples exist.
          </p>
        ) : (
          <div className="mt-3 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={50} stroke="var(--color-muted-foreground)" />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" stroke="var(--color-muted-foreground)" />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 12 }} />
                <Area type="monotone" dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} />
                <Area type="monotone" dataKey="mem" stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.15} />
                <Area type="monotone" dataKey="disk" stroke="var(--color-chart-3)" fill="var(--color-chart-3)" fillOpacity={0.1} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="panel mt-4 overflow-hidden">
        <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          Docker containers
        </div>
        {!vps.data?.dockerEnabled ? (
          <p className="p-6 text-sm text-muted-foreground">
            Docker monitoring is disabled. Mount the Docker socket read-only and set DOCKER_SOCKET_PATH in the server
            environment to enable it (see the deployment README for the security implications).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Container</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Health</th>
                <th className="px-3 py-2">Restarts</th>
                <th className="px-3 py-2">Started</th>
              </tr>
            </thead>
            <tbody>
              {(vps.data?.containers ?? []).map((ct) => (
                <tr key={ct.container_id} className="border-t border-border">
                  <td className="px-3 py-2">{ct.name}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={ct.state === "running" ? "healthy" : "critical"} label={ct.status_text ?? ct.state ?? "unknown"} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{ct.health ?? "—"}</td>
                  <td className="numeric px-3 py-2">{ct.restart_count ?? "—"}</td>
                  <td className="numeric px-3 py-2">{dateTime(ct.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
