/**
 * Portal-dashboard hardware-returns helpers.
 * Live dashboard KPIs use SQL COUNT FILTER (portal-returns-sql-stats.ts).
 * In-memory builders below remain for unit tests / offline fixtures.
 */

import { queryDb } from '../postgres-backend.js';
import {
  computeHardwareReturnsKpis,
  kpiRowFromLean,
  overdueStartBerlinMs,
  toBerlinDayMs,
  type HardwareReturnKpiRow,
  type HardwareReturnsKpiCounts,
  type ReminderStageSentLike,
} from './hardware-returns-kpis.js';
import {
  getCachedPortalDashboardReturns,
  setCachedPortalDashboardReturns,
} from './portal-returns-cache.js';
import { fetchPortalReturnsKpisSql } from './portal-returns-sql-stats.js';

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

export type PortalDashboardReturnsKpis = HardwareReturnsKpiCounts;

export interface PortalReturnsTrendSourceRow {
  createdAt: string | null;
  deliveryDate: string | null;
  returnDueDate: string | null;
  returned: boolean;
  returnedAt: string | null;
}

export type PortalReturnsLeanRow = PortalReturnsTrendSourceRow & {
  returnRequired?: boolean;
  mail1SentAt?: string | null;
  reminderStages?: ReminderStageSentLike[];
  reminderCount?: number;
};

export { toBerlinDayMs } from './hardware-returns-kpis.js';

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
  /** First day overdue while open; null if never overdue by due/mail1 rules. */
  overdueStartMs: number | null;
  returnedEventMs: number | null;
};

function prepareRows(rows: PortalReturnsLeanRow[]): PreparedRow[] {
  const out: PreparedRow[] = [];
  for (const r of rows) {
    const createdMs =
      toBerlinDayMs(r.createdAt) || toBerlinDayMs(r.deliveryDate) || null;
    if (createdMs == null) continue;
    const returnedEventMs = r.returned ? toBerlinDayMs(r.returnedAt) : null;
    const closedMs = r.returned ? returnedEventMs : null;
    const kpiRow: HardwareReturnKpiRow = kpiRowFromLean(r);
    out.push({
      createdMs,
      closedMs,
      overdueStartMs: overdueStartBerlinMs(kpiRow),
      returnedEventMs,
    });
  }
  return out;
}

export function computePortalReturnsKpis(
  rows: PortalReturnsLeanRow[],
  now: Date = new Date(),
): PortalDashboardReturnsKpis {
  return computeHardwareReturnsKpis(
    rows.map((r) => kpiRowFromLean(r)),
    now,
  );
}

/**
 * O(N + D) differential-array series for open/overdue snapshots + returned events.
 * Daily for 7d/30d/90d; monthly for 12m/all (≤ MAX_MONTH_BUCKETS).
 *
 * Überfällig is a strict subset of Offen: overdue only after due+1 or mail1 day.
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
        if (endIdx < 0) continue;
        if (endIdx > months) endIdx = months;
      }
      if (startIdx < endIdx) {
        openDelta[startIdx] += 1;
        openDelta[endIdx] -= 1;
        if (r.overdueStartMs != null) {
          let overdueStart = monthIndex(startOfBerlinMonthMs(r.overdueStartMs));
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
      if (r.overdueStartMs != null) {
        let overdueStart = dayIndex(r.overdueStartMs);
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

function parseStagesJson(raw: unknown): ReminderStageSentLike[] {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      return parseStagesJson(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: ReminderStageSentLike[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const stage = Number((item as { stage?: unknown }).stage);
    if (!Number.isFinite(stage) || stage < 1) continue;
    const sentAt = (item as { sentAt?: unknown }).sentAt;
    out.push({
      stage: Math.floor(stage),
      sentAt: sentAt == null || sentAt === '' ? null : String(sentAt),
    });
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
       mail1_sent_at,
       reminder_stages,
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
    returnRequired: row.return_required === true || row.return_required === 't',
    returned: row.returned === true || row.returned === 't',
    returnedAt: row.returned_at ? String(row.returned_at) : null,
    mail1SentAt: row.mail1_sent_at ? String(row.mail1_sent_at) : null,
    reminderStages: parseStagesJson(row.reminder_stages),
    reminderCount: Number(row.reminder_count) || 0,
  }));
}

/**
 * Dashboard returns KPIs only — single SQL COUNT FILTER + 20s org cache.
 * Trends are served by GET /api/portal/returns/trends (not embedded here).
 */
export async function loadPortalDashboardReturnsStats(organizationId: string): Promise<{
  returnsKpis: PortalDashboardReturnsKpis;
  /** Always null — trends moved to /api/portal/returns/trends. */
  returnsActivityByRange: null;
}> {
  const cached = getCachedPortalDashboardReturns<{
    returnsKpis: PortalDashboardReturnsKpis;
    returnsActivityByRange: null;
  }>(organizationId);
  if (cached) return cached;

  const returnsKpis = await fetchPortalReturnsKpisSql(organizationId);
  const payload = { returnsKpis, returnsActivityByRange: null as null };
  setCachedPortalDashboardReturns(organizationId, payload);
  return payload;
}
