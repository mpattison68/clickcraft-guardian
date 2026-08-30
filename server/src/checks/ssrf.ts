import { promises as dns } from "node:dns";
import net from "node:net";
import { config } from "../config.js";

export interface ResolvedTarget {
  hostname: string;
  addresses: string[];
}

export class BlockedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTargetError";
  }
}

/** True when the literal IP belongs to a range monitoring must never reach. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return false;
}

export function assertSafeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedTargetError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedTargetError("Only http and https URLs may be monitored");
  }
  if (url.username || url.password) {
    throw new BlockedTargetError("URLs must not contain embedded credentials");
  }
  return url;
}

function allowedByConfig(hostname: string): boolean {
  if (config.monitoring.allowPrivateTargets) return true;
  return config.monitoring.privateAllowlist.includes(hostname.toLowerCase());
}

/**
 * Resolve a hostname and reject prohibited address ranges.
 * Called before every request (and again on redirects) to limit DNS rebinding.
 */
export async function resolveAndGuard(hostname: string): Promise<ResolvedTarget> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  }
  if (addresses.length === 0) throw new BlockedTargetError(`DNS resolution failed for ${hostname}`);
  if (!allowedByConfig(host)) {
    const blocked = addresses.filter(isPrivateAddress);
    if (blocked.length > 0) {
      throw new BlockedTargetError(
        `Target ${hostname} resolves to a prohibited address range (${blocked.join(", ")})`,
      );
    }
  }
  return { hostname: host, addresses };
}
