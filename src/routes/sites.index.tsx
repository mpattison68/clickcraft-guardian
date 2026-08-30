import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/monitor/AppShell";
import { AddSiteWizard } from "@/components/monitor/AddSiteWizard";
import { StatusPill } from "@/components/monitor/StatusPill";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/sites/")({
  head: () => ({
    meta: [
      { title: "Sites — ClickCraft Site Monitor" },
      { name: "description", content: "Add, configure, enable or remove the websites monitored by ClickCraft Site Monitor." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Sites — ClickCraft Site Monitor" },
      { property: "og:description", content: "Manage the websites and endpoints under continuous monitoring." },
    ],
  }),
  component: SitesPage,
});

interface SiteRow {
  id: number;
  name: string;
  url: string;
  hostname: string;
  status: string;
  enabled: boolean;
  interval_seconds: number;
  last_check_at: string | null;
  config_error: string | null;
}

function SitesPage() {
  const queryClient = useQueryClient();
  const [wizard, setWizard] = useState(false);
  const sites = useQuery({
    queryKey: ["sites"],
    queryFn: () => apiGet<{ sites: SiteRow[] }>("/sites"),
    refetchInterval: 60_000,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sites"] });

  const toggle = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => apiPatch(`/sites/${v.id}/enabled`, { enabled: v.enabled }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => apiDelete(`/sites/${id}`), onSuccess: invalidate });
  const check = useMutation({ mutationFn: (id: number) => apiPost(`/sites/${id}/check`), onSuccess: invalidate });

  return (
    <AppShell
      title="Sites"
      actions={
        <button
          onClick={() => setWizard(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
        >
          <Plus className="size-3.5" /> Add site
        </button>
      }
    >
      <div className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">URL</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Interval</th>
                <th className="px-3 py-2">Last checked</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(sites.data?.sites ?? []).map((site) => (
                <tr key={site.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link to="/sites/$id" params={{ id: String(site.id) }} className="font-medium hover:text-primary">
                      {site.name}
                    </Link>
                    {site.config_error ? (
                      <div className="text-xs text-critical">Configuration problem: {site.config_error}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{site.url}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={site.enabled ? site.status : "disabled"} />
                  </td>
                  <td className="numeric px-3 py-2">{site.interval_seconds}s</td>
                  <td className="px-3 py-2 text-muted-foreground">{relativeTime(site.last_check_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => check.mutate(site.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                      >
                        <RefreshCw className="size-3" /> Check
                      </button>
                      <button
                        onClick={() => toggle.mutate({ id: site.id, enabled: !site.enabled })}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                      >
                        {site.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete ${site.name} and all its monitoring history?`)) remove.mutate(site.id);
                        }}
                        className="rounded-md border border-border px-2 py-1 text-xs text-critical hover:bg-secondary"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sites.data && sites.data.sites.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    No sites configured yet. Use “Add site” to begin monitoring.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {wizard ? (
        <AddSiteWizard
          onClose={() => setWizard(false)}
          onSaved={() => {
            setWizard(false);
            invalidate();
          }}
        />
      ) : null}
    </AppShell>
  );
}
