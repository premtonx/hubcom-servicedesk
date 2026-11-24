/**
 * Canonical ticket status groups shared by Dashboard KPIs and /tickets filters.
 * Keep SQL, filterTicketsByView, and URL ?status= mappings aligned with these helpers.
 */

import type { Ticket } from '../types';

const TERMINAL_EXCLUDED = new Set([
  'trash',
  'spam',
  'merged',
  'deleted',
  'archived',
]);

export function normalizeTicketStatus(status: unknown): string {
  return String(status || '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
}

export function isExcludedTicketStatus(status: unknown): boolean {
  return TERMINAL_EXCLUDED.has(normalizeTicketStatus(status));
}

/** Live “Offene Tickets” / sidebar Offen — status open (or legacy `new`). */
export function isOpenQueueTicket(ticket: Pick<Ticket, 'status'>): boolean {
  if (isExcludedTicketStatus(ticket.status)) return false;
  const s = normalizeTicketStatus(ticket.status);
  return s === 'open' || s === 'new';
}

/**
 * Live “In Bearbeitung” — pending + in_progress (sidebar “In Progress” / status_pending
 * historically used `pending`; newer tickets may use `in_progress`).
 */
export function isInProgressQueueTicket(ticket: Pick<Ticket, 'status'>): boolean {
  if (isExcludedTicketStatus(ticket.status)) return false;
  const s = normalizeTicketStatus(ticket.status);
  return s === 'pending' || s === 'in_progress';
}

/** Gelöst queue — resolved + closed (never trash/spam/merged). */
export function isResolvedQueueTicket(ticket: Pick<Ticket, 'status'>): boolean {
  const s = normalizeTicketStatus(ticket.status);
  return s === 'resolved' || s === 'closed';
}

/** Map ?status= URL values onto ticket-list view ids. */
export const STATUS_QUERY_TO_VIEW: Record<string, string> = {
  open: 'status_open',
  in_progress: 'status_in_progress',
  pending: 'status_in_progress',
  resolved: 'status_resolved',
  closed: 'status_resolved',
  unassigned: 'unassigned',
};

export function resolveTicketsStatusParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalizeTicketStatus(raw);
  return STATUS_QUERY_TO_VIEW[key] || null;
}

/** SQL status predicates for dashboard aggregates (Postgres). */
export const SQL_STATUS_OPEN = `LOWER(REPLACE(COALESCE(data->>'status', ''), '-', '_')) IN ('open', 'new')`;
export const SQL_STATUS_IN_PROGRESS = `LOWER(REPLACE(COALESCE(data->>'status', ''), '-', '_')) IN ('pending', 'in_progress')`;
export const SQL_STATUS_RESOLVED = `LOWER(REPLACE(COALESCE(data->>'status', ''), '-', '_')) IN ('resolved', 'closed')`;
export const SQL_STATUS_NOT_EXCLUDED = `LOWER(REPLACE(COALESCE(data->>'status', ''), '-', '_')) NOT IN ('trash', 'spam', 'merged', 'deleted', 'archived')`;
