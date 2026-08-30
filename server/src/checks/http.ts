import { assertSafeUrl, BlockedTargetError, resolveAndGuard } from "./ssrf.js";
import { analyseSecurityHeaders, type SecurityFinding } from "./securityHeaders.js";

export type ErrorType =
  | "timeout"
  | "dns"
  | "tls"
  | "connection"
  | "http_status"
  | "content"
  | "blocked"
  | "unknown";

export interface HttpCheckOptions {
  url: string;
  timeoutMs: number;
  expectedStatus: string; // e.g. "200-299" or "200,301"
  followRedirects?: boolean;
  expectedContent?: string[];
  forbiddenContent?: string[];
  collectSecurityHeaders?: boolean;
}

export interface HttpCheckResult {
  success: boolean;
  httpStatus: number | null;
  responseMs: number;
  finalUrl: string | null;
  redirectCount: number;
  errorType: ErrorType | null;
  errorMessage: string | null;
  contentFailure: boolean;
  resolvedAddresses: string[];
  securityFindings: SecurityFinding[] | null;
  httpsRedirect: boolean | null;
}

export function statusMatches(status: number, expected: string): boolean {
  for (const part of expected.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map((n) => Number(n.trim()));
      if (Number.isFinite(lo) && Number.isFinite(hi) && status >= lo && status <= hi) return true;
    } else if (Number(part) === status) {
      return true;
    }
  }
  return false;
}

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1_500_000;

/** Perform one HTTP(S) request with SSRF guards, redirect tracking and content validation. */
export async function performHttpCheck(opts: HttpCheckOptions): Promise<HttpCheckResult> {
  const started = process.hrtime.bigint();
  const result: HttpCheckResult = {
    success: false,
    httpStatus: null,
    responseMs: 0,
    finalUrl: null,
    redirectCount: 0,
    errorType: null,
    errorMessage: null,
    contentFailure: false,
    resolvedAddresses: [],
    securityFindings: null,
    httpsRedirect: null,
  };

  const elapsed = () => Number(process.hrtime.bigint() - started) / 1e6;

  try {
    let current = assertSafeUrl(opts.url);
    let response: Response | null = null;
    const deadline = Date.now() + opts.timeoutMs;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await resolveAndGuard(current.hostname);
      if (hop === 0) result.resolvedAddresses = guard.addresses;

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Object.assign(new Error("Request timed out"), { code: "TIMEOUT" });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      try {
        response = await fetch(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": "ClickCraft-Site-Monitor/1.0 (+https://clickcraft.tech)",
            accept: "text/html,application/json;q=0.9,*/*;q=0.8",
            "accept-encoding": "gzip, deflate",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (isRedirect && opts.followRedirects !== false) {
        const next = new URL(location, current);
        if (hop === 0 && current.protocol === "http:") {
          result.httpsRedirect = next.protocol === "https:";
        }
        result.redirectCount++;
        current = assertSafeUrl(next.toString());
        continue;
      }
      break;
    }

    if (!response) throw new Error("No response received");

    result.httpStatus = response.status;
    result.finalUrl = response.url || current.toString();

    let body = "";
    const needsBody = (opts.expectedContent?.length ?? 0) + (opts.forbiddenContent?.length ?? 0) > 0;
    if (needsBody) {
      const buf = await response.arrayBuffer();
      body = Buffer.from(buf.slice(0, MAX_BODY_BYTES)).toString("utf8");
    } else {
      await response.body?.cancel().catch(() => undefined);
    }

    if (opts.collectSecurityHeaders) {
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      result.securityFindings = analyseSecurityHeaders(headers, current.protocol === "https:");
    }

    result.responseMs = Math.round(elapsed());

    if (!statusMatches(response.status, opts.expectedStatus)) {
      result.errorType = "http_status";
      result.errorMessage = `Unexpected HTTP status ${response.status}`;
      return result;
    }

    for (const needle of opts.expectedContent ?? []) {
      if (needle && !body.includes(needle)) {
        result.contentFailure = true;
        result.errorType = "content";
        result.errorMessage = `Expected content not found: "${needle}"`;
        return result;
      }
    }
    for (const needle of opts.forbiddenContent ?? []) {
      if (needle && body.includes(needle)) {
        result.contentFailure = true;
        result.errorType = "content";
        result.errorMessage = `Forbidden content detected: "${needle}"`;
        return result;
      }
    }

    result.success = true;
    return result;
  } catch (e) {
    result.responseMs = Math.round(elapsed());
    const err = e as Error & { code?: string; cause?: { code?: string; message?: string } };
    const code = err.code ?? err.cause?.code ?? "";
    const message = err.cause?.message ?? err.message ?? "Request failed";

    if (e instanceof BlockedTargetError) {
      result.errorType = "blocked";
    } else if (err.name === "AbortError" || code === "TIMEOUT" || /timed? ?out/i.test(message)) {
      result.errorType = "timeout";
      result.errorMessage = "Request timed out";
      return result;
    } else if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /getaddrinfo/i.test(message)) {
      result.errorType = "dns";
    } else if (
      code.startsWith("ERR_TLS") ||
      code.startsWith("CERT_") ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      /certificate|tls|ssl/i.test(message)
    ) {
      result.errorType = "tls";
    } else if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
      result.errorType = "connection";
    } else {
      result.errorType = "unknown";
    }
    result.errorMessage = message;
    return result;
  }
}
