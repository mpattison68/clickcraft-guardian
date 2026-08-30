import { query } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { dispatchNotification } from "../notify/dispatcher.js";
import { getSettings } from "../settings.js";
import { performDnsCheck } from "../checks/dns.js";
import { performHttpCheck } from "../checks/http.js";
import { performSslCheck } from "../checks/ssl.js";
import { assertSafeUrl } from "../checks/ssrf.js";
import { openIncident, resolveIncident, type TimelineEntry } from "./incidents.js";
import type { EndpointRow, HealthStatus, SiteRow } from "./types.js";

const log = createLogger("engine");

const SSL_INTERVAL_MS = 6 * 3600_000;
const DNS_INTERVAL_MS = 5 * 60_000;
const SECURITY_INTERVAL_MS = 12 * 3600_000;

const lastSsl = new Map<number, number>();
const lastDns = new Map<number, number>();
const lastSecurity = new Map<number, number>();

export interface SiteCheckOutcome {
  status: HealthStatus;
  httpStatus: number | null;
  responseMs: number | null;
  error: string | null;
}

function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  const order: HealthStatus[] = ["unknown", "healthy", "warning", "critical"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

async function checkEndpoints(site: SiteRow): Promise<{ status: HealthStatus; errors: string[] }> {
  const res = await query<EndpointRow>(
    "SELECT * FROM endpoints WHERE site_id = $1 AND enabled = true ORDER BY id",
    [site.id],
  );
  let status: HealthStatus = "unknown";
  const errors: string[] = [];

  for (const ep of res.rows) {
    let target: string;
    try {
      target = new URL(ep.path, site.url).toString();
    } catch {
      errors.push(`${ep.name}: invalid path`);
      continue;
    }
    try {
      const r = await performHttpCheck({
        url: target,
        timeoutMs: ep.timeout_ms,
        expectedStatus: ep.expected_status,
        followRedirects: site.follow_redirects,
        expectedContent: ep.expected_content,
        forbiddenContent: ep.forbidden_content,
      });
      const epStatus: HealthStatus = r.success ? "healthy" : ep.is_critical ? "critical" : "warning";
      status = worst(status, epStatus);
      if (!r.success) errors.push(`${ep.name}: ${r.errorMessage ?? "check failed"}`);

      await query(
        `INSERT INTO endpoint_checks(endpoint_id, site_id, success, status, http_status, response_ms, error_type, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [ep.id, site.id, r.success, epStatus, r.httpStatus, r.responseMs, r.errorType, r.errorMessage],
      );
      await query(
        `UPDATE endpoints SET status=$2, last_check_at=now(), last_error=$3,
           consecutive_failures = CASE WHEN $4 THEN 0 ELSE consecutive_failures + 1 END
         WHERE id=$1`,
        [ep.id, epStatus, r.errorMessage, r.success],
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${ep.name}: ${message}`);
      status = worst(status, ep.is_critical ? "critical" : "warning");
      log.error("endpoint check failed", { endpointId: ep.id, error: message });
    }
  }
  return { status, errors };
}

async function runSslCheck(site: SiteRow, warningDays: number[], force: boolean) {
  const url = new URL(site.url);
  if (url.protocol !== "https:") return null;
  const due = force || (lastSsl.get(site.id) ?? 0) < Date.now() - SSL_INTERVAL_MS;
  if (!due) return null;
  lastSsl.set(site.id, Date.now());

  const r = await performSslCheck(url.hostname, Number(url.port || 443), site.timeout_ms, warningDays);
  await query(
    `INSERT INTO ssl_checks(site_id, status, valid, issuer, subject, valid_from, valid_to,
       days_remaining, hostname_match, chain_valid, handshake_ok, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      site.id,
      r.status,
      r.valid,
      r.issuer,
      r.subject,
      r.validFrom,
      r.validTo,
      r.daysRemaining,
      r.hostnameMatch,
      r.chainValid,
      r.handshakeOk,
      r.errorMessage,
    ],
  );

  if (r.daysRemaining !== null && r.daysRemaining >= 0) {
    const crossed = warningDays.filter((d) => r.daysRemaining! <= d).sort((a, b) => a - b)[0];
    if (crossed !== undefined) {
      await dispatchNotification({
        eventKey: `ssl:${site.id}:${crossed}`,
        subject: "🟠 SSL CERTIFICATE WARNING",
        body: `${site.name}\n${url.hostname}\n\nCertificate expires in ${r.daysRemaining} days.`,
      });
    }
  } else if (r.status === "critical") {
    await dispatchNotification({
      eventKey: `ssl:${site.id}:invalid`,
      subject: "🔴 SSL CERTIFICATE PROBLEM",
      body: `${site.name}\n${url.hostname}\n\n${r.errorMessage ?? "Certificate invalid or expired."}`,
    });
  }
  return r;
}

async function runDnsCheck(site: SiteRow, force: boolean) {
  const due = force || (lastDns.get(site.id) ?? 0) < Date.now() - DNS_INTERVAL_MS;
  if (!due) return null;
  lastDns.set(site.id, Date.now());

  const baselineRes = await query<{ a_records: string[]; aaaa_records: string[]; cname_records: string[] }>(
    "SELECT a_records, aaaa_records, cname_records FROM dns_baselines WHERE site_id = $1",
    [site.id],
  );
  const baselineRow = baselineRes.rows[0];
  const baseline = baselineRow
    ? {
        aRecords: baselineRow.a_records,
        aaaaRecords: baselineRow.aaaa_records,
        cnameRecords: baselineRow.cname_records,
      }
    : null;

  const r = await performDnsCheck(site.hostname, baseline);
  await query(
    `INSERT INTO dns_checks(site_id, status, a_records, aaaa_records, cname_records, changed, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [site.id, r.status, r.aRecords, r.aaaaRecords, r.cnameRecords, r.changed, r.errorMessage],
  );

  if (!baseline && r.status === "healthy") {
    await query(
      `INSERT INTO dns_baselines(site_id, a_records, aaaa_records, cname_records)
       VALUES ($1,$2,$3,$4) ON CONFLICT (site_id) DO NOTHING`,
      [site.id, r.aRecords, r.aaaaRecords, r.cnameRecords],
    );
  }
  if (r.changed) {
    await dispatchNotification({
      eventKey: `dns:${site.id}:${r.aRecords.join(",")}`,
      subject: "🟠 DNS CHANGE DETECTED",
      body: `${site.name}\n${site.hostname}\n\nA records now: ${r.aRecords.join(", ") || "none"}\nAccept the new baseline in the UI if this change was authorised.`,
    });
  }
  return r;
}

async function runSecurityCheck(site: SiteRow, findings: unknown[] | null, force: boolean) {
  if (!findings) return;
  const due = force || (lastSecurity.get(site.id) ?? 0) < Date.now() - SECURITY_INTERVAL_MS;
  if (!due) return;
  lastSecurity.set(site.id, Date.now());
  await query("INSERT INTO security_checks(site_id, findings) VALUES ($1,$2)", [
    site.id,
    JSON.stringify(findings),
  ]);
}

/**
 * Run the complete check pipeline for one site.
 * Never throws: every failure is captured, persisted and logged so other sites keep running.
 */
export async function runSiteCheck(site: SiteRow, opts: { manual?: boolean } = {}): Promise<SiteCheckOutcome> {
  const settings = await getSettings();
  const force = Boolean(opts.manual);
  const timeline: TimelineEntry[] = [];

  try {
    assertSafeUrl(site.url);
    if (site.config_error) {
      await query("UPDATE sites SET config_error = NULL WHERE id = $1", [site.id]);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await query(
      "UPDATE sites SET config_error=$2, status='critical', last_check_at=now(), next_check_at = now() + ($3 || ' seconds')::interval WHERE id=$1",
      [site.id, message, String(site.interval_seconds)],
    );
    log.warn("site has invalid configuration", { siteId: site.id, message });
    return { status: "critical", httpStatus: null, responseMs: null, error: message };
  }

  const collectSecurity = force || (lastSecurity.get(site.id) ?? 0) < Date.now() - SECURITY_INTERVAL_MS;

  let http;
  try {
    http = await performHttpCheck({
      url: site.url,
      timeoutMs: site.timeout_ms,
      expectedStatus: site.expected_status,
      followRedirects: site.follow_redirects,
      expectedContent: site.expected_content,
      forbiddenContent: site.forbidden_content,
      collectSecurityHeaders: collectSecurity,
    });
  } catch (e) {
    http = {
      success: false,
      httpStatus: null,
      responseMs: 0,
      finalUrl: null,
      redirectCount: 0,
      errorType: "unknown" as const,
      errorMessage: e instanceof Error ? e.message : String(e),
      contentFailure: false,
      resolvedAddresses: [],
      securityFindings: null,
      httpsRedirect: null,
    };
  }

  const contentOnlyFailure = http.contentFailure && site.content_failure_mode === "warning";
  const success = http.success || contentOnlyFailure;

  let status: HealthStatus;
  if (!success) {
    status = "critical";
  } else if (contentOnlyFailure) {
    status = "warning";
  } else if ((http.responseMs ?? 0) >= site.critical_response_ms) {
    status = "warning";
  } else if ((http.responseMs ?? 0) >= site.warn_response_ms) {
    status = "warning";
  } else {
    status = "healthy";
  }

  // Supporting checks run independently; their failures never crash the site check.
  const [ssl, dns, endpoints] = await Promise.all([
    runSslCheck(site, settings.ssl.warningDays, force).catch((e) => {
      log.error("ssl check failed", { siteId: site.id, error: String(e) });
      return null;
    }),
    runDnsCheck(site, force).catch((e) => {
      log.error("dns check failed", { siteId: site.id, error: String(e) });
      return null;
    }),
    checkEndpoints(site).catch((e) => {
      log.error("endpoint checks failed", { siteId: site.id, error: String(e) });
      return { status: "unknown" as HealthStatus, errors: [] };
    }),
  ]);
  await runSecurityCheck(site, http.securityFindings, force).catch(() => undefined);

  if (ssl && ssl.status === "critical") status = worst(status, "warning");
  if (ssl && ssl.status === "warning") status = worst(status, "warning");
  if (dns && dns.status === "failed") status = worst(status, "critical");
  if (dns && dns.status === "changed") status = worst(status, "warning");
  if (endpoints.status !== "unknown") status = worst(status, endpoints.status);

  const errorMessage =
    http.errorMessage ??
    (endpoints.errors.length ? endpoints.errors.join("; ") : null) ??
    (dns?.status === "failed" ? dns.errorMessage : null);

  await query(
    `INSERT INTO site_checks(site_id, success, status, http_status, response_ms, final_url, redirect_count, error_type, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      site.id,
      success,
      status,
      http.httpStatus,
      http.responseMs,
      http.finalUrl,
      http.redirectCount,
      http.errorType,
      errorMessage,
    ],
  );

  // ---- failure confirmation / recovery state machine -------------------
  const hardFailure = !success || (endpoints.status === "critical" && !contentOnlyFailure);
  let consecutiveFailures = site.consecutive_failures;
  let firstFailureAt = site.first_failure_at;

  if (hardFailure) {
    consecutiveFailures += 1;
    firstFailureAt = firstFailureAt ?? new Date();
    timeline.push({ at: new Date().toISOString(), message: errorMessage ?? "Check failed" });
  } else {
    consecutiveFailures = 0;
    firstFailureAt = null;
  }

  const confirmedDown = consecutiveFailures >= site.failure_threshold;
  const effectiveStatus: HealthStatus = hardFailure
    ? confirmedDown
      ? "critical"
      : "warning"
    : status;

  await query(
    `UPDATE sites SET status=$2, consecutive_failures=$3,
       consecutive_successes = CASE WHEN $4 THEN consecutive_successes + 1 ELSE 0 END,
       first_failure_at=$5, last_check_at=now(),
       last_success_at = CASE WHEN $4 THEN now() ELSE last_success_at END,
       last_error=$6, next_check_at = now() + ($7 || ' seconds')::interval, updated_at = now()
     WHERE id=$1`,
    [
      site.id,
      effectiveStatus,
      consecutiveFailures,
      !hardFailure,
      firstFailureAt,
      errorMessage,
      String(site.interval_seconds),
    ],
  );

  const siteForIncident: SiteRow = { ...site, first_failure_at: firstFailureAt };

  try {
    if (confirmedDown) {
      const type =
        http.errorType === "timeout"
          ? "timeout"
          : http.errorType === "dns"
            ? "dns_failure"
            : http.errorType === "tls"
              ? "ssl_failure"
              : http.errorType === "content"
                ? "content_failed"
                : http.errorType === "http_status"
                  ? "http_error"
                  : endpoints.status === "critical"
                    ? "endpoint_failure"
                    : "unavailable";
      await openIncident(
        siteForIncident,
        {
          type,
          errorMessage: errorMessage ?? "Site unavailable",
          failedChecks: consecutiveFailures,
          httpStatus: http.httpStatus,
          sslSummary: ssl ? ssl.status : "unchanged",
          dnsSummary: dns ? dns.status : "unchanged",
        },
        timeline,
      );
    } else if (!hardFailure) {
      await resolveIncident(siteForIncident, {
        httpStatus: http.httpStatus,
        responseMs: http.responseMs,
      });
    }
  } catch (e) {
    log.error("incident processing failed", {
      siteId: site.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  log.info("check complete", {
    siteId: site.id,
    site: site.name,
    status: effectiveStatus,
    httpStatus: http.httpStatus,
    responseMs: http.responseMs,
  });

  return {
    status: effectiveStatus,
    httpStatus: http.httpStatus,
    responseMs: http.responseMs,
    error: errorMessage,
  };
}

/** One-off probe used by the Add Site wizard — nothing is persisted. */
export async function probeUrl(url: string, timeoutMs = 10_000) {
  const parsed = assertSafeUrl(url);
  const settings = await getSettings();
  const [http, ssl, dns] = await Promise.all([
    performHttpCheck({
      url,
      timeoutMs,
      expectedStatus: "200-299",
      followRedirects: true,
      collectSecurityHeaders: true,
    }),
    parsed.protocol === "https:"
      ? performSslCheck(parsed.hostname, Number(parsed.port || 443), timeoutMs, settings.ssl.warningDays)
      : Promise.resolve(null),
    performDnsCheck(parsed.hostname, null),
  ]);
  return { http, ssl, dns };
}
