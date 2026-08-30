import { query } from "../db/pool.js";
import { createLogger } from "../logger.js";
import { getSettings } from "../settings.js";

const log = createLogger("retention");

/** Aggregate raw checks into hourly buckets, then purge data past its retention window. */
export async function runRetention(): Promise<void> {
  const settings = await getSettings();
  const rawDays = settings.data.rawCheckRetentionDays;
  const aggDays = settings.data.aggregateRetentionDays;
  const metricDays = settings.data.metricsRetentionDays;

  await query(
    `INSERT INTO site_check_hourly(site_id, bucket, checks_total, checks_success, avg_response_ms, max_response_ms)
     SELECT site_id, date_trunc('hour', checked_at) AS bucket,
            count(*)::int, count(*) FILTER (WHERE success)::int,
            avg(response_ms)::int, max(response_ms)::int
     FROM site_checks
     WHERE checked_at < date_trunc('hour', now())
     GROUP BY site_id, bucket
     ON CONFLICT (site_id, bucket) DO UPDATE SET
       checks_total = EXCLUDED.checks_total,
       checks_success = EXCLUDED.checks_success,
       avg_response_ms = EXCLUDED.avg_response_ms,
       max_response_ms = EXCLUDED.max_response_ms`,
  );

  const purged: Record<string, number> = {};
  const del = async (label: string, sql: string, days: number) => {
    const res = await query(sql, [String(days)]);
    purged[label] = res.rowCount ?? 0;
  };

  await del("site_checks", `DELETE FROM site_checks WHERE checked_at < now() - ($1 || ' days')::interval`, rawDays);
  await del("endpoint_checks", `DELETE FROM endpoint_checks WHERE checked_at < now() - ($1 || ' days')::interval`, rawDays);
  await del("ssl_checks", `DELETE FROM ssl_checks WHERE checked_at < now() - ($1 || ' days')::interval`, aggDays);
  await del("dns_checks", `DELETE FROM dns_checks WHERE checked_at < now() - ($1 || ' days')::interval`, rawDays);
  await del("security_checks", `DELETE FROM security_checks WHERE checked_at < now() - ($1 || ' days')::interval`, rawDays);
  await del("server_metrics", `DELETE FROM server_metrics WHERE collected_at < now() - ($1 || ' days')::interval`, metricDays);
  await del("docker_container_metrics", `DELETE FROM docker_container_metrics WHERE collected_at < now() - ($1 || ' days')::interval`, metricDays);
  await del("site_check_hourly", `DELETE FROM site_check_hourly WHERE bucket < now() - ($1 || ' days')::interval`, aggDays);
  await del("notification_events", `DELETE FROM notification_events WHERE created_at < now() - ($1 || ' days')::interval`, aggDays);

  log.info("retention pass complete", purged);
}
