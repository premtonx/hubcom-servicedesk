/**
 * Single source-of-truth classification for Hardware-Rücklieferungen KPIs.
 * Pure helpers — safe in Node + browser (no I/O).
 *
 * Used identically by:
 * - GET /api/portal/dashboard (lean stats)
 * - GET /api/portal/returns + GET /api/returns (workbench KPIs)
 * - Portal Übersicht + ReturnsWorkbench KPI cards
 */

const MS_DAY = 86_400_000;

export interface ReminderStageSentLike {
  stage: number;
  sentAt?: string | null;
}

/** Minimal row shape for KPI classification (snake or camel via adapters). */
export interface HardwareReturnKpiRow {
  returnRequired: boolean;
  returned: boolean;
  returnDueDate: string | null;
  returnedAt: string | null;
  mail1SentAt: string | null;
  reminderStages: ReminderStageSentLike[];
  reminderCount: number;
}

export interface HardwareReturnsKpiCounts {
  open: number;
  overdue: number;
  /** Escalated: open + highest sent stage ≥ 4 (API field name kept as stage3). */
  stage3: number;
  returnedLast30: number;
}

function berlinDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** UTC midnight of the Europe/Berlin calendar day for a date-ish value. */
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

export function berlinTodayMs(now: Date = new Date()): number {
  return toBerlinDayMs(now) || Date.parse(`${berlinDayKey(now)}T00:00:00.000Z`);
}

/** True when `date` is a calendar day strictly before today (Europe/Berlin). */
export function isBeforeTodayBerlin(
  date: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const dueMs = toBerlinDayMs(date);
  if (dueMs == null) return false;
  return dueMs < berlinTodayMs(now);
}

function normalizeStages(raw: unknown): ReminderStageSentLike[] {
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

/** Stage 1 Erinnerung already sent (legacy mail1 or reminder_stages). */
export function hasStage1ReminderSent(
  row: Pick<HardwareReturnKpiRow, 'mail1SentAt' | 'reminderStages'>,
): boolean {
  if (row.mail1SentAt) return true;
  return (row.reminderStages || []).some(
    (s) => s.stage === 1 && Boolean(s.sentAt),
  );
}

/** Highest stage with a sentAt (falls back to reminderCount). */
export function highestSentStage(
  row: Pick<HardwareReturnKpiRow, 'reminderStages' | 'reminderCount' | 'mail1SentAt'>,
): number {
  let max = 0;
  for (const s of row.reminderStages || []) {
    if (s.sentAt && s.stage > max) max = s.stage;
  }
  const count = Number(row.reminderCount) || 0;
  if (count > max) max = count;
  // Legacy: mail1 alone without stages/count still counts as stage 1.
  if (max < 1 && row.mail1SentAt) max = 1;
  return max;
}

export function isOpenReturn(
  row: Pick<HardwareReturnKpiRow, 'returnRequired' | 'returned'>,
): boolean {
  return row.returnRequired === true && row.returned === false;
}

/**
 * Überfällig: open AND (due date before today Europe/Berlin OR 1. Erinnerung sent).
 */
export function isOverdueReturn(
  row: HardwareReturnKpiRow,
  now: Date = new Date(),
): boolean {
  if (!isOpenReturn(row)) return false;
  if (isBeforeTodayBerlin(row.returnDueDate, now)) return true;
  if (hasStage1ReminderSent(row)) return true;
  return false;
}

/** Letzte Stufe / Eskaliert (4.+ Erinnerung). */
export function isEscalatedReturn(row: HardwareReturnKpiRow): boolean {
  if (!isOpenReturn(row)) return false;
  return highestSentStage(row) >= 4;
}

/** Zurückgeliefert within rolling 30 days from `now`. */
export function isReturnedLast30(
  row: Pick<HardwareReturnKpiRow, 'returned' | 'returnedAt'>,
  now: Date = new Date(),
): boolean {
  if (!row.returned || !row.returnedAt) return false;
  const t = new Date(row.returnedAt).getTime();
  if (Number.isNaN(t)) return false;
  return t >= now.getTime() - 30 * MS_DAY;
}

/**
 * First Berlin-day ms when a still-open return becomes overdue for trend buckets.
 * Due: day AFTER return_due_date. Mail1: day mail1 was sent. Earliest wins.
 */
export function overdueStartBerlinMs(row: HardwareReturnKpiRow): number | null {
  const candidates: number[] = [];
  const dueMs = toBerlinDayMs(row.returnDueDate);
  if (dueMs != null) candidates.push(dueMs + MS_DAY);
  const mail1Ms = toBerlinDayMs(row.mail1SentAt);
  if (mail1Ms != null) candidates.push(mail1Ms);
  // Stage-1 sentAt from reminder_stages if mail1 column empty.
  if (mail1Ms == null) {
    for (const s of row.reminderStages || []) {
      if (s.stage === 1 && s.sentAt) {
        const ms = toBerlinDayMs(s.sentAt);
        if (ms != null) candidates.push(ms);
      }
    }
  }
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

export function computeHardwareReturnsKpis(
  rows: HardwareReturnKpiRow[],
  now: Date = new Date(),
): HardwareReturnsKpiCounts {
  let open = 0;
  let overdue = 0;
  let stage3 = 0;
  let returnedLast30 = 0;
  for (const row of rows) {
    if (isOpenReturn(row)) {
      open += 1;
      if (isOverdueReturn(row, now)) overdue += 1;
      if (isEscalatedReturn(row)) stage3 += 1;
    } else if (isReturnedLast30(row, now)) {
      returnedLast30 += 1;
    }
  }
  return { open, overdue, stage3, returnedLast30 };
}

/** Adapt lean dashboard row (camelCase). */
export function kpiRowFromLean(row: {
  returnRequired?: boolean;
  returned: boolean;
  returnDueDate?: string | null;
  returnedAt?: string | null;
  mail1SentAt?: string | null;
  reminderStages?: ReminderStageSentLike[] | null;
  reminderCount?: number | null;
}): HardwareReturnKpiRow {
  return {
    returnRequired: row.returnRequired !== false,
    returned: Boolean(row.returned),
    returnDueDate: row.returnDueDate || null,
    returnedAt: row.returnedAt || null,
    mail1SentAt: row.mail1SentAt || null,
    reminderStages: normalizeStages(row.reminderStages),
    reminderCount: Number(row.reminderCount) || 0,
  };
}

/** Adapt full TicketHardwareReturnRecord / workbench hardwareReturn (snake_case). */
export function kpiRowFromHardwareRecord(hw: {
  return_required?: boolean;
  returned?: boolean;
  return_due_date?: string | null;
  returned_at?: string | null;
  mail1_sent_at?: string | null;
  reminder_stages?: ReminderStageSentLike[] | null;
  reminder_count?: number | null;
}): HardwareReturnKpiRow {
  return {
    returnRequired: hw.return_required === true,
    returned: Boolean(hw.returned),
    returnDueDate: hw.return_due_date || null,
    returnedAt: hw.returned_at || null,
    mail1SentAt: hw.mail1_sent_at || null,
    reminderStages: normalizeStages(hw.reminder_stages),
    reminderCount: Number(hw.reminder_count) || 0,
  };
}
