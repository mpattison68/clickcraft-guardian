import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { apiGet, apiPut } from "@/lib/api";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ClickCraft Site Monitor" },
      { name: "description", content: "Monitoring defaults, SSL warning thresholds, alert behaviour, VPS thresholds and data retention." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Settings — ClickCraft Site Monitor" },
      { property: "og:description", content: "Configure monitoring defaults, thresholds, alerts and retention." },
    ],
  }),
  component: SettingsPage,
});

interface Settings {
  monitoring: { defaultIntervalSeconds: number; defaultTimeoutMs: number; failureThreshold: number; warnResponseMs: number; criticalResponseMs: number };
  ssl: { warningDays: number[] };
  alerts: { remindersEnabled: boolean; reminderMinutes: number; dedupeMinutes: number };
  vps: { cpuWarn: number; cpuCritical: number; memWarn: number; memCritical: number; diskWarn: number; diskCritical: number; metricsIntervalSeconds: number };
  data: { rawCheckRetentionDays: number; aggregateRetentionDays: number; metricsRetentionDays: number };
  application: { appName: string; timezone: string };
}

const field = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type="number" className={field} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: Settings; channels: { telegram: { configured: boolean }; email: { configured: boolean } } }>("/settings"),
  });

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.settings);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: () => apiPut("/settings", draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (!draft) return <AppShell title="Settings"><p className="text-sm text-muted-foreground">Loading settings…</p></AppShell>;

  const set = <S extends keyof Settings>(section: S, patch: Partial<Settings[S]>) =>
    setDraft({ ...draft, [section]: { ...draft[section], ...patch } });

  return (
    <AppShell
      title="Settings"
      actions={
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {save.isPending ? "Saving…" : save.isSuccess ? "Saved" : "Save changes"}
        </button>
      }
    >
      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Monitoring">
          <NumberField label="Default interval (seconds)" value={draft.monitoring.defaultIntervalSeconds} onChange={(v) => set("monitoring", { defaultIntervalSeconds: v })} />
          <NumberField label="Default timeout (ms)" value={draft.monitoring.defaultTimeoutMs} onChange={(v) => set("monitoring", { defaultTimeoutMs: v })} />
          <NumberField label="Consecutive failures before incident" value={draft.monitoring.failureThreshold} onChange={(v) => set("monitoring", { failureThreshold: v })} />
          <NumberField label="Warning response time (ms)" value={draft.monitoring.warnResponseMs} onChange={(v) => set("monitoring", { warnResponseMs: v })} />
          <NumberField label="Critical response time (ms)" value={draft.monitoring.criticalResponseMs} onChange={(v) => set("monitoring", { criticalResponseMs: v })} />
        </Section>

        <Section title="SSL">
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground">Warning thresholds (days, comma separated)</label>
            <input
              className={field}
              value={draft.ssl.warningDays.join(", ")}
              onChange={(e) =>
                set("ssl", {
                  warningDays: e.target.value.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0),
                })
              }
            />
          </div>
        </Section>

        <Section title="Alerts">
          <div className="sm:col-span-2 flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">Telegram</span>
            <StatusPill status={settings.data?.channels.telegram.configured ? "healthy" : "unknown"} label={settings.data?.channels.telegram.configured ? "Configured" : "Not configured"} />
            <span className="text-muted-foreground">Email</span>
            <StatusPill status={settings.data?.channels.email.configured ? "healthy" : "unknown"} label={settings.data?.channels.email.configured ? "Configured" : "Not configured"} />
          </div>
          <div className="sm:col-span-2 text-xs text-muted-foreground">
            Channel credentials live only in the server environment file on the VPS.
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Reminders while an incident is open</label>
            <select
              className={field}
              value={draft.alerts.remindersEnabled ? "on" : "off"}
              onChange={(e) => set("alerts", { remindersEnabled: e.target.value === "on" })}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </div>
          <NumberField label="Reminder interval (minutes)" value={draft.alerts.reminderMinutes} onChange={(v) => set("alerts", { reminderMinutes: v })} />
          <NumberField label="Duplicate alert suppression (minutes)" value={draft.alerts.dedupeMinutes} onChange={(v) => set("alerts", { dedupeMinutes: v })} />
        </Section>

        <Section title="VPS thresholds">
          <NumberField label="CPU warning %" value={draft.vps.cpuWarn} onChange={(v) => set("vps", { cpuWarn: v })} />
          <NumberField label="CPU critical %" value={draft.vps.cpuCritical} onChange={(v) => set("vps", { cpuCritical: v })} />
          <NumberField label="Memory warning %" value={draft.vps.memWarn} onChange={(v) => set("vps", { memWarn: v })} />
          <NumberField label="Memory critical %" value={draft.vps.memCritical} onChange={(v) => set("vps", { memCritical: v })} />
          <NumberField label="Disk warning %" value={draft.vps.diskWarn} onChange={(v) => set("vps", { diskWarn: v })} />
          <NumberField label="Disk critical %" value={draft.vps.diskCritical} onChange={(v) => set("vps", { diskCritical: v })} />
        </Section>

        <Section title="Data retention">
          <NumberField label="Detailed checks (days)" value={draft.data.rawCheckRetentionDays} onChange={(v) => set("data", { rawCheckRetentionDays: v })} />
          <NumberField label="Aggregated metrics (days)" value={draft.data.aggregateRetentionDays} onChange={(v) => set("data", { aggregateRetentionDays: v })} />
          <NumberField label="VPS metrics (days)" value={draft.data.metricsRetentionDays} onChange={(v) => set("data", { metricsRetentionDays: v })} />
          <div className="sm:col-span-2 text-xs text-muted-foreground">
            Incidents are retained indefinitely until deleted manually.
          </div>
        </Section>

        <Section title="Application">
          <div>
            <label className="text-xs text-muted-foreground">Application name</label>
            <input className={field} value={draft.application.appName} onChange={(e) => set("application", { appName: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Timezone</label>
            <input className={field} value={draft.application.timezone} onChange={(e) => set("application", { timezone: e.target.value })} />
          </div>
        </Section>
      </div>

      {save.isError ? <p className="mt-3 text-xs text-critical">{(save.error as Error).message}</p> : null}
    </AppShell>
  );
}
