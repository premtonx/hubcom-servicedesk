/**
 * SQL-side portal returns KPIs + trends (no row-by-row JS aggregation).
 * Dashboard: one COUNT(*) FILTER query.
 * Trends: generate_series buckets + indexed joins — returns ≤90 points.
 */

import { queryDb } from '../postgres-backend.js';
import type { HardwareReturnsKpiCounts } from './hardware-returns-kpis.js';

export type PortalReturnsTrendRange = '7d' | '30d' | '90d' | '12m' | 'all';

export type PortalDashboardReturnsKpis = HardwareReturnsKpiCounts;

export interface PortalReturnsTrendPoint {
  date: string;
  name: string;
  /** Open returns as-of bucket (on-time + overdue). */
  offeneRuecklieferungen: number;
  /** Overdue subset of open — always ≤ offeneRuecklieferungen, never forced equal. */
  ueberfaellig: number;
  /** Open returns with 4.+ Erinnerung sent as-of bucket. */
  letzteStufeEskaliert: number;
  /** Returns marked received within the bucket. */
  zurueckgeliefert: number;
  /** Compat aliases. */
  offen: number;
  open: number;
  overdue: number;
  escalated: number;
  returned: number;
}

const BERLIN_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date`;

/** Shared open/overdue/escalated predicates (Part 1 KPI rules). */
const SQL_STAGE1_SENT = `(
  mail1_sent_at IS NOT NULL
  OR COALESCE((
    SELECT bool_or(
      COALESCE((elem->>'stage')::int, 0) = 1
      AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
    )
    FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
  ), FALSE)
)`;

const SQL_ESCALATED = `(
  COALESCE(reminder_count, 0) >= 4
  OR COALESCE((
    SELECT bool_or(
      COALESCE((elem->>'stage')::int, 0) >= 4
      AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
    )
    FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
  ), FALSE)
)`;

const SQL_OVERDUE = `(
  (return_due_date IS NOT NULL AND return_due_date < ${BERLIN_TODAY})
  OR ${SQL_STAGE1_SENT}
)`;

/** Overdue start day (Berlin): day after due, or mail1/stage-1 sent day. */
const SQL_OVERDUE_START_D = `COALESCE(
  (
    SELECT MIN(d) FROM (VALUES
      (
        CASE
          WHEN return_due_date IS NOT NULL THEN (return_due_date + 1)
          ELSE NULL
        END
      ),
      (
        CASE
          WHEN mail1_sent_at IS NOT NULL
            THEN (mail1_sent_at AT TIME ZONE 'Europe/Berlin')::date
          ELSE (
            SELECT MIN((NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz AT TIME ZONE 'Europe/Berlin')::date)
            FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
            WHERE COALESCE((elem->>'stage')::int, 0) = 1
              AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
          )
        END
      )
    ) AS v(d)
    WHERE d IS NOT NULL
  ),
  NULL
)`;

const SQL_STAGE4_REACHED_AT = `(
  SELECT MIN(NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz)
  FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
  WHERE COALESCE((elem->>'stage')::int, 0) >= 4
    AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
)`;

/**
 * Single indexed SQL — KPI counts + dynamic 7d/today deltas, no row transfer.
 */
export async function fetchPortalReturnsKpisSql(
  organizationId: string,
): Promise<PortalDashboardReturnsKpis> {
  const res = await queryDb(
    `SELECT
       COUNT(*) FILTER (WHERE returned = FALSE)::int AS open_count,
       COUNT(*) FILTER (
         WHERE returned = FALSE AND (${SQL_OVERDUE})
       )::int AS overdue_count,
       COUNT(*) FILTER (
         WHERE returned = FALSE AND (${SQL_ESCALATED})
       )::int AS escalated_count,
       COUNT(*) FILTER (
         WHERE returned = TRUE
           AND returned_at IS NOT NULL
           AND returned_at >= NOW() - INTERVAL '30 days'
       )::int AS returned_30d_count,
       COUNT(*) FILTER (
         WHERE returned = FALSE
           AND created_at IS NOT NULL
           AND created_at >= NOW() - INTERVAL '7 days'
       )::int AS open_added_7d,
       COUNT(*) FILTER (
         WHERE returned = FALSE
           AND (${SQL_OVERDUE})
           AND (${SQL_OVERDUE_START_D}) = ${BERLIN_TODAY}
       )::int AS overdue_added_today,
       COUNT(*) FILTER (
         WHERE returned = FALSE
           AND (${SQL_OVERDUE})
           AND (${SQL_OVERDUE_START_D}) IS NOT NULL
           AND (${SQL_OVERDUE_START_D}) >= (${BERLIN_TODAY} - 6)
           AND (${SQL_OVERDUE_START_D}) <= ${BERLIN_TODAY}
       )::int AS overdue_added_7d,
       COUNT(*) FILTER (
         WHERE returned = FALSE
           AND (${SQL_ESCALATED})
           AND ${SQL_STAGE4_REACHED_AT} IS NOT NULL
           AND ${SQL_STAGE4_REACHED_AT} >= NOW() - INTERVAL '7 days'
       )::int AS escalated_7d,
       COUNT(*) FILTER (
         WHERE returned = TRUE
           AND returned_at IS NOT NULL
           AND returned_at >= NOW() - INTERVAL '7 days'
       )::int AS returned_7d_count
     FROM ticket_hardware_returns
     WHERE organization_id = $1::uuid
       AND return_required = TRUE`,
    [organizationId],
  );
  const row = (res.rows && res.rows[0]) || {};
  return {
    open: Number(row.open_count) || 0,
    overdue: Number(row.overdue_count) || 0,
    stage3: Number(row.escalated_count) || 0,
    returnedLast30: Number(row.returned_30d_count) || 0,
    openAddedLast7d: Number(row.open_added_7d) || 0,
    overdueAddedToday: Number(row.overdue_added_today) || 0,
    overdueAddedLast7d: Number(row.overdue_added_7d) || 0,
    escalatedLast7d: Number(row.escalated_7d) || 0,
    returnedLast7d: Number(row.returned_7d_count) || 0,
  };
}

function berlinDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return d.toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  });
}

function berlinMonthLabel(isoMonth: string): string {
  const d = new Date(`${isoMonth}-01T00:00:00.000Z`);
  return d.toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit',
  });
}

function mapTrendRows(
  rows: Array<Record<string, unknown>>,
  kind: 'day' | 'month',
): PortalReturnsTrendPoint[] {
  return (rows || []).map((r) => {
    const date = String(r.bucket_date || r.date || '').slice(0, kind === 'month' ? 7 : 10);
    const offeneRuecklieferungen =
      Number(r.offene_ruecklieferungen ?? r.offeneRuecklieferungen ?? r.offen) || 0;
    const ueberfaellig = Number(r.ueberfaellig) || 0;
    const letzteStufeEskaliert =
      Number(r.letzte_stufe_eskaliert ?? r.letzteStufeEskaliert ?? r.escalated) || 0;
    const zurueckgeliefert = Number(r.zurueckgeliefert) || 0;
    return {
      date,
      name: kind === 'month' ? berlinMonthLabel(date) : berlinDayLabel(date),
      offeneRuecklieferungen,
      ueberfaellig,
      letzteStufeEskaliert,
      zurueckgeliefert,
      offen: offeneRuecklieferungen,
      open: offeneRuecklieferungen,
      overdue: ueberfaellig,
      escalated: letzteStufeEskaliert,
      returned: zurueckgeliefert,
    };
  });
}

/**
 * SQL generate_series daily buckets (7d / 30d / 90d).
 * 4 distinct series: open, overdue subset, escalated (4.+), returned-in-bucket.
 */
export async function fetchPortalReturnsTrendsDailySql(
  organizationId: string,
  days: number,
): Promise<PortalReturnsTrendPoint[]> {
  const res = await queryDb(
    `WITH bounds AS (
       SELECT
         (${BERLIN_TODAY} - ($2::int - 1)) AS start_d,
         ${BERLIN_TODAY} AS end_d
     ),
     days AS (
       SELECT generate_series(b.start_d, b.end_d, '1 day'::interval)::date AS d
       FROM bounds b
     ),
     base AS (
       SELECT
         COALESCE(created_at AT TIME ZONE 'Europe/Berlin', delivery_date::timestamp)::date AS created_d,
         CASE
           WHEN returned AND returned_at IS NOT NULL
             THEN (returned_at AT TIME ZONE 'Europe/Berlin')::date
           ELSE NULL
         END AS closed_d,
         return_due_date AS due_d,
         CASE
           WHEN mail1_sent_at IS NOT NULL
             THEN (mail1_sent_at AT TIME ZONE 'Europe/Berlin')::date
           ELSE (
             SELECT MIN((NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz AT TIME ZONE 'Europe/Berlin')::date)
             FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
             WHERE COALESCE((elem->>'stage')::int, 0) = 1
               AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
           )
         END AS mail1_d,
         (
           SELECT MIN((NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz AT TIME ZONE 'Europe/Berlin')::date)
           FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
           WHERE COALESCE((elem->>'stage')::int, 0) >= 4
             AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
         ) AS escalated_d
       FROM ticket_hardware_returns
       WHERE organization_id = $1::uuid
         AND return_required = TRUE
     )
     SELECT
       d.d::text AS bucket_date,
       COUNT(*) FILTER (
         WHERE b.created_d IS NOT NULL
           AND b.created_d <= d.d
           AND (b.closed_d IS NULL OR b.closed_d > d.d)
       )::int AS offene_ruecklieferungen,
       COUNT(*) FILTER (
         WHERE b.created_d IS NOT NULL
           AND b.created_d <= d.d
           AND (b.closed_d IS NULL OR b.closed_d > d.d)
           AND (
             (b.due_d IS NOT NULL AND b.due_d < d.d)
             OR (b.mail1_d IS NOT NULL AND b.mail1_d <= d.d)
           )
       )::int AS ueberfaellig,
       COUNT(*) FILTER (
         WHERE b.created_d IS NOT NULL
           AND b.created_d <= d.d
           AND (b.closed_d IS NULL OR b.closed_d > d.d)
           AND b.escalated_d IS NOT NULL
           AND b.escalated_d <= d.d
       )::int AS letzte_stufe_eskaliert,
       COUNT(*) FILTER (
         WHERE b.closed_d IS NOT NULL AND b.closed_d = d.d
       )::int AS zurueckgeliefert
     FROM days d
     LEFT JOIN base b ON TRUE
     GROUP BY d.d
     ORDER BY d.d ASC`,
    [organizationId, days],
  );
  return mapTrendRows(res.rows || [], 'day');
}

/**
 * SQL monthly buckets (12m / all, capped at 36 months).
 */
export async function fetchPortalReturnsTrendsMonthlySql(
  organizationId: string,
  months: number,
): Promise<PortalReturnsTrendPoint[]> {
  const capped = Math.max(1, Math.min(36, months));
  const res = await queryDb(
    `WITH bounds AS (
       SELECT
         date_trunc('month', ${BERLIN_TODAY})::date AS end_m,
         (date_trunc('month', ${BERLIN_TODAY}) - (($2::int - 1) * INTERVAL '1 month'))::date AS start_m
     ),
     months AS (
       SELECT generate_series(b.start_m, b.end_m, '1 month'::interval)::date AS m
       FROM bounds b
     ),
     base AS (
       SELECT
         date_trunc(
           'month',
           COALESCE(created_at AT TIME ZONE 'Europe/Berlin', delivery_date::timestamp)
         )::date AS created_m,
         CASE
           WHEN returned AND returned_at IS NOT NULL
             THEN date_trunc('month', returned_at AT TIME ZONE 'Europe/Berlin')::date
           ELSE NULL
         END AS closed_m,
         CASE
           WHEN return_due_date IS NOT NULL
             THEN date_trunc('month', return_due_date::timestamp)::date
           ELSE NULL
         END AS due_m,
         CASE
           WHEN mail1_sent_at IS NOT NULL
             THEN date_trunc('month', mail1_sent_at AT TIME ZONE 'Europe/Berlin')::date
           ELSE (
             SELECT date_trunc(
               'month',
               MIN((NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz AT TIME ZONE 'Europe/Berlin'))
             )::date
             FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
             WHERE COALESCE((elem->>'stage')::int, 0) = 1
               AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
           )
         END AS mail1_m,
         (
           SELECT date_trunc(
             'month',
             MIN((NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz AT TIME ZONE 'Europe/Berlin'))
           )::date
           FROM jsonb_array_elements(COALESCE(reminder_stages, '[]'::jsonb)) AS elem
           WHERE COALESCE((elem->>'stage')::int, 0) >= 4
             AND NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
         ) AS escalated_m
       FROM ticket_hardware_returns
       WHERE organization_id = $1::uuid
         AND return_required = TRUE
     )
     SELECT
       to_char(m.m, 'YYYY-MM') AS bucket_date,
       COUNT(*) FILTER (
         WHERE b.created_m IS NOT NULL
           AND b.created_m <= m.m
           AND (b.closed_m IS NULL OR b.closed_m > m.m)
       )::int AS offene_ruecklieferungen,
       COUNT(*) FILTER (
         WHERE b.created_m IS NOT NULL
           AND b.created_m <= m.m
           AND (b.closed_m IS NULL OR b.closed_m > m.m)
           AND (
             (b.due_m IS NOT NULL AND b.due_m < m.m)
             OR (b.mail1_m IS NOT NULL AND b.mail1_m <= m.m)
           )
       )::int AS ueberfaellig,
       COUNT(*) FILTER (
         WHERE b.created_m IS NOT NULL
           AND b.created_m <= m.m
           AND (b.closed_m IS NULL OR b.closed_m > m.m)
           AND b.escalated_m IS NOT NULL
           AND b.escalated_m <= m.m
       )::int AS letzte_stufe_eskaliert,
       COUNT(*) FILTER (
         WHERE b.closed_m IS NOT NULL AND b.closed_m = m.m
       )::int AS zurueckgeliefert
     FROM months m
     LEFT JOIN base b ON TRUE
     GROUP BY m.m
     ORDER BY m.m ASC`,
    [organizationId, capped],
  );
  return mapTrendRows(res.rows || [], 'month');
}

export async function loadPortalReturnsTrendsSql(
  organizationId: string,
  timeframe: PortalReturnsTrendRange,
): Promise<PortalReturnsTrendPoint[]> {
  if (timeframe === '30d') return fetchPortalReturnsTrendsDailySql(organizationId, 30);
  if (timeframe === '90d') return fetchPortalReturnsTrendsDailySql(organizationId, 90);
  if (timeframe === '12m') return fetchPortalReturnsTrendsMonthlySql(organizationId, 12);
  if (timeframe === 'all') return fetchPortalReturnsTrendsMonthlySql(organizationId, 36);
  // Default + explicit 7d
  return fetchPortalReturnsTrendsDailySql(organizationId, 7);
}

export function parsePortalReturnsTrendTimeframe(
  raw: unknown,
): PortalReturnsTrendRange {
  const s = String(raw || '7d').trim();
  if (s === '7d' || s === '30d' || s === '90d' || s === '12m' || s === 'all') return s;
  return '7d';
}
