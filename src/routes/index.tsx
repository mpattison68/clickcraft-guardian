import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { SummaryCard } from "@/components/monitor/SummaryCard";
import { apiGet, apiPost } from "@/lib/api";
import { ms, relativeTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ClickCraft Site Monitor" },
      {
        name: "description",
        content: "Live availability, SSL, DNS and performance status for every monitored ClickCraft site.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Dashboard — ClickCraft Site Monitor" },
      { property: "og:description", content: "Live availability, SSL, DNS and performance status of all monitored sites." },
    ],
  }),
  component: DashboardPage,
});

interface DashboardSite {
  id: number;
  name: string;
  url: string;
  hostname: string;
  status: string;
  enabled: boolean;
  last_check_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  http_status: number | null;
  response_ms: number | null;
  ssl_status: string | null;
  ssl_days_remaining: number | null;
  dns_status: string | null;
}

interface DashboardResponse {
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
    disabled: number;
    activeIncidents: number;
    sslExpiringSoon: number;
  };
  sites: DashboardSite[];
}

function DashboardPage() {
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardResponse>("/dashboard"),
    refetchInterval: 30_000,
  });

  const runCheck = useMutation({
    mutationFn: (id: number) => apiPost(`/sites/${id}/check`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });

  const s = dashboard.data?.summary;

  return (
    <AppShell
      title="Dashboard"
      actions={
        <button
          onClick={() => dashboard.refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
        >
          <RefreshCw className={`size-3.5 ${dashboard.isFetching ? "animate-spin" : ""}`} /> Refresh
        </button>
      }
    >
      {dashboard.isError ? (
        <div className="panel mb-4 flex items-center gap-2 p-4 text-sm text-critical">
          <ShieldAlert className="size-4" /> Unable to reach the monitoring API.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Total sites" value={s?.total ?? "—"} />
        <SummaryCard label="Healthy" value={s?.healthy ?? "—"} tone="healthy" />
        <SummaryCard label="Warning" value={s?.warning ?? "—"} tone="warning" />
        <SummaryCard label="Critical" value={s?.critical ?? "—"} tone="critical" />
        <SummaryCard label="Active incidents" value={s?.activeIncidents ?? "—"} tone={s?.activeIncidents ? "critical" : "neutral"} />
        <SummaryCard label="SSL expiring" value={s?.sslExpiringSoon ?? "—"} tone={s?.sslExpiringSoon ? "warning" : "neutral"} />
      </div>

      <div className="panel mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">HTTP</th>
                <th className="px-3 py-2">Response</th>
                <th className="px-3 py-2">SSL</th>
                <th className="px-3 py-2">SSL days</th>
                <th className="px-3 py-2">DNS</th>
                <th className="px-3 py-2">Last success</th>
                <th className="px-3 py-2">Last checked</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(dashboard.data?.sites ?? []).map((site) => (
                <tr key={site.id} className="border-t border-border hover:bg-secondary/40">
                  <td className="px-3 py-2">
                    <Link to="/sites/$id" params={{ id: String(site.id) }} className="font-medium hover:text-primary">
                      {site.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{site.hostname}</div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={site.enabled ? site.status : "disabled"} />
                  </td>
                  <td className="numeric px-3 py-2">{site.http_status ?? "—"}</td>
                  <td className="numeric px-3 py-2">{ms(site.response_ms)}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={site.ssl_status ?? "unknown"} />
                  </td>
                  <td className="numeric px-3 py-2">{site.ssl_days_remaining ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={site.dns_status ?? "unknown"} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{relativeTime(site.last_success_at)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{relativeTime(site.last_check_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => runCheck.mutate(site.id)}
                      disabled={runCheck.isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary disabled:opacity-60"
                    >
                      <RefreshCw className="size-3" /> Check now
                    </button>
                  </td>
                </tr>
              ))}
              {dashboard.data && dashboard.data.sites.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No sites yet.{" "}
                    <Link to="/sites" className="text-primary hover:underline">
                      Add your first website
                    </Link>{" "}
                    to begin monitoring.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
