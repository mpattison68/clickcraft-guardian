export type HealthStatus = "healthy" | "warning" | "critical" | "unknown" | "disabled";

export interface SiteRow {
  id: number;
  name: string;
  description: string;
  url: string;
  hostname: string;
  enabled: boolean;
  interval_seconds: number;
  timeout_ms: number;
  expected_status: string;
  failure_threshold: number;
  warn_response_ms: number;
  critical_response_ms: number;
  follow_redirects: boolean;
  expected_content: string[];
  forbidden_content: string[];
  content_failure_mode: "failure" | "warning";
  status: HealthStatus;
  consecutive_failures: number;
  consecutive_successes: number;
  first_failure_at: Date | null;
  last_check_at: Date | null;
  last_success_at: Date | null;
  next_check_at: Date;
  last_error: string | null;
  config_error: string | null;
}

export interface EndpointRow {
  id: number;
  site_id: number;
  name: string;
  path: string;
  expected_status: string;
  timeout_ms: number;
  expected_content: string[];
  forbidden_content: string[];
  is_critical: boolean;
  enabled: boolean;
  status: HealthStatus;
  consecutive_failures: number;
}
