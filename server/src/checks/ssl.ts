import tls from "node:tls";
import { resolveAndGuard } from "./ssrf.js";

export interface SslCheckResult {
  status: "healthy" | "warning" | "critical" | "unknown";
  valid: boolean;
  issuer: string | null;
  subject: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  daysRemaining: number | null;
  hostnameMatch: boolean | null;
  chainValid: boolean | null;
  handshakeOk: boolean;
  errorMessage: string | null;
}

function formatName(name: Record<string, string> | undefined): string | null {
  if (!name) return null;
  return name.CN ?? name.O ?? Object.values(name).join(", ") ?? null;
}

/** Inspect the TLS certificate presented by host:port. */
export async function performSslCheck(
  hostname: string,
  port = 443,
  timeoutMs = 10_000,
  warningDays: number[] = [30, 14, 7, 3, 1],
): Promise<SslCheckResult> {
  const base: SslCheckResult = {
    status: "unknown",
    valid: false,
    issuer: null,
    subject: null,
    validFrom: null,
    validTo: null,
    daysRemaining: null,
    hostnameMatch: null,
    chainValid: null,
    handshakeOk: false,
    errorMessage: null,
  };

  try {
    await resolveAndGuard(hostname);
  } catch (e) {
    return { ...base, status: "critical", errorMessage: (e as Error).message };
  }

  return new Promise<SslCheckResult>((resolve) => {
    let settled = false;
    const finish = (r: SslCheckResult) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(r);
    };

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, timeout: timeoutMs, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(true);
        if (!cert || Object.keys(cert).length === 0) {
          finish({ ...base, status: "critical", errorMessage: "No certificate presented" });
          return;
        }
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const daysRemaining = validTo
          ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
          : null;
        const authorized = socket.authorized;
        const authError = socket.authorizationError
          ? String(socket.authorizationError)
          : null;
        const hostnameMatch = tls.checkServerIdentity(hostname, cert) === undefined;

        const maxWarn = warningDays.length ? Math.max(...warningDays) : 30;
        let status: SslCheckResult["status"] = "healthy";
        if (
          !authorized ||
          !hostnameMatch ||
          daysRemaining === null ||
          daysRemaining < 0
        ) {
          status = "critical";
        } else if (daysRemaining <= maxWarn) {
          status = "warning";
        }

        finish({
          status,
          valid: authorized && hostnameMatch && (daysRemaining ?? -1) >= 0,
          issuer: formatName(cert.issuer as unknown as Record<string, string>),
          subject: formatName(cert.subject as unknown as Record<string, string>),
          validFrom,
          validTo,
          daysRemaining,
          hostnameMatch,
          chainValid: authorized,
          handshakeOk: true,
          errorMessage: authorized ? null : authError,
        });
      },
    );

    socket.on("timeout", () =>
      finish({ ...base, status: "critical", errorMessage: "TLS handshake timed out" }),
    );
    socket.on("error", (err) =>
      finish({ ...base, status: "critical", errorMessage: err.message }),
    );
  });
}
