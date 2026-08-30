import { promises as dns } from "node:dns";

export interface DnsCheckResult {
  status: "healthy" | "failed" | "changed";
  aRecords: string[];
  aaaaRecords: string[];
  cnameRecords: string[];
  changed: boolean;
  errorMessage: string | null;
}

export interface DnsBaseline {
  aRecords: string[];
  aaaaRecords: string[];
  cnameRecords: string[];
}

const sorted = (v: string[]) => [...v].map((s) => s.toLowerCase()).sort();
const same = (a: string[], b: string[]) =>
  a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function performDnsCheck(
  hostname: string,
  baseline: DnsBaseline | null,
): Promise<DnsCheckResult> {
  const [a, aaaa, cname] = await Promise.all([
    safe(dns.resolve4(hostname)),
    safe(dns.resolve6(hostname)),
    safe(dns.resolveCname(hostname)),
  ]);

  const aRecords = a ?? [];
  const aaaaRecords = aaaa ?? [];
  const cnameRecords = cname ?? [];

  if (aRecords.length === 0 && aaaaRecords.length === 0 && cnameRecords.length === 0) {
    return {
      status: "failed",
      aRecords,
      aaaaRecords,
      cnameRecords,
      changed: false,
      errorMessage: `DNS lookup returned no records for ${hostname}`,
    };
  }

  let changed = false;
  if (baseline) {
    changed =
      !same(aRecords, baseline.aRecords) ||
      !same(aaaaRecords, baseline.aaaaRecords) ||
      !same(cnameRecords, baseline.cnameRecords);
  }

  return {
    status: changed ? "changed" : "healthy",
    aRecords,
    aaaaRecords,
    cnameRecords,
    changed,
    errorMessage: null,
  };
}
