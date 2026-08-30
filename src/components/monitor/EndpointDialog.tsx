import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { apiPost, apiPut } from "@/lib/api";
import { ms } from "@/lib/format";

export interface EndpointRecord {
  id: number;
  name: string;
  path: string;
  expected_status: string;
  timeout_ms: number;
  expected_content: string[];
  forbidden_content: string[];
  is_critical: boolean;
  enabled: boolean;
}

interface TestResult {
  resolvedUrl: string;
  success: boolean;
  httpStatus: number | null;
  responseMs: number;
  contentOk: boolean;
  errorMessage: string | null;
}

const field =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const label = "text-xs text-muted-foreground";

const lines = (v: string) =>
  v.split("\n").map((s) => s.trim()).filter(Boolean);

export function EndpointDialog({
  siteId,
  siteUrl,
  endpoint,
  onClose,
  onSaved,
}: {
  siteId: number | string;
  siteUrl: string;
  endpoint: EndpointRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: endpoint?.name ?? "",
    path: endpoint?.path ?? "/",
    expected_status: endpoint?.expected_status ?? "200-299",
    timeout_ms: endpoint?.timeout_ms ?? 10_000,
    is_critical: endpoint?.is_critical ?? true,
    enabled: endpoint?.enabled ?? true,
    expected_content: (endpoint?.expected_content ?? []).join("\n"),
    forbidden_content: (endpoint?.forbidden_content ?? []).join("\n"),
  });
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const payload = () => ({
    name: form.name.trim(),
    path: form.path.trim(),
    expected_status: form.expected_status.trim() || "200-299",
    timeout_ms: Number(form.timeout_ms),
    expected_content: lines(form.expected_content),
    forbidden_content: lines(form.forbidden_content),
    is_critical: form.is_critical,
    enabled: form.enabled,
  });

  const runTest = useMutation({
    mutationFn: () => {
      const p = payload();
      return apiPost<TestResult>(`/sites/${siteId}/endpoints/test`, {
        path: p.path,
        expected_status: p.expected_status,
        timeout_ms: p.timeout_ms,
        expected_content: p.expected_content,
        forbidden_content: p.forbidden_content,
      });
    },
    onSuccess: (r) => {
      setTest(r);
      setError(null);
    },
    onError: (e: Error) => {
      setTest(null);
      setError(e.message);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      endpoint
        ? apiPut(`/sites/${siteId}/endpoints/${endpoint.id}`, payload())
        : apiPost(`/sites/${siteId}/endpoints`, payload()),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const canSave = form.name.trim().length > 0 && form.path.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm">
      <div className="panel my-8 w-full max-w-2xl p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{endpoint ? "Edit endpoint" : "Add endpoint"}</h2>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Relative paths such as <span className="numeric">/auth</span> resolve against {siteUrl}. A full URL may also be used.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <span className={label}>Name</span>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Login page"
            />
          </div>
          <div>
            <span className={label}>Path or full URL</span>
            <input
              className={field}
              value={form.path}
              onChange={(e) => setForm({ ...form, path: e.target.value })}
              placeholder="/auth"
            />
          </div>
          <div>
            <span className={label}>Expected HTTP status</span>
            <input
              className={field}
              value={form.expected_status}
              onChange={(e) => setForm({ ...form, expected_status: e.target.value })}
              placeholder="200-299 or 200,301"
            />
          </div>
          <div>
            <span className={label}>Timeout (ms)</span>
            <input
              type="number"
              min={1000}
              max={120000}
              className={field}
              value={form.timeout_ms}
              onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) })}
            />
          </div>
          <div>
            <span className={label}>Expected content (one per line, optional)</span>
            <textarea
              rows={3}
              className={field}
              value={form.expected_content}
              onChange={(e) => setForm({ ...form, expected_content: e.target.value })}
            />
          </div>
          <div>
            <span className={label}>Forbidden content (one per line, optional)</span>
            <textarea
              rows={3}
              className={field}
              value={form.forbidden_content}
              onChange={(e) => setForm({ ...form, forbidden_content: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_critical}
              onChange={(e) => setForm({ ...form, is_critical: e.target.checked })}
            />
            Critical (failure marks the site critical)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => runTest.mutate()}
            disabled={runTest.isPending || !form.path.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary disabled:opacity-60"
          >
            {runTest.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Test endpoint
          </button>
          <span className="text-xs text-muted-foreground">Runs a real check on the server without saving.</span>
        </div>

        {test ? (
          <div className="mt-3 rounded-md border border-border bg-surface p-3 text-xs">
            <div className="flex items-center gap-2 text-sm">
              {test.success ? (
                <CheckCircle2 className="size-4 text-[hsl(var(--status-healthy))]" />
              ) : (
                <XCircle className="size-4 text-[hsl(var(--status-critical))]" />
              )}
              {test.success ? "Check passed" : "Check failed"}
            </div>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>Resolved URL: <span className="numeric break-all">{test.resolvedUrl}</span></div>
              <div>HTTP status: <span className="numeric">{test.httpStatus ?? "—"}</span></div>
              <div>Response time: <span className="numeric">{ms(test.responseMs)}</span></div>
              <div>Content check: {test.contentOk ? "passed" : "failed"}</div>
            </dl>
            {test.errorMessage ? (
              <div className="mt-2 text-[hsl(var(--status-critical))]">Error: {test.errorMessage}</div>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="mt-3 text-xs text-[hsl(var(--status-critical))]">{error}</div> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          >
            {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {endpoint ? "Save changes" : "Add endpoint"}
          </button>
        </div>
      </div>
    </div>
  );
}
