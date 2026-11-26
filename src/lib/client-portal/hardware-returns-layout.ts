/**
 * Pure helpers for Rücklieferungen Liste | Kanban | Karten layouts.
 * Kanban uses lifecycle columns (Part 1 KPI classifier); Liste/Karten keep catalog statuses.
 */

import {
  isEscalatedReturn,
  isOpenReturn,
  isOverdueReturn,
  isReturnedLast30,
  kpiRowFromHardwareRecord,
  type HardwareReturnKpiRow,
} from './hardware-returns-kpis.js';

/** Default catalog statuses for new orgs (Liste / settings). Existing org catalogs preserved in DB. */
export const DEFAULT_RETURN_STATUSES = [
  'Neu',
  'Warten auf Third Level',
  'Abgeschlossen',
] as const;

export type ReturnsLayoutItemLike = {
  hardwareReturn: {
    status?: string | null;
    return_required?: boolean;
    returned?: boolean;
    return_due_date?: string | null;
    returned_at?: string | null;
    mail1_sent_at?: string | null;
    reminder_stages?: Array<{ stage: number; sentAt?: string | null }> | null;
    reminder_count?: number | null;
  };
};

/** Fixed Kanban lifecycle columns matching top KPI bars. */
export type ReturnsLifecycleColumnId =
  | 'open'
  | 'overdue'
  | 'escalated'
  | 'returned';

export interface ReturnsLifecycleColumnDef {
  id: ReturnsLifecycleColumnId;
  label: string;
  /** Tailwind accent classes for column header border / dot. */
  accentBorder: string;
  accentDot: string;
  accentBadge: string;
}

export const RETURNS_LIFECYCLE_COLUMNS: ReturnsLifecycleColumnDef[] = [
  {
    id: 'open',
    label: 'Offen',
    accentBorder: 'border-t-sky-500',
    accentDot: 'bg-sky-500',
    accentBadge: 'bg-sky-50 text-sky-700 border-sky-100',
  },
  {
    id: 'overdue',
    label: 'Überfällig',
    accentBorder: 'border-t-rose-500',
    accentDot: 'bg-rose-500',
    accentBadge: 'bg-rose-50 text-rose-700 border-rose-100',
  },
  {
    id: 'escalated',
    label: 'Letzte Stufe / Eskaliert (4.+ Erinnerung)',
    accentBorder: 'border-t-violet-500',
    accentDot: 'bg-violet-500',
    accentBadge: 'bg-violet-50 text-violet-700 border-violet-100',
  },
  {
    id: 'returned',
    label: 'Zurückgeliefert / Eingegangen',
    accentBorder: 'border-t-emerald-500',
    accentDot: 'bg-emerald-500',
    accentBadge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  },
];

/**
 * Build Liste/Karten status columns from the org status catalog plus orphan statuses.
 * (Kanban no longer uses this — see resolveReturnsLifecycleColumn.)
 */
export function buildReturnsStatusColumns(
  catalogStatuses: string[],
  items: ReturnsLayoutItemLike[],
): string[] {
  const base =
    catalogStatuses.length > 0 ? [...catalogStatuses] : [...DEFAULT_RETURN_STATUSES];
  const seen = new Set(base.map((s) => s.toLowerCase()));
  for (const it of items) {
    const label = String(it.hardwareReturn?.status || 'Neu').trim() || 'Neu';
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      base.push(label);
    }
  }
  return base;
}

/** Resolve which catalog status column a return belongs to (Liste/Karten). */
export function resolveReturnsStatusColumn(
  status: string | null | undefined,
  columns: string[],
): string {
  const label = String(status || 'Neu').trim() || 'Neu';
  return columns.find((c) => c.toLowerCase() === label.toLowerCase()) || columns[0] || 'Neu';
}

function kpiRowFromLayoutItem(it: ReturnsLayoutItemLike): HardwareReturnKpiRow {
  return kpiRowFromHardwareRecord(it.hardwareReturn || {});
}

/**
 * Lifecycle Kanban bucket for one return (Part 1 classifier).
 * Open + not overdue → open; overdue + not escalated → overdue; escalated → escalated;
 * returned → returned (caller may further restrict to last 30 days).
 */
export function resolveReturnsLifecycleColumn(
  item: ReturnsLayoutItemLike,
  now: Date = new Date(),
): ReturnsLifecycleColumnId | null {
  const row = kpiRowFromLayoutItem(item);
  if (row.returned) return 'returned';
  if (!isOpenReturn(row)) return null;
  if (isEscalatedReturn(row)) return 'escalated';
  if (isOverdueReturn(row, now)) return 'overdue';
  return 'open';
}

export type BuildLifecycleBucketsOptions = {
  now?: Date;
  /**
   * When false (default), returned column only includes last-30-days returns.
   * Set true when the user selected Erledigt/Alle (wider scan).
   */
  includeAllReturned?: boolean;
};

/** Bucket items into the 4 fixed lifecycle Kanban columns. */
export function buildReturnsLifecycleBuckets<T extends ReturnsLayoutItemLike>(
  items: T[],
  opts: BuildLifecycleBucketsOptions = {},
): Record<ReturnsLifecycleColumnId, T[]> {
  const now = opts.now || new Date();
  const includeAllReturned = opts.includeAllReturned === true;
  const buckets: Record<ReturnsLifecycleColumnId, T[]> = {
    open: [],
    overdue: [],
    escalated: [],
    returned: [],
  };
  for (const it of items) {
    const col = resolveReturnsLifecycleColumn(it, now);
    if (!col) continue;
    if (col === 'returned') {
      const row = kpiRowFromLayoutItem(it);
      if (!includeAllReturned && !isReturnedLast30(row, now)) continue;
      buckets.returned.push(it);
      continue;
    }
    buckets[col].push(it);
  }
  return buckets;
}
