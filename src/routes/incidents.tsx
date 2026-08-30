import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { apiGet } from "@/lib/api";
import { dateTime, duration } from "@/lib/format";

export const Route = createFileRoute("/incidents")({
  head: () => ({
    meta: [
      { title: "Incidents — ClickCraft Site Monitor" },
      { name: "description", content: "Confirmed outages, incident timelines and recovery history for monitored sites." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Incidents — ClickCraft Site Monitor" },
      { property: "og:description", content: "Confirmed outages, timelines and recovery history." },
    ],
  }),
  component: IncidentsPage,
});

interface Incident {
  id: number;
  site_id: number;
  site_name: string;
  site_url: string;
  endpoint_name: string | null;
  type: string;
  status: string;
  error_message: string | null;
  started_at: string;
  confirmed_at: string;
  recovered_at: string | null;
  duration_seconds: number | null;
  failed_checks: number;
  timeline: Array<{ at: string; message: string }>;
}

function IncidentsPage() {
  const [status, setStatus] = useState<"all" | "active" | "resolved">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const incidents = useQuery({
    queryKey: ["incidents", status],
    queryFn: () => apiGet<{ incidents: Incident[] }>(`/incidents?status=${status}`),
    refetchInterval: 60_000,
  });

  return (
    <AppShell
      title="Incidents"
      actions={
        <div className="flex gap-1 rounded-md border border-border p-0.5 text-xs">
          {(["all", "active", "resolved"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStatus(v)}
              className={`rounded px-2 py-1 capitalize ${status === v ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {v}
            </button>
          ))}
        </div>
      }
    >
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Recovered</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(incidents.data?.incidents ?? []).map((i) => (
                <Fragment key={i.id}>
                  <tr
                    className="cursor-pointer border-t border-border hover:bg-secondary/40"
                    onClick={() => setExpanded(expanded === i.id ? null : i.id)}
                  >
                    <td className="numeric px-3 py-2">#{i.id}</td>
                    <td className="px-3 py-2">
                      <Link to="/sites/$id" params={{ id: String(i.site_id) }} className="hover:text-primary">
                        {i.site_name}
                      </Link>
                      {i.endpoint_name ? (
                        <span className="ml-1 text-xs text-muted-foreground">({i.endpoint_name})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{i.type.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={i.status} />
                    </td>
                    <td className="numeric px-3 py-2">{dateTime(i.started_at)}</td>
                    <td className="numeric px-3 py-2">{dateTime(i.recovered_at)}</td>
                    <td className="numeric px-3 py-2">
                      {duration(
                        i.duration_seconds ??
                          (i.status === "active"
                            ? Math.round((Date.now() - new Date(i.started_at).getTime()) / 1000)
                            : null),
                      )}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground">{i.error_message ?? "—"}</td>
                  </tr>
                  {expanded === i.id ? (
                    <tr className="border-t border-border bg-surface/60">
                      <td colSpan={8} className="px-6 py-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Timeline</div>
                        <ol className="mt-2 space-y-1">
                          {(i.timeline ?? []).map((t, idx) => (
                            <li key={idx} className="numeric text-xs">
                              <span className="text-muted-foreground">
                                {new Date(t.at).toLocaleTimeString(undefined, { hour12: false })}
                              </span>{" "}
                              — {t.message}
                            </li>
                          ))}
                          {(i.timeline ?? []).length === 0 ? (
                            <li className="text-xs text-muted-foreground">No timeline entries recorded.</li>
                          ) : null}
                        </ol>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {incidents.data && incidents.data.incidents.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    No incidents recorded.
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
