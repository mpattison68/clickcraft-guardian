import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { apiGet, apiPost } from "@/lib/api";
import { dateTime, duration, ms, percent, relativeTime } from "@/lib/format";

export const Route = createFileRoute("/sites/$id")({
  head: () => ({
    meta: [
      { title: "Site detail — ClickCraft Site Monitor" },
      { name: "description", content: "Availability, endpoints, performance, uptime, SSL, DNS, security and check history for a monitored site." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Site detail — ClickCraft Site Monitor" },
      { property: "og:description", content: "Detailed monitoring results for a single monitored website." },
    ],
  }),
  component: SiteDetailPage,
});

const TABS = ["Overview", "Endpoints", "Performance", "Uptime", "SSL", "DNS", "Security", "History"] as const;
type Tab = (typeof TABS)[number];

interface SiteDetail {
  site: {
    id: number;
    name: string;
    url: string;
    hostname: string;
    status: string;
    enabled: boolean;
    last_check_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
    interval_seconds: number;
    failure_threshold: number;
  };
  endpoints: Array<{
    id: number;
    name: string;
    path: string;
    status: string;
    is_critical: boolean;
    enabled: boolean;
    last_check_at: string | null;
    last_error: string | null;
  }>;
  ssl: Array<{
    id: number;
    checked_at: string;
    status: string;
    issuer: string | null;
    subject: string | null;
    valid_from: string | null;
    valid_to: string | null;
    days_remaining: number | null;
    hostname_match: boolean | null;
    chain_valid: boolean | null;
    handshake_ok: boolean;
    error_message: string | null;
  }>;
  dns: Array<{
    id: number;
    checked_at: string;
    status: string;
    a_records: string[];
    aaaa_records: string[];
    cname_records: string[];
    changed: boolean;
  }>;
  dnsBaseline: { a_records: string[]; aaaa_records: string[]; accepted_at: string } | null;
  security: { checked_at: string; findings: Array<{ label: string; status: string; value: string | null; explanation: string }> } | null;
  activeIncident: { id: number; type: string; started_at: string; error_message: string | null } | null;
  uptime: { d1: string; d7: string; d30: string; checks_24h: string; avg24: string | null; avg7d: string | null; avg30d: string | null };
}

function SiteDetailPage() {
  const { id } = useParams({ from: "/sites/$id" });
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");
  const [range, setRange] = useState("24h");

  const detail = useQuery({
    queryKey: ["site", id],
    queryFn: () => apiGet<SiteDetail>(`/sites/${id}`),
    refetchInterval: 30_000,
  });
  const history = useQuery({
    queryKey: ["site-history", id, range],
    queryFn: () =>
      apiGet<{ checks: Array<{ checked_at: string; response_ms: number | null; success: boolean; http_status: number | null; status: string; error_message: string | null }> }>(
        `/sites/${id}/history?range=${range}`,
      ),
  });

  const check = useMutation({
    mutationFn: () => apiPost(`/sites/${id}/check`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["site", id] });
      void queryClient.invalidateQueries({ queryKey: ["site-history", id] });
    },
  });
  const acceptDns = useMutation({
    mutationFn: () => apiPost(`/sites/${id}/dns-baseline`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", id] }),
  });

  const d = detail.data;
  const latestSsl = d?.ssl[0];
  const latestDns = d?.dns[0];
  const chartData = (history.data?.checks ?? [])
    .filter((c) => c.response_ms !== null)
    .map((c) => ({ t: new Date(c.checked_at).toLocaleTimeString(undefined, { hour12: false }), ms: c.response_ms }));

  return (
    <AppShell
      title={d?.site.name ?? "Site"}
      actions={
        <>
          <Link to="/sites" className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary">
            <ArrowLeft className="size-3.5" /> Sites
          </Link>
          <button
            onClick={() => check.mutate()}
            disabled={check.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${check.isPending ? "animate-spin" : ""}`} /> Run check now
          </button>
        </>
      }
    >
      {!d ? (
        <div className="text-sm text-muted-foreground">Loading site…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status={d.site.enabled ? d.site.status : "disabled"} />
            <a href={d.site.url} target="_blank" rel="noreferrer noopener" className="text-sm text-primary hover:underline">
              {d.site.url}
            </a>
            <span className="text-xs text-muted-foreground">
              Checked {relativeTime(d.site.last_check_at)} · interval {d.site.interval_seconds}s · incident after{" "}
              {d.site.failure_threshold} failures
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs ${
                  tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === "Overview" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Info label="Overall status" value={<StatusPill status={d.site.enabled ? d.site.status : "disabled"} />} />
                <Info label="Last HTTP status" value={history.data?.checks.at(-1)?.http_status ?? "—"} />
                <Info label="Last response time" value={ms(history.data?.checks.at(-1)?.response_ms ?? null)} />
                <Info label="Consecutive failures" value={d.site.consecutive_failures} />
                <Info label="SSL" value={<StatusPill status={latestSsl?.status ?? "unknown"} />} />
                <Info label="SSL expires" value={latestSsl?.valid_to ? `${latestSsl.days_remaining} days (${dateTime(latestSsl.valid_to)})` : "—"} />
                <Info label="DNS" value={<StatusPill status={latestDns?.status ?? "unknown"} />} />
                <Info label="Last success" value={relativeTime(d.site.last_success_at)} />
                <div className="panel p-4 md:col-span-2 xl:col-span-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Current incident</div>
                  {d.activeIncident ? (
                    <div className="mt-2 text-sm">
                      <span className="text-critical">#{d.activeIncident.id}</span> {d.activeIncident.type.replace(/_/g, " ")} —{" "}
                      {d.activeIncident.error_message ?? ""}{" "}
                      <span className="text-muted-foreground">
                        (open for {duration(Math.round((Date.now() - new Date(d.activeIncident.started_at).getTime()) / 1000))})
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">No active incident.</div>
                  )}
                  {d.site.last_error ? (
                    <div className="mt-2 text-xs text-muted-foreground">Last error: {d.site.last_error}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tab === "Endpoints" ? (
              <div className="panel overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Endpoint</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Criticality</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Last checked</th>
                      <th className="px-3 py-2">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.endpoints.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-3 py-2">{e.name}</td>
                        <td className="numeric px-3 py-2 text-muted-foreground">{e.path}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.is_critical ? "Critical" : "Non-critical"}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={e.enabled ? e.status : "disabled"} />
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{relativeTime(e.last_check_at)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{e.last_error ?? "—"}</td>
                      </tr>
                    ))}
                    {d.endpoints.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          Only the primary URL is monitored for this site.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}

            {tab === "Performance" ? (
              <div className="panel p-4">
                <div className="mb-3 flex gap-1 text-xs">
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
                {chartData.length < 3 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Not enough monitoring history yet for this period.
                  </p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} stroke="var(--color-muted-foreground)" />
                        <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" unit="ms" />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-card)",
                            border: "1px solid var(--color-border)",
                            fontSize: 12,
                          }}
                        />
                        <Line type="monotone" dataKey="ms" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <Info label="24h average" value={ms(d.uptime.avg24 ? Number(d.uptime.avg24) : null)} />
                  <Info label="7d average" value={ms(d.uptime.avg7d ? Number(d.uptime.avg7d) : null)} />
                  <Info label="30d average" value={ms(d.uptime.avg30d ? Number(d.uptime.avg30d) : null)} />
                </div>
              </div>
            ) : null}

            {tab === "Uptime" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Info label="Uptime — 24 hours" value={percent(Number(d.uptime.d1), 2)} />
                <Info label="Uptime — 7 days" value={percent(Number(d.uptime.d7), 2)} />
                <Info label="Uptime — 30 days" value={percent(Number(d.uptime.d30), 2)} />
              </div>
            ) : null}

            {tab === "SSL" ? (
              <div className="space-y-3">
                {latestSsl ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Info label="Status" value={<StatusPill status={latestSsl.status} />} />
                    <Info label="Issuer" value={latestSsl.issuer ?? "—"} />
                    <Info label="Subject" value={latestSsl.subject ?? "—"} />
                    <Info label="Days remaining" value={latestSsl.days_remaining ?? "—"} />
                    <Info label="Valid from" value={dateTime(latestSsl.valid_from)} />
                    <Info label="Valid to" value={dateTime(latestSsl.valid_to)} />
                    <Info label="Hostname match" value={latestSsl.hostname_match ? "Yes" : "No"} />
                    <Info label="Chain valid" value={latestSsl.chain_valid ? "Yes" : "No"} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No SSL results recorded yet.</p>
                )}
                <div className="panel overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Checked</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Days remaining</th>
                        <th className="px-3 py-2">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.ssl.map((s) => (
                        <tr key={s.id} className="border-t border-border">
                          <td className="numeric px-3 py-2">{dateTime(s.checked_at)}</td>
                          <td className="px-3 py-2">
                            <StatusPill status={s.status} />
                          </td>
                          <td className="numeric px-3 py-2">{s.days_remaining ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{s.error_message ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {tab === "DNS" ? (
              <div className="space-y-3">
                <div className="panel p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Current records</div>
                      <div className="numeric mt-1 text-sm">A: {latestDns?.a_records.join(", ") || "—"}</div>
                      <div className="numeric text-sm">AAAA: {latestDns?.aaaa_records.join(", ") || "—"}</div>
                      <div className="numeric text-sm">CNAME: {latestDns?.cname_records.join(", ") || "—"}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        Baseline: {d.dnsBaseline ? `${d.dnsBaseline.a_records.join(", ")} (accepted ${dateTime(d.dnsBaseline.accepted_at)})` : "not set"}
                      </div>
                    </div>
                    <button
                      onClick={() => acceptDns.mutate()}
                      className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"
                    >
                      Accept current DNS as baseline
                    </button>
                  </div>
                </div>
                <div className="panel overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Checked</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">A records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.dns.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="numeric px-3 py-2">{dateTime(r.checked_at)}</td>
                          <td className="px-3 py-2">
                            <StatusPill status={r.status} />
                          </td>
                          <td className="numeric px-3 py-2">{r.a_records.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {tab === "Security" ? (
              <div className="panel divide-y divide-border">
                {(d.security?.findings ?? []).map((f) => (
                  <div key={f.label} className="p-4">
                    <div className="flex items-center gap-2">
                      <StatusPill status={f.status === "pass" ? "healthy" : f.status === "warn" ? "warning" : "unknown"} label={f.status === "pass" ? "Present" : "Missing"} />
                      <span className="text-sm font-medium">{f.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{f.explanation}</p>
                    {f.value ? <p className="numeric mt-1 break-all text-xs">{f.value}</p> : null}
                  </div>
                ))}
                {!d.security ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    No security-header results yet. Run a check to collect them.
                  </p>
                ) : null}
              </div>
            ) : null}

            {tab === "History" ? (
              <div className="panel overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Checked</th>
                      <th className="px-3 py-2">Result</th>
                      <th className="px-3 py-2">HTTP</th>
                      <th className="px-3 py-2">Response</th>
                      <th className="px-3 py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(history.data?.checks ?? [])].reverse().slice(0, 200).map((c, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="numeric px-3 py-2">{dateTime(c.checked_at)}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={c.status} />
                        </td>
                        <td className="numeric px-3 py-2">{c.http_status ?? "—"}</td>
                        <td className="numeric px-3 py-2">{ms(c.response_ms)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{c.error_message ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </>
      )}
    </AppShell>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-sm">{value}</div>
    </div>
  );
}
