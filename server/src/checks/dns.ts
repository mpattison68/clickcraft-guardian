import { promises as dns } from "node:dns";

/**
 * static  – exact baseline comparison of A/AAAA/CNAME (fixed infrastructure).
 * dynamic – CDN / load balancer: A/AAAA rotation is expected and never alerts.
 *           Only CNAME target and authoritative nameserver changes are material.
 */
export type DnsMode = "static" | "dynamic";

export interface DnsCheckResult {
  status: "healthy" | "failed" | "changed";
  aRecords: string[];
  aaaaRecords: string[];
  cnameRecords: string[];
  nsRecords: string[];
  changed: boolean;
  changeReason: string | null;
  errorMessage: string | null;
}

export interface DnsBaseline {
  aRecords: string[];
  aaaaRecords: string[];
  cnameRecords: string[];
  nsRecords: string[];
}

const sorted = (v: string[]) => [...v].map((s) => s.toLowerCase().replace(/\.$/, "")).sort();
const same = (a: string[], b: string[]) => {
  const x = sorted(a);
  const y = sorted(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/** Walk up the labels until an authoritative NS set is found (handles www.example.com). */
async function resolveNameservers(hostname: string): Promise<string[]> {
  const labels = hostname.split(".").filter(Boolean);
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = labels.slice(i).join(".");
    const ns = await safe(dns.resolveNs(zone));
    if (ns && ns.length) return ns;
  }
  return [];
}

export async function performDnsCheck(
  hostname: string,
  baseline: DnsBaseline | null,
  mode: DnsMode = "static",
): Promise<DnsCheckResult> {
  const [a, aaaa, cname, ns] = await Promise.all([
    safe(dns.resolve4(hostname)),
    safe(dns.resolve6(hostname)),
    safe(dns.resolveCname(hostname)),
    resolveNameservers(hostname),
  ]);

  const aRecords = a ?? [];
  const aaaaRecords = aaaa ?? [];
  const cnameRecords = cname ?? [];
  const nsRecords = ns;

  // Resolution failure stays critical in both modes.
  if (aRecords.length === 0 && aaaaRecords.length === 0 && cnameRecords.length === 0) {
    return {
      status: "failed",
      aRecords,
      aaaaRecords,
      cnameRecords,
      nsRecords,
      changed: false,
      changeReason: null,
      errorMessage: `DNS lookup returned no records for ${hostname}`,
    };
  }

  const reasons: string[] = [];
  if (baseline) {
    if (mode === "static") {
      if (!same(aRecords, baseline.aRecords)) reasons.push("A records changed");
      if (!same(aaaaRecords, baseline.aaaaRecords)) reasons.push("AAAA records changed");
      if (!same(cnameRecords, baseline.cnameRecords)) reasons.push("CNAME target changed");
    } else {
      // Dynamic/CDN: ignore A/AAAA rotation entirely.
      if (
        (cnameRecords.length > 0 || baseline.cnameRecords.length > 0) &&
        !same(cnameRecords, baseline.cnameRecords)
      ) {
        reasons.push("CNAME target changed");
      }
      if (
        nsRecords.length > 0 &&
        baseline.nsRecords.length > 0 &&
        !same(nsRecords, baseline.nsRecords)
      ) {
        reasons.push("Authoritative nameservers changed");
      }
    }
  }

  const changed = reasons.length > 0;
  return {
    status: changed ? "changed" : "healthy",
    aRecords,
    aaaaRecords,
    cnameRecords,
    nsRecords,
    changed,
    changeReason: changed ? reasons.join("; ") : null,
    errorMessage: null,
  };
}
