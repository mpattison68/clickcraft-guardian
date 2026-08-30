import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { AppShell } from "@/components/monitor/AppShell";
import { StatusPill } from "@/components/monitor/StatusPill";
import { apiGet, apiPost } from "@/lib/api";
import { dateTime } from "@/lib/format";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — ClickCraft Site Monitor" },
      { name: "description", content: "Telegram and email alert channel status, test notifications and delivery history." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Notifications — ClickCraft Site Monitor" },
      { property: "og:description", content: "Alert channel status, tests and delivery history." },
    ],
  }),
  component: NotificationsPage,
});

interface StatusResponse {
  channels: { telegram: { configured: boolean }; email: { configured: boolean } };
  reminders: { remindersEnabled: boolean; reminderMinutes: number; dedupeMinutes: number };
}

interface EventRow {
  id: number;
  created_at: string;
  channel: string;
  event_key: string;
  subject: string;
  success: boolean;
  error_message: string | null;
}

function ChannelCard({
  name,
  icon,
  configured,
  onTest,
  testing,
  result,
}: {
  name: string;
  icon: React.ReactNode;
  configured: boolean;
  onTest: () => void;
  testing: boolean;
  result: string | null;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{name}</span>
        <span className="ml-auto">
          <StatusPill status={configured ? "healthy" : "unknown"} label={configured ? "Configured" : "Not configured"} />
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Credentials are held only in the server environment file on the VPS and are never sent to the browser.
      </p>
      <button
        onClick={onTest}
        disabled={!configured || testing}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
      >
        <Send className="size-3.5" /> {testing ? "Sending…" : "Send test notification"}
      </button>
      {result ? <p className="mt-2 text-xs text-muted-foreground">{result}</p> : null}
    </div>
  );
}

function NotificationsPage() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["notify-status"], queryFn: () => apiGet<StatusResponse>("/notifications/status") });
  const events = useQuery({
    queryKey: ["notify-events"],
    queryFn: () => apiGet<{ events: EventRow[] }>("/notifications/events"),
    refetchInterval: 60_000,
  });

  const test = useMutation({
    mutationFn: (channel: string) => apiPost(`/notifications/test/${channel}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["notify-events"] }),
  });

  return (
    <AppShell title="Notifications">
      <div className="grid gap-3 md:grid-cols-2">
        <ChannelCard
          name="Telegram"
          icon={<Send className="size-4 text-primary" />}
          configured={Boolean(status.data?.channels.telegram.configured)}
          onTest={() => test.mutate("telegram")}
          testing={test.isPending && test.variables === "telegram"}
          result={
            test.isSuccess && test.variables === "telegram"
              ? "Test message sent."
              : test.isError && test.variables === "telegram"
                ? (test.error as Error).message
                : null
          }
        />
        <ChannelCard
          name="Email (SMTP)"
          icon={<Mail className="size-4 text-primary" />}
          configured={Boolean(status.data?.channels.email.configured)}
          onTest={() => test.mutate("email")}
          testing={test.isPending && test.variables === "email"}
          result={
            test.isSuccess && test.variables === "email"
              ? "Test email sent."
              : test.isError && test.variables === "email"
                ? (test.error as Error).message
                : null
          }
        />
      </div>

      <div className="panel mt-4 p-4 text-xs text-muted-foreground">
        Reminder notifications:{" "}
        {status.data?.reminders.remindersEnabled
          ? `every ${status.data.reminders.reminderMinutes} minutes while an incident stays open`
          : "disabled"}
        . Duplicate alerts are suppressed for {status.data?.reminders.dedupeMinutes ?? "—"} minutes.
      </div>

      <div className="panel mt-4 overflow-hidden">
        <div className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          Delivery history
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Subject</th>
                <th className="px-3 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {(events.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="numeric px-3 py-2">{dateTime(e.created_at)}</td>
                  <td className="px-3 py-2 capitalize">{e.channel}</td>
                  <td className="px-3 py-2">{e.subject}</td>
                  <td className="px-3 py-2">
                    {e.success ? (
                      <StatusPill status="healthy" label="Sent" />
                    ) : (
                      <span className="text-xs text-critical">{e.error_message ?? "Failed"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {events.data && events.data.events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                    No notifications sent yet.
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
