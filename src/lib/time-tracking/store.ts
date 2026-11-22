import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  setDocDirect,
} from '../postgres-backend.js';
import { loadTimeTrackingSettings, resolveHourlyRate, roundHours, roundMoney } from './settings.js';
import {
  TIME_ENTRIES_COLLECTION,
  type TimeEntry,
  type TimeEntryInput,
  type TimeEntryUpdateInput,
} from './types.js';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function normalizeEntry(id: string, data: Record<string, unknown>): TimeEntry {
  const hours = roundHours(Number(data.hours) || 0);
  const hourlyRate = roundMoney(Number(data.hourlyRate) || 0);
  const totalAmount = roundMoney(
    typeof data.totalAmount === 'number' ? data.totalAmount : hours * hourlyRate,
  );
  return {
    id,
    ticketId: asString(data.ticketId),
    ticketNumber: asString(data.ticketNumber),
    ticketSubject: asString(data.ticketSubject),
    customerCompany: asString(data.customerCompany),
    userId: asString(data.userId),
    agentName: asString(data.agentName),
    kuerzel: asString(data.kuerzel).toUpperCase(),
    hours,
    sonderzahlung: data.sonderzahlung === true,
    hourlyRate,
    totalAmount,
    description: asString(data.description),
    date: asString(data.date, new Date().toISOString().slice(0, 10)),
    createdAt: asString(data.createdAt, new Date().toISOString()),
    updatedAt: data.updatedAt ? asString(data.updatedAt) : undefined,
    graphSyncedAt: data.graphSyncedAt ? asString(data.graphSyncedAt) : null,
  };
}

async function enrichFromTicket(ticketId: string): Promise<{
  ticketNumber: string;
  ticketSubject: string;
  customerCompany: string;
}> {
  const ticket = await getDocDirect('tickets', ticketId);
  if (!ticket) {
    return { ticketNumber: '', ticketSubject: '', customerCompany: '' };
  }
  const customId = asString(ticket.customId).replace(/^#/, '');
  return {
    ticketNumber: customId || asString(ticket.id, ticketId),
    ticketSubject: asString(ticket.subject),
    customerCompany: asString(ticket.company || ticket.customerCompany || ticket.customerName),
  };
}

export async function listTimeEntriesByTicket(ticketId: string): Promise<TimeEntry[]> {
  const rows = await getDocsDirect(TIME_ENTRIES_COLLECTION, [
    { type: 'where', field: 'ticketId', op: '==', value: ticketId },
  ]);
  return rows
    .map((row) => normalizeEntry(String(row.id), row as Record<string, unknown>))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function listAllTimeEntries(options?: {
  from?: string;
  to?: string;
}): Promise<TimeEntry[]> {
  const rows = await getDocsDirect(TIME_ENTRIES_COLLECTION, []);
  let entries = rows.map((row) => normalizeEntry(String(row.id), row as Record<string, unknown>));
  if (options?.from) {
    entries = entries.filter((e) => e.date >= options.from!);
  }
  if (options?.to) {
    entries = entries.filter((e) => e.date <= options.to!);
  }
  return entries.sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)),
  );
}

export async function getTimeEntry(id: string): Promise<TimeEntry | null> {
  const row = await getDocDirect(TIME_ENTRIES_COLLECTION, id);
  if (!row) return null;
  return normalizeEntry(id, row as Record<string, unknown>);
}

export async function createTimeEntry(params: {
  input: TimeEntryInput;
  userId: string;
  agentName: string;
}): Promise<TimeEntry> {
  const settings = await loadTimeTrackingSettings();
  const hours = roundHours(Number(params.input.hours) || 0);
  if (hours <= 0) {
    throw new Error('Stunden müssen größer als 0 sein.');
  }
  const sonderzahlung = params.input.sonderzahlung === true;
  const hourlyRate = resolveHourlyRate(settings, sonderzahlung);
  const totalAmount = roundMoney(hours * hourlyRate);
  const ticketMeta = await enrichFromTicket(params.input.ticketId);
  const now = new Date().toISOString();
  const date = (params.input.date || now.slice(0, 10)).slice(0, 10);

  const payload = {
    ticketId: params.input.ticketId,
    ticketNumber: params.input.ticketNumber || ticketMeta.ticketNumber,
    ticketSubject: params.input.ticketSubject || ticketMeta.ticketSubject,
    customerCompany: params.input.customerCompany || ticketMeta.customerCompany,
    userId: params.userId,
    agentName: params.agentName,
    kuerzel: String(params.input.kuerzel || '').trim().toUpperCase() || 'XX',
    hours,
    sonderzahlung,
    hourlyRate,
    totalAmount,
    description: String(params.input.description || '').trim(),
    date,
    createdAt: now,
    updatedAt: now,
    graphSyncedAt: null,
  };

  const created = await addDocDirect(TIME_ENTRIES_COLLECTION, payload);
  return normalizeEntry(String(created.id), { ...payload, id: created.id });
}

export async function updateTimeEntry(
  id: string,
  patch: TimeEntryUpdateInput,
): Promise<TimeEntry> {
  const existing = await getTimeEntry(id);
  if (!existing) {
    throw new Error('Zeiteintrag nicht gefunden.');
  }
  const settings = await loadTimeTrackingSettings();
  const hours = patch.hours !== undefined ? roundHours(Number(patch.hours) || 0) : existing.hours;
  if (hours <= 0) {
    throw new Error('Stunden müssen größer als 0 sein.');
  }
  const sonderzahlung =
    patch.sonderzahlung !== undefined ? patch.sonderzahlung === true : existing.sonderzahlung;
  const hourlyRate = resolveHourlyRate(settings, sonderzahlung);
  const totalAmount = roundMoney(hours * hourlyRate);
  const now = new Date().toISOString();

  const next: TimeEntry = {
    ...existing,
    kuerzel:
      patch.kuerzel !== undefined
        ? String(patch.kuerzel).trim().toUpperCase() || existing.kuerzel
        : existing.kuerzel,
    hours,
    sonderzahlung,
    hourlyRate,
    totalAmount,
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    date: patch.date !== undefined ? String(patch.date).slice(0, 10) : existing.date,
    ticketNumber: patch.ticketNumber ?? existing.ticketNumber,
    ticketSubject: patch.ticketSubject ?? existing.ticketSubject,
    customerCompany: patch.customerCompany ?? existing.customerCompany,
    updatedAt: now,
    // Rate/hours change → needs re-sync
    graphSyncedAt: null,
  };

  await setDocDirect(TIME_ENTRIES_COLLECTION, id, next);
  return next;
}

export async function deleteTimeEntry(id: string): Promise<void> {
  await deleteDocDirect(TIME_ENTRIES_COLLECTION, id);
}

export function summarizeEntries(entries: TimeEntry[]): {
  totalHours: number;
  totalAmount: number;
  count: number;
} {
  const totalHours = roundHours(entries.reduce((sum, e) => sum + e.hours, 0));
  const totalAmount = roundMoney(entries.reduce((sum, e) => sum + e.totalAmount, 0));
  return { totalHours, totalAmount, count: entries.length };
}

export async function markEntriesGraphSynced(ids: string[], syncedAt = new Date().toISOString()): Promise<void> {
  for (const id of ids) {
    const existing = await getTimeEntry(id);
    if (!existing) continue;
    await setDocDirect(TIME_ENTRIES_COLLECTION, id, {
      ...existing,
      graphSyncedAt: syncedAt,
      updatedAt: existing.updatedAt || existing.createdAt,
    });
  }
}
