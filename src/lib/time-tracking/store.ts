import { queryDb, getDocDirect } from '../postgres-backend.js';
import { loadTimeTrackingSettings, resolveHourlyRate, roundHours, roundMoney } from './settings.js';
import type {
  TimeEntry,
  TimeEntryInput,
  TimeEntryListFilters,
  TimeEntryUpdateInput,
} from './types.js';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function minutesFromHours(hours: number): number {
  const whole = Math.floor(hours);
  return Math.round((hours - whole) * 60) % 60;
}

function rowToEntry(row: Record<string, unknown>): TimeEntry {
  const hours = roundHours(Number(row.hours) || 0);
  const minutes =
    row.minutes != null && row.minutes !== ''
      ? Math.max(0, Math.min(59, Math.round(Number(row.minutes) || 0)))
      : minutesFromHours(hours);
  const hourlyRate = roundMoney(Number(row.hourly_rate ?? row.hourlyRate) || 0);
  const totalAmount = roundMoney(
    Number(row.total_amount ?? row.totalAmount) || hours * hourlyRate,
  );
  const synced = row.sharepoint_synced_at ?? row.sharepointSyncedAt ?? row.graphSyncedAt ?? null;
  const syncedStr = synced ? asString(synced) : null;
  return {
    id: asString(row.id),
    ticketId: row.ticket_id == null || row.ticket_id === '' ? null : asString(row.ticket_id),
    organizationId:
      row.organization_id == null || row.organization_id === ''
        ? null
        : asString(row.organization_id),
    ticketNumber: asString(row.ticket_number ?? row.ticketNumber),
    ticketSubject: asString(row.ticket_subject ?? row.ticketSubject),
    customerCompany: asString(row.customer_company ?? row.customerCompany),
    userId: asString(row.user_id ?? row.userId),
    agentName: asString(row.agent_name ?? row.agentName),
    kuerzel: asString(row.kuerzel).toUpperCase(),
    hours,
    minutes,
    sonderzahlung: row.is_special_rate === true || row.sonderzahlung === true,
    hourlyRate,
    totalAmount,
    description: asString(row.note ?? row.description),
    date: asString(row.entry_date ?? row.date, new Date().toISOString().slice(0, 10)).slice(0, 10),
    createdAt: asString(row.created_at ?? row.createdAt, new Date().toISOString()),
    updatedAt: row.updated_at || row.updatedAt ? asString(row.updated_at ?? row.updatedAt) : undefined,
    graphSyncedAt: syncedStr,
    sharepointSyncedAt: syncedStr,
  };
}

async function enrichFromTicket(ticketId: string): Promise<{
  ticketNumber: string;
  ticketSubject: string;
  customerCompany: string;
  organizationId: string | null;
}> {
  const ticket = await getDocDirect('tickets', ticketId);
  if (!ticket) {
    return { ticketNumber: '', ticketSubject: '', customerCompany: '', organizationId: null };
  }
  const customId = asString(ticket.customId).replace(/^#/, '');
  const organizationId =
    asString(ticket.organizationId || ticket.organization_id).trim() || null;
  return {
    ticketNumber: customId || asString(ticket.id, ticketId),
    ticketSubject: asString(ticket.subject),
    customerCompany: asString(ticket.company || ticket.customerCompany || ticket.customerName),
    organizationId,
  };
}

async function enrichOrgName(organizationId: string | null): Promise<string> {
  if (!organizationId) return '';
  try {
    const res = await queryDb(
      `SELECT name FROM organizations WHERE id = $1::uuid LIMIT 1`,
      [organizationId],
    );
    return asString(res.rows[0]?.name);
  } catch {
    return '';
  }
}

function buildListWhere(filters: TimeEntryListFilters = {}): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };

  if (filters.userId) add('user_id = ?', filters.userId);
  if (filters.organizationId) add('organization_id = ?::uuid', filters.organizationId);
  if (filters.ticketId) add('ticket_id = ?', filters.ticketId);
  if (filters.from) add('entry_date >= ?::date', filters.from);
  if (filters.to) add('entry_date <= ?::date', filters.to);
  if (filters.type === 'with_ticket') clauses.push('ticket_id IS NOT NULL');
  if (filters.type === 'without_ticket') clauses.push('ticket_id IS NULL');
  if (filters.onlyUnsynced) clauses.push('sharepoint_synced_at IS NULL');

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export async function listTimeEntriesByTicket(ticketId: string): Promise<TimeEntry[]> {
  return listTimeEntries({ ticketId });
}

export async function listAllTimeEntries(
  options?: TimeEntryListFilters,
): Promise<TimeEntry[]> {
  return listTimeEntries(options || {});
}

export async function listTimeEntries(filters: TimeEntryListFilters = {}): Promise<TimeEntry[]> {
  const { where, params } = buildListWhere(filters);
  const res = await queryDb(
    `SELECT * FROM time_entries ${where}
     ORDER BY entry_date DESC, created_at DESC`,
    params,
  );
  return res.rows.map((row) => rowToEntry(row as Record<string, unknown>));
}

export async function getTimeEntry(id: string): Promise<TimeEntry | null> {
  const res = await queryDb(`SELECT * FROM time_entries WHERE id = $1::uuid LIMIT 1`, [id]);
  if (!res.rowCount) return null;
  return rowToEntry(res.rows[0] as Record<string, unknown>);
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
  const ticketId = String(params.input.ticketId || '').trim() || null;
  let organizationId = String(params.input.organizationId || '').trim() || null;
  if (!ticketId && !organizationId) {
    throw new Error('ticket_id oder organization_id ist erforderlich.');
  }

  let ticketMeta = {
    ticketNumber: '',
    ticketSubject: '',
    customerCompany: '',
    organizationId: null as string | null,
  };
  if (ticketId) {
    ticketMeta = await enrichFromTicket(ticketId);
    if (!organizationId) organizationId = ticketMeta.organizationId;
  }

  const customerCompany =
    params.input.customerCompany ||
    ticketMeta.customerCompany ||
    (await enrichOrgName(organizationId));

  const sonderzahlung = params.input.sonderzahlung === true;
  const hourlyRate = resolveHourlyRate(settings, sonderzahlung);
  const totalAmount = roundMoney(hours * hourlyRate);
  const minutes =
    params.input.minutes != null
      ? Math.max(0, Math.min(59, Math.round(Number(params.input.minutes) || 0)))
      : minutesFromHours(hours);
  const date = (params.input.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

  const res = await queryDb(
    `INSERT INTO time_entries (
       ticket_id, organization_id, user_id, agent_name, kuerzel,
       hours, minutes, entry_date, hourly_rate, is_special_rate, total_amount,
       note, ticket_number, ticket_subject, customer_company
     ) VALUES (
       $1, $2::uuid, $3, $4, $5,
       $6, $7, $8::date, $9, $10, $11,
       $12, $13, $14, $15
     )
     RETURNING *`,
    [
      ticketId,
      organizationId,
      params.userId,
      params.agentName,
      String(params.input.kuerzel || '').trim().toUpperCase() || 'XX',
      hours,
      minutes,
      date,
      hourlyRate,
      sonderzahlung,
      totalAmount,
      String(params.input.description || '').trim(),
      params.input.ticketNumber || ticketMeta.ticketNumber,
      params.input.ticketSubject || ticketMeta.ticketSubject,
      customerCompany,
    ],
  );
  return rowToEntry(res.rows[0] as Record<string, unknown>);
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
  const minutes =
    patch.minutes !== undefined
      ? Math.max(0, Math.min(59, Math.round(Number(patch.minutes) || 0)))
      : existing.minutes ?? minutesFromHours(hours);

  const ticketId =
    patch.ticketId !== undefined
      ? String(patch.ticketId || '').trim() || null
      : existing.ticketId;
  const organizationId =
    patch.organizationId !== undefined
      ? String(patch.organizationId || '').trim() || null
      : existing.organizationId;
  if (!ticketId && !organizationId) {
    throw new Error('ticket_id oder organization_id ist erforderlich.');
  }

  const res = await queryDb(
    `UPDATE time_entries SET
       ticket_id = $2,
       organization_id = $3::uuid,
       kuerzel = $4,
       hours = $5,
       minutes = $6,
       entry_date = $7::date,
       hourly_rate = $8,
       is_special_rate = $9,
       total_amount = $10,
       note = $11,
       ticket_number = $12,
       ticket_subject = $13,
       customer_company = $14,
       sharepoint_synced_at = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [
      id,
      ticketId,
      organizationId,
      patch.kuerzel !== undefined
        ? String(patch.kuerzel).trim().toUpperCase() || existing.kuerzel
        : existing.kuerzel,
      hours,
      minutes,
      patch.date !== undefined ? String(patch.date).slice(0, 10) : existing.date,
      hourlyRate,
      sonderzahlung,
      totalAmount,
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
      patch.ticketNumber ?? existing.ticketNumber,
      patch.ticketSubject ?? existing.ticketSubject,
      patch.customerCompany ?? existing.customerCompany,
    ],
  );
  if (!res.rowCount) throw new Error('Zeiteintrag nicht gefunden.');
  return rowToEntry(res.rows[0] as Record<string, unknown>);
}

export async function deleteTimeEntry(id: string): Promise<void> {
  await queryDb(`DELETE FROM time_entries WHERE id = $1::uuid`, [id]);
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

export async function markEntriesGraphSynced(
  ids: string[],
  syncedAt = new Date().toISOString(),
): Promise<void> {
  if (!ids.length) return;
  await queryDb(
    `UPDATE time_entries
        SET sharepoint_synced_at = $2::timestamptz, updated_at = NOW()
      WHERE id = ANY($1::uuid[])`,
    [ids, syncedAt],
  );
}
