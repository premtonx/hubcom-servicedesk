/**
 * Portal Übersicht aggregates for hardware returns (Part 1 backend):
 * - returnStatusBreakdown (donut)
 * - weeklyPerformance (KW on-time series)
 * - recentActivities (returns + tickets feed)
 *
 * Pure helpers are offline-testable; SQL fetchers power the live dashboard.
 */

import { queryDb } from '../postgres-backend.js';
import {
  isOpenReturn,
  isOverdueReturn,
  isReturnedLast30,
  kpiRowFromLean,
  type ReminderStageSentLike,
} from './hardware-returns-kpis.js';
import { ticketOrganizationId } from './ticket-visibility.js';

const BERLIN_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Berlin')::date`;

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

const SQL_OVERDUE = `(
  (return_due_date IS NOT NULL AND return_due_date < ${BERLIN_TODAY})
  OR ${SQL_STAGE1_SENT}
)`;

export interface PortalReturnStatusBreakdown {
  openTotal: number;
  versendet: number;
  ueberfaellig: number;
  eingegangen30d: number;
  versendetPct: number;
  ueberfaelligPct: number;
  eingegangenPct: number;
}

export interface PortalWeeklyPerformancePoint {
  kwLabel: string;
  isoWeek: number;
  isoYear: number;
  weekStart: string;
  puenktlichPct: number;
  ueberfaelligPct: number;
  puenktlichCount: number;
  ueberfaelligCount: number;
  totalCompleted: number;
}

export interface PortalWeeklyPerformance {
  weeks: PortalWeeklyPerformancePoint[];
  overallPuenktlichPct: number;
}

export type PortalRecentActivityType =
  | 'return_completed'
  | 'return_reminder'
  | 'return_created'
  | 'ticket';

export interface PortalRecentActivity {
  id: string;
  type: PortalRecentActivityType;
  title: string;
  timestamp: string;
  href: string;
}

export interface PortalReturnActivitySourceRow {
  id: string;
  returnNumber: string | null;
  employeeName: string | null;
  serial: string | null;
  createdAt: string | null;
  returned: boolean;
  returnedAt: string | null;
  mail1SentAt?: string | null;
  mail2SentAt?: string | null;
  mail3SentAt?: string | null;
  reminderStages?: ReminderStageSentLike[];
}

function roundPct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function buildReturnStatusBreakdown(counts: {
  openTotal: number;
  ueberfaellig: number;
  eingegangen30d: number;
}): PortalReturnStatusBreakdown {
  const openTotal = Math.max(0, Math.floor(counts.openTotal) || 0);
  const ueberfaellig = Math.min(
    openTotal,
    Math.max(0, Math.floor(counts.ueberfaellig) || 0),
  );
  const versendet = Math.max(0, openTotal - ueberfaellig);
  const eingegangen30d = Math.max(0, Math.floor(counts.eingegangen30d) || 0);
  const denom = versendet + ueberfaellig + eingegangen30d;
  return {
    openTotal,
    versendet,
    ueberfaellig,
    eingegangen30d,
    versendetPct: roundPct(versendet, denom),
    ueberfaelligPct: roundPct(ueberfaellig, denom),
    eingegangenPct: roundPct(eingegangen30d, denom),
  };
}

/** Offline/fixture path — same classification as SQL OVERDUE + open filters. */
export function computeReturnStatusBreakdownFromRows(
  rows: Array<{
    returnRequired?: boolean;
    returned: boolean;
    returnDueDate?: string | null;
    returnedAt?: string | null;
    mail1SentAt?: string | null;
    reminderStages?: ReminderStageSentLike[] | null;
    reminderCount?: number | null;
  }>,
  now: Date = new Date(),
): PortalReturnStatusBreakdown {
  let openTotal = 0;
  let ueberfaellig = 0;
  let eingegangen30d = 0;
  for (const raw of rows) {
    const row = kpiRowFromLean(raw);
    if (isOpenReturn(row)) {
      openTotal += 1;
      if (isOverdueReturn(row, now)) ueberfaellig += 1;
    } else if (isReturnedLast30(row, now)) {
      eingegangen30d += 1;
    }
  }
  return buildReturnStatusBreakdown({ openTotal, ueberfaellig, eingegangen30d });
}

export async function fetchPortalReturnStatusBreakdownSql(
  organizationId: string,
): Promise<PortalReturnStatusBreakdown> {
  const res = await queryDb(
    `SELECT
       COUNT(*) FILTER (WHERE returned = FALSE)::int AS open_total,
       COUNT(*) FILTER (
         WHERE returned = FALSE AND (${SQL_OVERDUE})
       )::int AS ueberfaellig,
       COUNT(*) FILTER (
         WHERE returned = TRUE
           AND returned_at IS NOT NULL
           AND returned_at >= NOW() - INTERVAL '30 days'
       )::int AS eingegangen_30d
     FROM ticket_hardware_returns
     WHERE organization_id = $1::uuid
       AND return_required = TRUE`,
    [organizationId],
  );
  const row = (res.rows && res.rows[0]) || {};
  return buildReturnStatusBreakdown({
    openTotal: Number(row.open_total) || 0,
    ueberfaellig: Number(row.ueberfaellig) || 0,
    eingegangen30d: Number(row.eingegangen_30d) || 0,
  });
}

function berlinIsoWeekParts(d: Date): { isoWeek: number; isoYear: number; weekStartKey: string } {
  // ISO week: Thursday determines year; week starts Monday (UTC calendar day).
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7; // Mon=1 … Sun=7
  const thursday = new Date(utc);
  thursday.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const weekStart = new Date(utc);
  weekStart.setUTCDate(utc.getUTCDate() - (day - 1));
  const isoWeek =
    Math.floor((weekStart.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
  return {
    isoWeek,
    isoYear,
    weekStartKey: weekStart.toISOString().slice(0, 10),
  };
}

function berlinDayKeyFromIso(iso: string): string | null {
  const s = String(iso || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function lastNIsoWeekStarts(now: Date, n: number): string[] {
  const berlinToday = berlinDayKeyFromIso(now.toISOString());
  if (!berlinToday) return [];
  const [y, m, d] = berlinToday.split('-').map(Number);
  const cursor = new Date(Date.UTC(y!, m! - 1, d!));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() - (day - 1)); // Monday
  const starts: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const w = new Date(cursor);
    w.setUTCDate(cursor.getUTCDate() - i * 7);
    starts.push(w.toISOString().slice(0, 10));
  }
  return starts;
}

export function computeWeeklyPerformanceFromRows(
  rows: Array<{
    returned: boolean;
    returnedAt?: string | null;
    returnDueDate?: string | null;
  }>,
  now: Date = new Date(),
  weekCount = 6,
): PortalWeeklyPerformance {
  const weekStarts = lastNIsoWeekStarts(now, weekCount);
  const byWeek = new Map<string, { onTime: number; late: number }>();
  for (const ws of weekStarts) byWeek.set(ws, { onTime: 0, late: 0 });

  let overallOn = 0;
  let overallTotal = 0;

  for (const r of rows) {
    if (!r.returned || !r.returnedAt) continue;
    const returnedDay = berlinDayKeyFromIso(r.returnedAt);
    if (!returnedDay) continue;
    const parts = berlinIsoWeekParts(new Date(`${returnedDay}T00:00:00.000Z`));
    const bucket = byWeek.get(parts.weekStartKey);
    if (!bucket) continue;
    const due = r.returnDueDate ? berlinDayKeyFromIso(r.returnDueDate) : null;
    const onTime = due != null && returnedDay <= due;
    if (onTime) bucket.onTime += 1;
    else bucket.late += 1;
    overallTotal += 1;
    if (onTime) overallOn += 1;
  }

  const weeks: PortalWeeklyPerformancePoint[] = weekStarts.map((ws) => {
    const c = byWeek.get(ws) || { onTime: 0, late: 0 };
    const total = c.onTime + c.late;
    const parts = berlinIsoWeekParts(new Date(`${ws}T00:00:00.000Z`));
    return {
      kwLabel: `KW ${parts.isoWeek}`,
      isoWeek: parts.isoWeek,
      isoYear: parts.isoYear,
      weekStart: ws,
      puenktlichPct: roundPct(c.onTime, total),
      ueberfaelligPct: roundPct(c.late, total),
      puenktlichCount: c.onTime,
      ueberfaelligCount: c.late,
      totalCompleted: total,
    };
  });

  return {
    weeks,
    overallPuenktlichPct: roundPct(overallOn, overallTotal),
  };
}

/**
 * Single indexed SQL — last 6 ISO weeks (Europe/Berlin), completed returns only.
 */
export async function fetchPortalWeeklyPerformanceSql(
  organizationId: string,
  weekCount = 6,
): Promise<PortalWeeklyPerformance> {
  const capped = Math.max(4, Math.min(6, weekCount));
  const res = await queryDb(
    `WITH bounds AS (
       SELECT
         date_trunc('week', ${BERLIN_TODAY})::date AS this_week,
         (date_trunc('week', ${BERLIN_TODAY}) - (($2::int - 1) * INTERVAL '1 week'))::date AS start_week
     ),
     weeks AS (
       SELECT generate_series(b.start_week, b.this_week, '1 week'::interval)::date AS week_start
       FROM bounds b
     ),
     completed AS (
       SELECT
         date_trunc(
           'week',
           (returned_at AT TIME ZONE 'Europe/Berlin')::date
         )::date AS week_start,
         CASE
           WHEN return_due_date IS NOT NULL
             AND (returned_at AT TIME ZONE 'Europe/Berlin')::date <= return_due_date
           THEN 1 ELSE 0
         END AS on_time
       FROM ticket_hardware_returns
       WHERE organization_id = $1::uuid
         AND return_required = TRUE
         AND returned = TRUE
         AND returned_at IS NOT NULL
         AND (returned_at AT TIME ZONE 'Europe/Berlin')::date
           >= (SELECT start_week FROM bounds)
     )
     SELECT
       w.week_start::text AS week_start,
       EXTRACT(WEEK FROM w.week_start)::int AS iso_week,
       EXTRACT(ISOYEAR FROM w.week_start)::int AS iso_year,
       COALESCE(SUM(c.on_time), 0)::int AS puenktlich_count,
       COALESCE(SUM(1 - c.on_time), 0)::int AS ueberfaellig_count,
       COUNT(c.week_start)::int AS total_completed
     FROM weeks w
     LEFT JOIN completed c ON c.week_start = w.week_start
     GROUP BY w.week_start
     ORDER BY w.week_start ASC`,
    [organizationId, capped],
  );

  const weeks: PortalWeeklyPerformancePoint[] = (res.rows || []).map(
    (r: Record<string, unknown>) => {
      const onTime = Number(r.puenktlich_count) || 0;
      const late = Number(r.ueberfaellig_count) || 0;
      const total = Number(r.total_completed) || onTime + late;
      const isoWeek = Number(r.iso_week) || 0;
      return {
        kwLabel: `KW ${isoWeek}`,
        isoWeek,
        isoYear: Number(r.iso_year) || 0,
        weekStart: String(r.week_start || '').slice(0, 10),
        puenktlichPct: roundPct(onTime, total),
        ueberfaelligPct: roundPct(late, total),
        puenktlichCount: onTime,
        ueberfaelligCount: late,
        totalCompleted: total,
      };
    },
  );

  let overallOn = 0;
  let overallTotal = 0;
  for (const w of weeks) {
    overallOn += w.puenktlichCount;
    overallTotal += w.totalCompleted;
  }

  return {
    weeks,
    overallPuenktlichPct: roundPct(overallOn, overallTotal),
  };
}

function displayReturnNumber(returnNumber: string | null | undefined, id: string): string {
  const n = String(returnNumber || '').trim();
  if (n) return n.startsWith('#') ? n.slice(1) : n;
  return id.slice(0, 8).toUpperCase();
}

function displaySerial(serial: string | null | undefined): string | null {
  const s = String(serial || '').trim();
  return s || null;
}

export function formatReturnActivityTitle(
  type: Exclude<PortalRecentActivityType, 'ticket'>,
  row: {
    returnNumber?: string | null;
    employeeName?: string | null;
    serial?: string | null;
    id: string;
  },
): string {
  const num = displayReturnNumber(row.returnNumber, row.id);
  if (type === 'return_created') {
    return `Neue Rücklieferung #${num} erfasst`;
  }
  if (type === 'return_reminder') {
    const who = String(row.employeeName || '').trim() || 'Mitarbeiter';
    return `Erinnerung an ${who} gesendet`;
  }
  return formatReturnCompletedTitle(row);
}

export function formatReturnCompletedTitle(opts: {
  id: string;
  returnNumber?: string | null;
  serial?: string | null;
}): string {
  const serial = displaySerial(opts.serial);
  if (serial) {
    const cleaned = serial.replace(/^#/, '').trim();
    const withSn = /^SN-/i.test(cleaned) ? cleaned : `SN-${cleaned}`;
    return `Wareneingang: Gerät #${withSn} bestätigt`;
  }
  const num = displayReturnNumber(opts.returnNumber, opts.id);
  return `Rücklieferung #${num} wurde erfolgreich abgeschlossen`;
}

export function buildReturnRecentActivities(
  rows: PortalReturnActivitySourceRow[],
  limit = 20,
): PortalRecentActivity[] {
  const events: PortalRecentActivity[] = [];
  for (const row of rows) {
    const href = `/portal/returns/${encodeURIComponent(row.id)}`;
    if (row.createdAt) {
      events.push({
        id: `return_created:${row.id}:${row.createdAt}`,
        type: 'return_created',
        title: formatReturnActivityTitle('return_created', row),
        timestamp: new Date(row.createdAt).toISOString(),
        href,
      });
    }
    if (row.returned && row.returnedAt) {
      events.push({
        id: `return_completed:${row.id}:${row.returnedAt}`,
        type: 'return_completed',
        title: formatReturnCompletedTitle(row),
        timestamp: new Date(row.returnedAt).toISOString(),
        href,
      });
    }
    const reminderTimes = new Set<string>();
    for (const at of [row.mail1SentAt, row.mail2SentAt, row.mail3SentAt]) {
      if (at) reminderTimes.add(String(at));
    }
    for (const stage of row.reminderStages || []) {
      if (stage.sentAt) reminderTimes.add(String(stage.sentAt));
    }
    for (const at of reminderTimes) {
      events.push({
        id: `return_reminder:${row.id}:${at}`,
        type: 'return_reminder',
        title: formatReturnActivityTitle('return_reminder', row),
        timestamp: new Date(at).toISOString(),
        href,
      });
    }
  }
  return events
    .filter((e) => !Number.isNaN(Date.parse(e.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

/**
 * Recent return events via UNION of created / returned / reminder timestamps.
 * Limited to ~20 rows for merge with tickets.
 */
export async function fetchPortalReturnRecentActivitiesSql(
  organizationId: string,
  limit = 20,
): Promise<PortalRecentActivity[]> {
  const capped = Math.max(8, Math.min(20, limit));
  const res = await queryDb(
    `WITH base AS (
       SELECT
         id,
         return_number,
         employee_name,
         NULLIF(TRIM(COALESCE(device_old_serial, device_new_serial, '')), '') AS serial,
         created_at,
         returned,
         returned_at,
         mail1_sent_at,
         mail2_sent_at,
         mail3_sent_at,
         reminder_stages
       FROM ticket_hardware_returns
       WHERE organization_id = $1::uuid
         AND return_required = TRUE
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 200
     ),
     events AS (
       SELECT
         id,
         'return_created'::text AS event_type,
         created_at AS ts,
         return_number,
         employee_name,
         serial
       FROM base
       WHERE created_at IS NOT NULL
       UNION ALL
       SELECT
         id,
         'return_completed',
         returned_at,
         return_number,
         employee_name,
         serial
       FROM base
       WHERE returned = TRUE AND returned_at IS NOT NULL
       UNION ALL
       SELECT
         id,
         'return_reminder',
         mail1_sent_at,
         return_number,
         employee_name,
         serial
       FROM base
       WHERE mail1_sent_at IS NOT NULL
       UNION ALL
       SELECT
         id,
         'return_reminder',
         mail2_sent_at,
         return_number,
         employee_name,
         serial
       FROM base
       WHERE mail2_sent_at IS NOT NULL
       UNION ALL
       SELECT
         id,
         'return_reminder',
         mail3_sent_at,
         return_number,
         employee_name,
         serial
       FROM base
       WHERE mail3_sent_at IS NOT NULL
       UNION ALL
       SELECT
         b.id,
         'return_reminder',
         (NULLIF(TRIM(elem->>'sentAt'), '')::timestamptz),
         b.return_number,
         b.employee_name,
         b.serial
       FROM base b,
            jsonb_array_elements(COALESCE(b.reminder_stages, '[]'::jsonb)) AS elem
       WHERE NULLIF(TRIM(elem->>'sentAt'), '') IS NOT NULL
     )
     SELECT *
     FROM events
     WHERE ts IS NOT NULL
     ORDER BY ts DESC
     LIMIT $2::int`,
    [organizationId, capped],
  );

  return (res.rows || []).map((r: Record<string, unknown>) => {
    const id = String(r.id);
    const type = String(r.event_type) as Exclude<PortalRecentActivityType, 'ticket'>;
    const ts = new Date(String(r.ts)).toISOString();
    const returnNumber = r.return_number ? String(r.return_number) : null;
    const employeeName = r.employee_name ? String(r.employee_name) : null;
    const serial = r.serial ? String(r.serial) : null;
    const title =
      type === 'return_completed'
        ? formatReturnCompletedTitle({ id, returnNumber, serial })
        : formatReturnActivityTitle(type, { id, returnNumber, employeeName, serial });
    return {
      id: `${type}:${id}:${ts}`,
      type,
      title,
      timestamp: ts,
      href: `/portal/returns/${encodeURIComponent(id)}`,
    };
  });
}

export function buildTicketRecentActivities(
  tickets: Array<Record<string, unknown>>,
  organizationId: string,
  limit = 10,
): PortalRecentActivity[] {
  const orgId = String(organizationId || '').trim();
  const events: PortalRecentActivity[] = [];
  for (const t of tickets) {
    if (ticketOrganizationId(t) !== orgId) continue;
    const id = String(t.id || '').trim();
    if (!id) continue;
    const created = t.createdAt || t.created_at;
    const updated = t.updatedAt || t.updated_at || created;
    const createdMs = created ? Date.parse(String(created)) : 0;
    const updatedMs = updated ? Date.parse(String(updated)) : 0;
    const tsMs = Math.max(createdMs, updatedMs);
    if (!tsMs) continue;
    const customId =
      (t.customId && String(t.customId).trim()) ||
      (t.custom_id && String(t.custom_id).trim()) ||
      id.slice(0, 8).toUpperCase();
    const verb =
      createdMs && updatedMs && updatedMs - createdMs > 60_000
        ? 'aktualisiert'
        : 'erstellt';
    events.push({
      id: `ticket:${id}:${new Date(tsMs).toISOString()}`,
      type: 'ticket',
      title: `Ticket #${customId.replace(/^#/, '')} ${verb}`,
      timestamp: new Date(tsMs).toISOString(),
      href: `/portal/tickets/${encodeURIComponent(id)}`,
    });
  }
  return events
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}

/** Merge return + ticket activities; tenant-filter tickets; take latest N. */
export function mergePortalRecentActivities(
  returnActivities: PortalRecentActivity[],
  ticketActivities: PortalRecentActivity[],
  limit = 10,
): PortalRecentActivity[] {
  const capped = Math.max(8, Math.min(10, limit));
  return [...returnActivities, ...ticketActivities]
    .filter((e) => Boolean(e?.timestamp) && !Number.isNaN(Date.parse(e.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, capped);
}
