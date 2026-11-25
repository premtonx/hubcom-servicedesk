/**
 * Shared helpers for CLIENT_* /api/portal/tickets* responses.
 * Keeps list/detail/message shaping consistent and unit-testable.
 */

import {
  clientCanViewTicket,
  filterMessagesForClient,
  filterTicketsForClient,
  sanitizeTicketForClient,
  type ClientSessionContext,
} from './ticket-visibility.js';
import { listTicketParticipants } from './ticket-participants.js';
import { toPortalStatusGroup } from '../portal/status.js';

export type PortalTicketScope = 'mine' | 'all';

export function isPortalTicketTrashStatus(status: unknown): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'deleted' || s === 'trash' || s === 'spam';
}

export function sortTicketsNewestFirst<T extends Record<string, unknown>>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const ta = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
    const tb = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
    return tb - ta;
  });
}

export function sortMessagesOldestFirst<T extends Record<string, unknown>>(messages: T[]): T[] {
  return [...messages].sort((a, b) => {
    const ta = new Date(String(a.createdAt || 0)).getTime();
    const tb = new Date(String(b.createdAt || 0)).getTime();
    return ta - tb;
  });
}

/** Apply org/role visibility then drop trash statuses. */
export async function listVisiblePortalTickets(
  session: ClientSessionContext,
  allTickets: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const visible = await filterTicketsForClient(session, allTickets);
  return sortTicketsNewestFirst(visible.filter((t) => !isPortalTicketTrashStatus(t.status)));
}

export function filterPortalTicketsByScope(
  session: ClientSessionContext,
  tickets: Array<Record<string, unknown>>,
  scope: PortalTicketScope,
  participantTicketIds: Set<string>,
): Array<Record<string, unknown>> {
  if (scope === 'all') return tickets;
  return tickets.filter((t) => {
    const requester =
      (typeof t.requesterId === 'string' && t.requesterId) ||
      (typeof t.requester_id === 'string' && t.requester_id) ||
      (typeof t.creatorId === 'string' && t.creatorId) ||
      '';
    return requester === session.id || participantTicketIds.has(String(t.id || ''));
  });
}

export function buildPortalTicketCounts(tickets: Array<Record<string, unknown>>) {
  const counts = {
    all: tickets.length,
    mine: 0,
    open: 0,
    in_progress: 0,
    waiting: 0,
    resolved: 0,
    closed: 0,
    urgent: 0,
  };
  for (const t of tickets) {
    const group = toPortalStatusGroup(String(t.status || ''));
    if (group === 'open') counts.open += 1;
    else if (group === 'in_progress') counts.in_progress += 1;
    else if (group === 'waiting') counts.waiting += 1;
    else if (group === 'resolved') counts.resolved += 1;
    else if (group === 'closed') counts.closed += 1;

    const priority = String(t.priority || '').toLowerCase();
    if (priority === 'urgent' || priority === 'high' || priority === 'critical') {
      counts.urgent += 1;
    }
  }
  return counts;
}

export function sanitizeMessageForClientPortal<T extends Record<string, unknown>>(msg: T): T {
  const clone = { ...msg } as Record<string, unknown>;
  delete clone.is_internal;
  delete clone.isInternal;
  delete clone.internalNotes;
  delete clone.agentComments;
  delete clone.aiCritiqueLog;
  return clone as T;
}

/**
 * Pure builder for GET /api/portal/tickets/:id payload (after I/O).
 * Strips internals and sorts public messages chronologically.
 */
export function buildPortalTicketDetailResponse(params: {
  ticket: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  participants: Array<{
    ticket_id: string;
    user_id: string;
    added_by: string | null;
    created_at: string;
  }>;
}): {
  ticket: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  participants: typeof params.participants;
  attachments: unknown[];
} {
  const ticket = sanitizeTicketForClient(params.ticket);
  const messages = sortMessagesOldestFirst(filterMessagesForClient(params.messages)).map(
    sanitizeMessageForClientPortal,
  );
  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
  return {
    ticket,
    messages,
    participants: params.participants,
    attachments,
  };
}

export async function assertPortalTicketAccess(
  session: ClientSessionContext,
  ticket: Record<string, unknown> | null | undefined,
  ticketId: string,
): Promise<{ ok: true; ticket: Record<string, unknown> } | { ok: false; status: 403 | 404 }> {
  if (!ticket) return { ok: false, status: 404 };
  const canView = await clientCanViewTicket(session, { ...ticket, id: ticketId });
  if (!canView) {
    // Cross-tenant or out-of-scope → 404 to avoid ID enumeration; 403 when same-org denied is rare.
    return { ok: false, status: 404 };
  }
  return { ok: true, ticket: { ...ticket, id: ticketId } };
}

export async function loadPortalTicketParticipants(ticketId: string) {
  return listTicketParticipants(ticketId);
}

/** Paths the Kunden-Portal ticket UI may call — never `/api/db`. */
export const PORTAL_TICKET_ALLOWED_API_PREFIXES = [
  '/api/portal/tickets',
  '/api/tickets/', // participants + staff-compatible PATCH status when needed
  '/api/portal/members',
  '/api/portal/team',
  '/api/portal/organization',
  '/api/auth/',
] as const;

export function isPortalTicketFrontendApiAllowed(url: string): boolean {
  const path = String(url || '').split('?')[0];
  if (path === '/api/db' || path.startsWith('/api/db/')) return false;
  return PORTAL_TICKET_ALLOWED_API_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
}
