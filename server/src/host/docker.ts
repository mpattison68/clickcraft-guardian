import http from "node:http";
import { config } from "../config.js";

export interface ContainerInfo {
  containerId: string;
  name: string;
  image: string | null;
  state: string | null;
  statusText: string | null;
  health: string | null;
  restartCount: number | null;
  startedAt: string | null;
}

export function dockerEnabled(): boolean {
  return Boolean(config.monitoring.dockerSocket);
}

/** Minimal read-only Docker Engine API client over the unix socket. */
function dockerRequest<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: config.monitoring.dockerSocket, path, method: "GET", timeout: 8000 },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Docker API HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(e instanceof Error ? e : new Error("Invalid Docker API response"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker API timeout")));
    req.on("error", reject);
    req.end();
  });
}

interface RawContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
}

interface RawInspect {
  RestartCount: number;
  State: { Health?: { Status?: string }; StartedAt?: string; Status?: string };
}

export async function listContainers(): Promise<ContainerInfo[]> {
  if (!dockerEnabled()) return [];
  const containers = await dockerRequest<RawContainer[]>("/v1.41/containers/json?all=true");
  const out: ContainerInfo[] = [];
  for (const c of containers) {
    let health: string | null = null;
    let restartCount: number | null = null;
    let startedAt: string | null = null;
    try {
      const inspect = await dockerRequest<RawInspect>(`/v1.41/containers/${c.Id}/json`);
      health = inspect.State?.Health?.Status ?? null;
      restartCount = inspect.RestartCount ?? null;
      startedAt = inspect.State?.StartedAt ?? null;
    } catch {
      /* inspect is best effort */
    }
    out.push({
      containerId: c.Id.slice(0, 12),
      name: (c.Names?.[0] ?? "").replace(/^\//, ""),
      image: c.Image ?? null,
      state: c.State ?? null,
      statusText: c.Status ?? null,
      health,
      restartCount,
      startedAt,
    });
  }
  return out;
}
