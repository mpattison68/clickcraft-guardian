import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { apiPost } from "@/lib/api";
import { ms } from "@/lib/format";

interface EndpointDraft {
  name: string;
  path: string;
  expected_status: string;
  timeout_ms: number;
  is_critical: boolean;
  enabled: boolean;
  expected_content: string[];
  forbidden_content: string[];
}

interface ProbeResult {
  http: {
    success: boolean;
    httpStatus: number | null;
    responseMs: number;
    finalUrl: string | null;
    redirectCount: number;
    errorMessage: string | null;
    securityFindings: Array<{ label: string; status: string; value: string | null }> | null;
  };
  ssl: { status: string; daysRemaining: number | null; issuer: string | null; errorMessage: string | null } | null;
  dns: { status: string; aRecords: string[]; errorMessage: string | null };
}

const INTERVALS = [
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
];

const field =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const label = "text-xs text-muted-foreground";

export function AddSiteWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    description: "",
    url: "",
    interval_seconds: 60,
    timeout_ms: 10_000,
    expected_status: "200-299",
    failure_threshold: 3,
    warn_response_ms: 1500,
    critical_response_ms: 3000,
    content_failure_mode: "failure" as "failure" | "warning",
    expected_content: "",
    forbidden_content: "",
  });
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>([]);

  const probe = useMutation({
    mutationFn: () => apiPost<ProbeResult>("/sites/probe", { url: form.url }),
  });

  const save = useMutation({
    mutationFn: () =>
      apiPost("/sites", {
        name: form.name,
        description: form.description,
        url: form.url,
        enabled: true,
        interval_seconds: form.interval_seconds,
        timeout_ms: form.timeout_ms,
        expected_status: form.expected_status,
        failure_threshold: form.failure_threshold,
        warn_response_ms: form.warn_response_ms,
        critical_response_ms: form.critical_response_ms,
        follow_redirects: true,
        content_failure_mode: form.content_failure_mode,
        expected_content: form.expected_content.split("\n").map((s) => s.trim()).filter(Boolean),
        forbidden_content: form.forbidden_content.split("\n").map((s) => s.trim()).filter(Boolean),
        endpoints,
      }),
    onSuccess: onSaved,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur">
      <div className="panel w-full max-w-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add site — step {step} of 4</h2>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>

        {step === 1 ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className={label}>Site name</label>
              <input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div>
              <label className={label}>Primary URL</label>
              <input
                className={field}
                placeholder="https://example.clickcraft.tech"
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Description</label>
              <input className={field} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Monitoring interval</label>
              <select
                className={field}
                value={form.interval_seconds}
                onChange={(e) => set("interval_seconds", Number(e.target.value))}
              >
                {INTERVALS.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Timeout (ms)</label>
              <input
                type="number"
                className={field}
                value={form.timeout_ms}
                onChange={(e) => set("timeout_ms", Number(e.target.value))}
              />
            </div>
            <div>
              <label className={label}>Expected HTTP status</label>
              <input className={field} value={form.expected_status} onChange={(e) => set("expected_status", e.target.value)} />
            </div>
            <div>
              <label className={label}>Consecutive failures before incident</label>
              <input
                type="number"
                className={field}
                value={form.failure_threshold}
                onChange={(e) => set("failure_threshold", Number(e.target.value))}
              />
            </div>
            <div>
              <label className={label}>Warning response time (ms)</label>
              <input
                type="number"
                className={field}
                value={form.warn_response_ms}
                onChange={(e) => set("warn_response_ms", Number(e.target.value))}
              />
            </div>
            <div>
              <label className={label}>Critical response time (ms)</label>
              <input
                type="number"
                className={field}
                value={form.critical_response_ms}
                onChange={(e) => set("critical_response_ms", Number(e.target.value))}
              />
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className={label}>Expected content (one string per line)</label>
              <textarea
                rows={3}
                className={field}
                placeholder="Sign in"
                value={form.expected_content}
                onChange={(e) => set("expected_content", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Forbidden content (one string per line)</label>
              <textarea
                rows={3}
                className={field}
                placeholder={"Internal Server Error\nBad Gateway"}
                value={form.forbidden_content}
                onChange={(e) => set("forbidden_content", e.target.value)}
              />
            </div>
            <div>
              <label className={label}>Content mismatch severity</label>
              <select
                className={field}
                value={form.content_failure_mode}
                onChange={(e) => set("content_failure_mode", e.target.value as "failure" | "warning")}
              >
                <option value="failure">Treat as failure</option>
                <option value="warning">Treat as warning</option>
              </select>
            </div>

            <div className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Additional endpoints</span>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    setEndpoints((e) => [
                      ...e,
                      {
                        name: "Endpoint",
                        path: "/",
                        expected_status: "200-299",
                        timeout_ms: 10_000,
                        is_critical: true,
                        enabled: true,
                        expected_content: [],
                        forbidden_content: [],
                      },
                    ])
                  }
                >
                  + Add endpoint
                </button>
              </div>
              {endpoints.map((ep, i) => (
                <div key={i} className="mt-2 grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <input
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    value={ep.name}
                    onChange={(e) =>
                      setEndpoints((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                  />
                  <input
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                    value={ep.path}
                    onChange={(e) =>
                      setEndpoints((list) => list.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))
                    }
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={ep.is_critical}
                      onChange={(e) =>
                        setEndpoints((list) => list.map((x, j) => (j === i ? { ...x, is_critical: e.target.checked } : x)))
                      }
                    />
                    Critical
                  </label>
                  <button
                    className="text-xs text-critical"
                    onClick={() => setEndpoints((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="mt-4 space-y-3">
            <button
              onClick={() => probe.mutate()}
              disabled={probe.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {probe.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Run initial test
            </button>
            {probe.isError ? <p className="text-xs text-critical">{(probe.error as Error).message}</p> : null}
            {probe.data ? (
              <div className="space-y-2 rounded-md border border-border p-3 text-xs">
                <ResultRow
                  ok={probe.data.http.success}
                  label="HTTP"
                  detail={`${probe.data.http.httpStatus ?? "no response"} · ${ms(probe.data.http.responseMs)} · ${probe.data.http.redirectCount} redirect(s)${probe.data.http.errorMessage ? ` · ${probe.data.http.errorMessage}` : ""}`}
                />
                <ResultRow
                  ok={probe.data.ssl ? probe.data.ssl.status === "healthy" : true}
                  label="SSL"
                  detail={
                    probe.data.ssl
                      ? `${probe.data.ssl.status} · ${probe.data.ssl.daysRemaining ?? "?"} days · ${probe.data.ssl.issuer ?? ""}`
                      : "not applicable (http)"
                  }
                />
                <ResultRow
                  ok={probe.data.dns.status !== "failed"}
                  label="DNS"
                  detail={probe.data.dns.aRecords.join(", ") || probe.data.dns.errorMessage || "no A records"}
                />
                {(probe.data.http.securityFindings ?? []).map((f) => (
                  <ResultRow key={f.label} ok={f.status === "pass"} label={f.label} detail={f.value ?? "missing"} />
                ))}
              </div>
            ) : null}
            {save.isError ? <p className="text-xs text-critical">{(save.error as Error).message}</p> : null}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between">
          <button
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Back
          </button>
          {step < 4 ? (
            <button
              disabled={step === 1 && (!form.name || !form.url)}
              onClick={() => setStep((s) => s + 1)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save site"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 text-healthy" />
      ) : (
        <XCircle className="mt-0.5 size-3.5 text-warning" />
      )}
      <span className="w-40 shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all">{detail}</span>
    </div>
  );
}
