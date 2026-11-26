/**
 * Fast portal-dashboard hardware-returns KPIs + trends.
 * One lean SQL query + O(N + D) aggregation (D ≤ 90 buckets).
 * Safe for unit tests without HTTP when given in-memory rows.
 */

import { queryDb } from '../postgres-backend.js';

const MS_DAY = 86_400_000;
/** Hard cap so "Alle" never exceeds ~90 monthly buckets. */
const MAX_MONTH_BUCKETS = 36;

export type PortalReturnsTrendRange = '7d' | '30d' | '90d' | '12m' | 'all';

export const PORTAL_RETURNS_TREND_RANGES: PortalReturnsTrendRange[] = [
  '7d',
  '30d',
  '90d',
  '12m',
  'all',
];

export interface PortalDashboardReturnsActivityPoint {
  date: string;
  name: string;
  open: number;
  overdue: number;
  returned: number;
}

export interface PortalDashboardReturnsKpis {
  open: number;
  overdue: number;
  stage3: number;
  returnedLast30: number;
}

export interface PortalReturnsTrendSourceRow {
  createdAt: string | null;
  deliveryDate: string | null;
  returnDueDate: string | null;
  returned: boolean;
  returnedAt: string | null;
}

export type PortalReturnsLeanRow = PortalReturnsTrendSourceRow & {
  mail3SentAt?: string | null;
  reminderCount?: number;
};

function berlinDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function berlinMonthKey(d: Date): string {
  return berlinDayKey(d).slice(0, 7);
}

function berlinDayLabelFromMs(dayMs: number): string {
  return new Date(dayMs).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  });
}

function berlinMonthLabelFromMs(monthMs: number): string {
  return new Date(monthMs).toLocaleDateString('de-DE', {
    timeZone: 'UTC',
    month: 'short',
    year: '2-digit',
  });
}

/** Parse any date-ish value to UTC midnight of its Europe/Berlin calendar day. */
export function toBerlinDayMs(raw: string | Date | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const key = berlinDayKey(raw);
    return Date.parse(`${key}T00:00:00.000Z`);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return Date.parse(`${s}T00:00:00.000Z`);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const key = berlinDayKey(d);
  return Date.parse(`${key}T00:00:00.000Z`);
}

function startOfBerlinMonthMs(dayMs: number): number {
  const key = berlinDayKey(new Date(dayMs));
  const [y, m] = key.split('-').map(Number);
  return Date.UTC(y!, m! - 1, 1);
}

function addMonthsUtc(monthMs: number, months: number): number {
  const d = new Date(monthMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

type PreparedRow = {
  createdMs: number;
  /** First day the row is no longer open (returned day), or null if still open. */
  closedMs: number | null;
  dueMs: number | null;
  returnedEventMs: number | null;
  mail3: boolean;
  returned: boolean;
};

function prepareRows(rows: PortalReturnsLeanRow[]): PreparedRow[] {
  const out: PreparedRow[] = [];
  for (const r of rows) {
    const createdMs =
      toBerlinDayMs(r.createdAt) || toBerlinDayMs(r.deliveryDate) || null;
    if (createdMs == null) continue;
    const returnedEventMs = r.returned ? toBerlinDayMs(r.returnedAt) : null;
    const closedMs = r.returned ? returnedEventMs : null;
    const dueMs = toBerlinDayMs(r.returnDueDate) || toBerlinDayMs(r.deliveryDate);
    out.push({
      createdMs,
      closedMs,
      dueMs,
      returnedEventMs,
      mail3: Boolean(r.mail3SentAt) || (Number(r.reminderCount) || 0) >= 3,
      returned: Boolean(r.returned),
    });
  }
  return out;
}

export function computePortalReturnsKpis(
  rows: PortalReturnsLeanRow[],
  now: Date = new Date(),
): PortalDashboardReturnsKpis {
  const todayMs = toBerlinDayMs(now) || Date.parse(`${berlinDayKey(now)}T00:00:00.000Z`);
  const thirtyAgo = todayMs - 30 * MS_DAY;
  let open = 0;
  let overdue = 0;
  let stage3 = 0;
  let returnedLast30 = 0;

  for (const r of rows) {
    const returned = Boolean(r.returned);
    if (!returned) {
      open += 1;
      const dueMs = toBerlinDayMs(r.returnDueDate);
      if (dueMs != null && dueMs < todayMs) overdue += 1;
      if (r.mail3SentAt || (Number(r.reminderCount) || 0) >= 3) stage3 += 1;
    } else if (r.returnedAt) {
      const t = new Date(r.returnedAt).getTime();
      if (!Number.isNaN(t) && t >= thirtyAgo) returnedLast30 += 1;
    }
  }

  return { open, overdue, stage3, returnedLast30 };
}

/**
 * O(N + D) differential-array series for open/overdue snapshots + returned events.
 * Daily for 7d/30d/90d; monthly for 12m/all (≤ MAX_MONTH_BUCKETS).
 */
export function buildReturnsActivitySeriesFast(
  rows: PortalReturnsLeanRow[],
  range: PortalReturnsTrendRange,
  now: Date = new Date(),
): PortalDashboardReturnsActivityPoint[] {
  const prepared = prepareRows(rows);
  const todayMs = toBerlinDayMs(now) || Date.parse(`${berlinDayKey(now)}T00:00:00.000Z`);

  if (range === '12m' || range === 'all') {
    let months = range === '12m' ? 12 : MAX_MONTH_BUCKETS;
    if (range === 'all' && prepared.length) {
      let earliest = todayMs;
      for (const r of prepared) {
        if (r.createdMs < earliest) earliest = r.createdMs;
      }
      const earliestMonth = startOfBerlinMonthMs(earliest);
      const todayMonth = startOfBerlinMonthMs(todayMs);
      const span =
        (new Date(todayMonth).getUTCFullYear() - new Date(earliestMonth).getUTCFullYear()) * 12 +
        (new Date(todayMonth).getUTCMonth() - new Date(earliestMonth).getUTCMonth()) +
        1;
      months = Math.max(1, Math.min(MAX_MONTH_BUCKETS, span));
    }

    const todayMonth = startOfBerlinMonthMs(todayMs);
    const startMonth = addMonthsUtc(todayMonth, -(months - 1));
    const openDelta = new Int32Array(months + 1);
    const overdueDelta = new Int32Array(months + 1);
    const returnedCounts = new Int32Array(months);

    const monthIndex = (monthMs: number): number => {
      const y0 = new Date(startMonth).getUTCFullYear();
      const m0 = new Date(startMonth).getUTCMonth();
      const y1 = new Date(monthMs).getUTCFullYear();
      const m1 = new Date(monthMs).getUTCMonth();
      return (y1 - y0) * 12 + (m1 - m0);
    };

    for (const r of prepared) {
      const createdMonth = startOfBerlinMonthMs(r.createdMs);
      let startIdx = monthIndex(createdMonth);
      if (startIdx >= months) continue;
      if (startIdx < 0) startIdx = 0;

      let endIdx = months; // exclusive — still open through last bucket
      if (r.closedMs != null) {
        const closedMonth = startOfBerlinMonthMs(r.closedMs);
        endIdx = monthIndex(closedMonth);
        // Open through end of month before returned month; if returned mid-month,
        // treat returned month as closed for snapshot-at-month-end when returned
        // before month end — use closed month as exclusive end (not open that month).
        if (endIdx < 0) continue;
        if (endIdx > months) endIdx = months;
      }
      if (startIdx < endIdx) {
        openDelta[startIdx] += 1;
        openDelta[endIdx] -= 1;
        if (r.dueMs != null) {
          // Overdue from the month after due month (snapshot at month end after due).
          const dueMonth = startOfBerlinMonthMs(r.dueMs);
          let overdueStart = monthIndex(addMonthsUtc(dueMonth, 1));
          if (overdueStart < startIdx) overdueStart = startIdx;
          if (overdueStart < endIdx) {
            overdueDelta[overdueStart] += 1;
            overdueDelta[endIdx] -= 1;
          }
        }
      }
      if (r.returnedEventMs != null) {
        const ri = monthIndex(startOfBerlinMonthMs(r.returnedEventMs));
        if (ri >= 0 && ri < months) returnedCounts[ri] += 1;
      }
    }

    const points: PortalDashboardReturnsActivityPoint[] = [];
    let open = 0;
    let overdue = 0;
    for (let i = 0; i < months; i += 1) {
      open += openDelta[i]!;
      overdue += overdueDelta[i]!;
      const monthMs = addMonthsUtc(startMonth, i);
      points.push({
        date: berlinMonthKey(new Date(monthMs)),
        name: berlinMonthLabelFromMs(monthMs),
        open,
        overdue,
        returned: returnedCounts[i]!,
      });
    }
    return points;
  }

  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const rangeStart = todayMs - (days - 1) * MS_DAY;
  const openDelta = new Int32Array(days + 1);
  const overdueDelta = new Int32Array(days + 1);
  const returnedCounts = new Int32Array(days);

  const dayIndex = (dayMs: number): number =>
    Math.floor((dayMs - rangeStart) / MS_DAY);

  for (const r of prepared) {
    let startIdx = dayIndex(r.createdMs);
    if (startIdx >= days) continue;
    if (startIdx < 0) startIdx = 0;

    let endIdx = days; // exclusive
    if (r.closedMs != null) {
      endIdx = dayIndex(r.closedMs);
      if (endIdx < 0) continue;
      if (endIdx > days) endIdx = days;
    }
    if (startIdx < endIdx) {
      openDelta[startIdx] += 1;
      openDelta[endIdx] -= 1;
      if (r.dueMs != null) {
        // Overdue on days strictly after due date while still open.
        let overdueStart = dayIndex(r.dueMs) + 1;
        if (overdueStart < startIdx) overdueStart = startIdx;
        if (overdueStart < endIdx) {
          overdueDelta[overdueStart] += 1;
          overdueDelta[endIdx] -= 1;
        }
      }
    }
    if (r.returnedEventMs != null) {
      const ri = dayIndex(r.returnedEventMs);
      if (ri >= 0 && ri < days) returnedCounts[ri] += 1;
    }
  }

  const points: PortalDashboardReturnsActivityPoint[] = [];
  let open = 0;
  let overdue = 0;
  for (let i = 0; i < days; i += 1) {
    open += openDelta[i]!;
    overdue += overdueDelta[i]!;
    const dayMs = rangeStart + i * MS_DAY;
    points.push({
      date: berlinDayKey(new Date(dayMs)),
      name: berlinDayLabelFromMs(dayMs),
      open,
      overdue,
      returned: returnedCounts[i]!,
    });
  }
  return points;
}

export function buildReturnsActivityByRangeFast(
  rows: PortalReturnsLeanRow[],
  now: Date = new Date(),
): Record<PortalReturnsTrendRange, PortalDashboardReturnsActivityPoint[]> {
  const out = {} as Record<
    PortalReturnsTrendRange,
    PortalDashboardReturnsActivityPoint[]
  >;
  for (const range of PORTAL_RETURNS_TREND_RANGES) {
    out[range] = buildReturnsActivitySeriesFast(rows, range, now);
  }
  return out;
}

/**
 * Single indexed SQL — only the columns needed for KPIs/trends.
 * No history blobs, device JSON, or ticket joins.
 */
export async function fetchPortalReturnsLeanRows(
  organizationId: string,
): Promise<PortalReturnsLeanRow[]> {
  const res = await queryDb(
    `SELECT
       created_at,
       delivery_date,
       return_due_date,
       return_required,
       returned,
       returned_at,
       mail3_sent_at,
       reminder_count
     FROM ticket_hardware_returns
     WHERE organization_id = $1::uuid
       AND return_required = TRUE
     LIMIT 5000`,
    [organizationId],
  );
  return (res.rows || []).map((row: Record<string, unknown>) => ({
    createdAt: row.created_at ? String(row.created_at) : null,
    deliveryDate: row.delivery_date ? String(row.delivery_date).slice(0, 10) : null,
    returnDueDate: row.return_due_date
      ? String(row.return_due_date).slice(0, 10)
      : null,
    returned: row.returned === true || row.returned === 't',
    returnedAt: row.returned_at ? String(row.returned_at) : null,
    mail3SentAt: row.mail3_sent_at ? String(row.mail3_sent_at) : null,
    reminderCount: Number(row.reminder_count) || 0,
  }));
}

/** Load KPIs + all trend ranges for the portal dashboard in one shot. */
export async function loadPortalDashboardReturnsStats(organizationId: string): Promise<{
  returnsKpis: PortalDashboardReturnsKpis;
  returnsActivityByRange: Record<
    PortalReturnsTrendRange,
    PortalDashboardReturnsActivityPoint[]
  >;
}> {
  const rows = await fetchPortalReturnsLeanRows(organizationId);
  const now = new Date();
  return {
    returnsKpis: computePortalReturnsKpis(rows, now),
    returnsActivityByRange: buildReturnsActivityByRangeFast(rows, now),
  };
}
