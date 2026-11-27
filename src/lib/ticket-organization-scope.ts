/**
 * Organization scoping for the staff /tickets page.
 * When `organizationId` is set, every list/count must use this pool.
 */

import type { Ticket } from '../types';
import { UNASSIGNED_ORG_FILTER_ID } from './tickets/ticket-workspace-mode';

export { UNASSIGNED_ORG_FILTER_ID };

export function ticketOrganizationId(ticket: Pick<Ticket, 'organizationId'> & {
  organization_id?: string | null;
}): string {
  return String(
    (ticket as { organizationId?: string | null }).organizationId ||
      (ticket as { organization_id?: string | null }).organization_id ||
      '',
  ).trim();
}

export function ticketBelongsToOrganization(
  ticket: Pick<Ticket, 'organizationId'> & { organization_id?: string | null },
  organizationId: string | null | undefined,
): boolean {
  const oid = String(organizationId || '').trim();
  if (!oid) return true;
  if (oid === UNASSIGNED_ORG_FILTER_ID) {
    return !ticketOrganizationId(ticket);
  }
  return ticketOrganizationId(ticket) === oid;
}

/** If organizationId is set, keep only that org's tickets; otherwise return the input pool. */
export function filterTicketsByOrganization<T extends Ticket>(
  tickets: T[],
  organizationId: string | null | undefined,
): T[] {
  const oid = String(organizationId || '').trim();
  if (!oid) return tickets;
  return tickets.filter((t) => ticketBelongsToOrganization(t, oid));
}
