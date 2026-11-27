/**
 * Pure helpers for Tickets MASTER-FILTERLISTE Zeitraum (date range) filter.
 * Safe in Node + browser — no I/O.
 */

export type TicketDateField = 'created' | 'updated';

export type TicketZeitraumPreset =
  | 'all'
  | 'today'
  | 'last_7'
  | 'last_30'
  | 'this_month'
  | 'custom';

export const TICKET_ZEITRAUM_OPTIONS: { id: TicketZeitraumPreset; label: string }[] = [
  { id: 'all', label: 'Alle' },
  { id: 'today', label: 'Heute' },
  { id: 'last_7', label: 'Letzte 7 Tage' },
  { id: 'last_30', label: 'Letzte 30 Tage' },
  { id: 'this_month', label: 'Dieser Monat' },
  { id: 'custom', label: 'Benutzerdefiniert' },
];

export const TICKET_DATE_FIELD_OPTIONS: { id: TicketDateField; label: string }[] = [
  { id: 'created', label: 'Erstellt am' },
  { id: 'updated', label: 'Letzte Aktivität' },
];

function berlinTodayIso(now: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now) || now.toISOString().slice(0, 10)
  );
}

function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function startOfMonthIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export type TicketZeitraumRange = {
  dateField: TicketDateField;
  dateFrom: string;
  dateTo: string;
};

/** Resolve a Zeitraum preset into Von/Bis (YYYY-MM-DD, Berlin calendar). */
export function resolveTicketZeitraumPreset(
  preset: TicketZeitraumPreset,
  dateField: TicketDateField = 'created',
  now: Date = new Date(),
): TicketZeitraumRange {
  const today = berlinTodayIso(now);
  switch (preset) {
    case 'today':
      return { dateField, dateFrom: today, dateTo: today };
    case 'last_7':
      return { dateField, dateFrom: addDaysIso(today, -6), dateTo: today };
    case 'last_30':
      return { dateField, dateFrom: addDaysIso(today, -29), dateTo: today };
    case 'this_month':
      return { dateField, dateFrom: startOfMonthIso(today), dateTo: today };
    case 'custom':
      return { dateField, dateFrom: '', dateTo: '' };
    case 'all':
    default:
      return { dateField, dateFrom: '', dateTo: '' };
  }
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof (value as any)?.toDate === 'function') {
    try {
      const d = (value as any).toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  const d = new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toBerlinDayIso(d: Date): string {
  return berlinTodayIso(d);
}

/** True when ticket falls within [dateFrom, dateTo] inclusive on the chosen field. */
export function ticketMatchesZeitraum(
  ticket: { createdAt?: unknown; updatedAt?: unknown },
  range: TicketZeitraumRange,
): boolean {
  const from = String(range.dateFrom || '').trim();
  const to = String(range.dateTo || '').trim();
  if (!from && !to) return true;
  const raw =
    range.dateField === 'updated'
      ? ticket.updatedAt ?? ticket.createdAt
      : ticket.createdAt ?? ticket.updatedAt;
  const d = toDate(raw);
  if (!d) return false;
  const day = toBerlinDayIso(d);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export type TicketFilterSnapshot = Record<string, unknown>;

const DEFAULT_ANY_KEYS = [
  'agent',
  'group',
  'sentiment',
  'created',
  'closedAt',
  'resolvedAt',
  'resolutionDue',
  'firstResponseDue',
  'nextResponseDue',
  'skills',
  'status',
  'priority',
  'type',
  'category',
  'teamCategories',
  'source',
  'tags',
  'company',
  'contacts',
  'product',
  'language',
  'aiConfidence',
  'slaDue',
] as const;

/** Count active MASTER-FILTERLISTE fields for the Filtern badge. */
export function countActiveTicketFilters(filters: TicketFilterSnapshot): number {
  let n = 0;
  for (const key of DEFAULT_ANY_KEYS) {
    const v = filters[key];
    if (v != null && v !== '' && v !== 'any') n += 1;
  }
  if (String(filters.sourceInfo || '').trim()) n += 1;
  const preset = String(filters.zeitraumPreset || 'all');
  if (preset !== 'all') n += 1;
  else if (String(filters.dateFrom || '').trim() || String(filters.dateTo || '').trim()) n += 1;
  return n;
}

/** Tailwind pill classes for PRIORITÄT badges (matches STATUS visual weight). */
export function ticketPriorityPillClass(priorityKey: string | null | undefined): string {
  const k = String(priorityKey || 'medium')
    .toLowerCase()
    .trim();
  if (k === 'urgent' || k === 'critical' || k === 'dringend') {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (k === 'high' || k === 'hoch') {
    return 'bg-orange-50 text-orange-700 border-orange-200';
  }
  if (k === 'low' || k === 'niedrig') {
    return 'bg-slate-100 text-slate-600 border-slate-200';
  }
  return 'bg-sky-50 text-sky-700 border-sky-200';
}

export function ticketPriorityDotClass(priorityKey: string | null | undefined): string {
  const k = String(priorityKey || 'medium')
    .toLowerCase()
    .trim();
  if (k === 'urgent' || k === 'critical' || k === 'dringend') return 'bg-rose-500';
  if (k === 'high' || k === 'hoch') return 'bg-orange-500';
  if (k === 'low' || k === 'niedrig') return 'bg-slate-400';
  return 'bg-sky-500';
}
