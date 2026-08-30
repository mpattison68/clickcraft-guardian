import { readFile } from "node:fs/promises";
import { statfs } from "node:fs/promises";
import os from "node:os";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("host");

export interface HostMetrics {
  uptimeSeconds: number | null;
  cpuPercent: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  memTotalBytes: number | null;
  memUsedBytes: number | null;
  memPercent: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  diskPercent: number | null;
}

const procPath = (f: string) => `${config.monitoring.hostProcPath.replace(/\/$/, "")}/${f}`;

async function readProc(file: string): Promise<string | null> {
  try {
    return await readFile(procPath(file), "utf8");
  } catch {
    return null;
  }
}

interface CpuSample {
  idle: number;
  total: number;
}

let lastCpu: CpuSample | null = null;

async function sampleCpu(): Promise<CpuSample | null> {
  const stat = await readProc("stat");
  if (!stat) return null;
  const line = stat.split("\n").find((l) => l.startsWith("cpu "));
  if (!line) return null;
  const parts = line.split(/\s+/).slice(1).map(Number).filter((n) => Number.isFinite(n));
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function loadApproximation(): number {
  const load = os.loadavg()[0];
  const cores = os.cpus().length || 1;
  return Math.min(100, Math.round((load / cores) * 100 * 100) / 100);
}

async function cpuPercent(): Promise<number | null> {
  let sample = await sampleCpu();
  // No usable /proc/stat (non-Linux or sandboxed host): approximate from load average.
  if (!sample) return loadApproximation();
  let prev = lastCpu;
  if (!prev) {
    // First collection: take a short second sample so the very first row is not null.
    prev = sample;
    await new Promise((r) => setTimeout(r, 300));
    sample = (await sampleCpu()) ?? sample;
  }
  lastCpu = sample;
  const dTotal = sample.total - prev.total;
  const dIdle = sample.idle - prev.idle;
  if (dTotal <= 0) return null;
  return Math.round(((dTotal - dIdle) / dTotal) * 10000) / 100;
}

async function memory() {
  const meminfo = await readProc("meminfo");
  if (meminfo) {
    const map = new Map<string, number>();
    for (const line of meminfo.split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+) kB/);
      if (m) map.set(m[1], Number(m[2]) * 1024);
    }
    const total = map.get("MemTotal") ?? null;
    const available = map.get("MemAvailable") ?? null;
    const swapTotal = map.get("SwapTotal") ?? null;
    const swapFree = map.get("SwapFree") ?? null;
    if (total && available !== null) {
      const used = total - available;
      return {
        memTotalBytes: total,
        memUsedBytes: used,
        memPercent: Math.round((used / total) * 10000) / 100,
        swapTotalBytes: swapTotal,
        swapUsedBytes: swapTotal !== null && swapFree !== null ? swapTotal - swapFree : null,
      };
    }
  }
  const total = os.totalmem();
  const used = total - os.freemem();
  return {
    memTotalBytes: total,
    memUsedBytes: used,
    memPercent: Math.round((used / total) * 10000) / 100,
    swapTotalBytes: null,
    swapUsedBytes: null,
  };
}

async function disk() {
  try {
    const s = await statfs(config.monitoring.hostRootPath);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    const used = total - free;
    return {
      diskTotalBytes: total,
      diskUsedBytes: used,
      diskPercent: total > 0 ? Math.round((used / total) * 10000) / 100 : null,
    };
  } catch (e) {
    log.warn("disk metrics unavailable", { error: e instanceof Error ? e.message : String(e) });
    return { diskTotalBytes: null, diskUsedBytes: null, diskPercent: null };
  }
}

export async function collectHostMetrics(): Promise<HostMetrics> {
  const uptimeRaw = await readProc("uptime");
  const uptimeSeconds = uptimeRaw ? Math.round(Number(uptimeRaw.split(/\s+/)[0])) : Math.round(os.uptime());
  const loadRaw = await readProc("loadavg");
  const loads = loadRaw ? loadRaw.split(/\s+/).slice(0, 3).map(Number) : os.loadavg();

  return {
    uptimeSeconds,
    cpuPercent: await cpuPercent(),
    load1: loads[0] ?? null,
    load5: loads[1] ?? null,
    load15: loads[2] ?? null,
    ...(await memory()),
    ...(await disk()),
  };
}
