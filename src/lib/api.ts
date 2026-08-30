/**
 * Thin client for the ClickCraft Site Monitor backend API.
 * Cookies carry the session; the custom header satisfies the server's CSRF check.
 */
const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "clickcraft-monitor",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Request failed (HTTP ${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPut = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const apiPatch = <T,>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const apiDelete = <T,>(path: string) => api<T>(path, { method: "DELETE" });
