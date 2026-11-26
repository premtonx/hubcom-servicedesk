/**
 * Pure helpers for Rücklieferungen filter bar (Zeitraum presets, active-count).
 * Safe in Node + browser — no I/O.
 */

import { toIsoDateOnly } from './hardware-returns-dates.js';

export type ReturnsDateField = 'due' | 'delivery' | 'returned';

export type ReturnsZeitraumPreset =
  | 'all'
  | 'due_today'
  | 'next_7'
  | 'overdue'
  | 'last_30'
  | 'this_month'
  | 'custom';

export const RETURNS_ZEITRAUM_OPTIONS: { id: ReturnsZeitraumPreset; label: string }[] = [
  { id: 'all', label: 'Zeitraum: Alle' },
  { id: 'due_today', label: 'Heute fällig' },
  { id: 'next_7', label: 'Nächste 7 Tage' },
  { id: 'overdue', label: 'Überfällig' },
  { id: 'last_30', label: 'Letzte 30 Tage' },
  { id: 'this_month', label: 'Dieser Monat' },
  { id: 'custom', label: 'Benutzerdefiniert…' },
];

export const RETURNS_DATE_FIELD_OPTIONS: { id: ReturnsDateField; label: string }[] = [
  { id: 'due', label: 'Fälligkeitsdatum' },
  { id: 'delivery', label: 'Lieferdatum' },
  { id: 'returned', label: 'Eingangsdatum' },
];

export type ReturnsFilterDateRange = {
  dateField: ReturnsDateField;
  dateFrom: string;
  dateTo: string;
  /** When preset is overdue, also force overdueBucket=overdue on the client. */
  forceOverdueBucket?: boolean;
};

function berlinTodayIso(now: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now) ||
    toIsoDateOnly(now) ||
    now.toISOString().slice(0, 10)
  );
}

function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return iso;
  const next = new Date(ms + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

function startOfMonthIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Resolve a Zeitraum preset into dateField + Von/Bis (YYYY-MM-DD). */
export function resolveZeitraumPreset(
  preset: ReturnsZeitraumPreset,
  now: Date = new Date(),
  currentField: ReturnsDateField = 'due',
): ReturnsFilterDateRange {
  const today = berlinTodayIso(now);
  switch (preset) {
    case 'due_today':
      return { dateField: 'due', dateFrom: today, dateTo: today };
    case 'next_7':
      return {
        dateField: 'due',
        dateFrom: today,
        dateTo: addDaysIso(today, 7),
      };
    case 'overdue':
      return {
        dateField: 'due',
        dateFrom: '',
        dateTo: addDaysIso(today, -1),
        forceOverdueBucket: true,
      };
    case 'last_30':
      return {
        dateField: currentField === 'returned' ? 'returned' : currentField,
        dateFrom: addDaysIso(today, -30),
        dateTo: today,
      };
    case 'this_month':
      return {
        dateField: currentField,
        dateFrom: startOfMonthIso(today),
        dateTo: today,
      };
    case 'custom':
      return { dateField: currentField, dateFrom: '', dateTo: '' };
    case 'all':
    default:
      return { dateField: currentField, dateFrom: '', dateTo: '' };
  }
}

export type ReturnsAdvancedFilterSnapshot = {
  mailStatus: string;
  overdueBucket: string;
  shippingMethod: string;
  statusFilter: string;
  assigneeFilter: string;
  exportStatus: string;
  dateFrom: string;
  dateTo: string;
  /** True when Zeitraum is not "all" (counts as active even if dates empty, e.g. overdue). */
  zeitraumActive: boolean;
};

/** Count active advanced filters for the Filter (N) badge. */
export function countActiveReturnsAdvancedFilters(
  snap: ReturnsAdvancedFilterSnapshot,
): number {
  let n = 0;
  if (snap.mailStatus && snap.mailStatus !== 'all') n += 1;
  if (snap.overdueBucket && snap.overdueBucket !== 'all') n += 1;
  if (snap.shippingMethod && snap.shippingMethod !== 'all') n += 1;
  if (snap.statusFilter && snap.statusFilter !== 'all') n += 1;
  if (snap.assigneeFilter && snap.assigneeFilter !== 'all') n += 1;
  if (snap.exportStatus && snap.exportStatus !== 'all') n += 1;
  if (snap.dateFrom || snap.dateTo) n += 1;
  return n;
}

/** True when search, Zeitraum, or any advanced filter is active (shows reset). */
export function hasActiveReturnsFilters(
  q: string,
  snap: ReturnsAdvancedFilterSnapshot,
): boolean {
  if (String(q || '').trim()) return true;
  if (snap.zeitraumActive) return true;
  return countActiveReturnsAdvancedFilters(snap) > 0;
}

/** Map dateField + range to API query keys. */
export function dateRangeToApiParams(
  dateField: ReturnsDateField,
  dateFrom: string,
  dateTo: string,
): Record<string, string> {
  const from = String(dateFrom || '').trim();
  const to = String(dateTo || '').trim();
  if (!from && !to) return {};
  if (dateField === 'delivery') {
    return {
      ...(from ? { deliveryFrom: from } : {}),
      ...(to ? { deliveryTo: to } : {}),
    };
  }
  if (dateField === 'returned') {
    return {
      ...(from ? { returnedFrom: from } : {}),
      ...(to ? { returnedTo: to } : {}),
    };
  }
  return {
    ...(from ? { dueFrom: from } : {}),
    ...(to ? { dueTo: to } : {}),
  };
}
