export interface SecurityFinding {
  key: string;
  label: string;
  status: "pass" | "warn" | "info";
  value: string | null;
  explanation: string;
}

const CHECKS: Array<{ key: string; header: string; label: string; explanation: string }> = [
  {
    key: "hsts",
    header: "strict-transport-security",
    label: "Strict-Transport-Security (HSTS)",
    explanation: "Tells browsers to always use HTTPS for this domain, preventing downgrade attacks.",
  },
  {
    key: "csp",
    header: "content-security-policy",
    label: "Content-Security-Policy",
    explanation: "Restricts which scripts, styles and frames may load, reducing XSS impact.",
  },
  {
    key: "nosniff",
    header: "x-content-type-options",
    label: "X-Content-Type-Options",
    explanation: "Stops browsers guessing content types (should be 'nosniff').",
  },
  {
    key: "frame",
    header: "x-frame-options",
    label: "X-Frame-Options",
    explanation: "Prevents the site being embedded in a frame (clickjacking protection).",
  },
  {
    key: "referrer",
    header: "referrer-policy",
    label: "Referrer-Policy",
    explanation: "Controls how much URL information is shared with other sites.",
  },
];

export function analyseSecurityHeaders(
  headers: Record<string, string>,
  isHttps: boolean,
): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const c of CHECKS) {
    let value = headers[c.header] ?? null;
    if (c.key === "frame" && !value) {
      const csp = headers["content-security-policy"];
      if (csp && /frame-ancestors/i.test(csp)) value = "frame-ancestors (via CSP)";
    }
    findings.push({
      key: c.key,
      label: c.label,
      status: value ? "pass" : c.key === "hsts" && !isHttps ? "info" : "warn",
      value,
      explanation: c.explanation,
    });
  }
  return findings;
}
