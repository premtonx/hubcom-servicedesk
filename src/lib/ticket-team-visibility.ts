/**
 * Team/category-based ticket visibility helpers.
 * Agents in functional teams with assigned categories may see those tickets
 * in addition to directly assigned ones — never beyond existing authorization.
 */

export type TicketVisibilityScope = 'all' | 'assigned' | 'group';

export interface TicketCategoryRef {
  categoryId?: string | null;
  categorySlug?: string | null;
  categoryName?: string | null;
  agentId?: string | null;
  assignedTo?: string | null;
}

export interface TeamCategoryAccess {
  /** Category document IDs the user's teams are linked to. */
  categoryIds: string[];
  /** Optional slugs/names for legacy tickets without categoryId. */
  categorySlugs?: string[];
  categoryNames?: string[];
}

export function ticketMatchesTeamCategories(
  ticket: TicketCategoryRef,
  access: TeamCategoryAccess,
): boolean {
  const ids = access.categoryIds || [];
  const slugs = access.categorySlugs || [];
  const names = access.categoryNames || [];
  if (ids.length === 0 && slugs.length === 0 && names.length === 0) return false;

  if (ticket.categoryId && ids.includes(String(ticket.categoryId))) return true;
  if (ticket.categorySlug && slugs.includes(String(ticket.categorySlug))) return true;
  if (ticket.categoryName && names.includes(String(ticket.categoryName))) return true;
  return false;
}

/**
 * Decide whether a ticket is visible for a staff agent.
 * - `all`: unrestricted (SYSTEM_ADMIN / full visibility roles)
 * - `assigned`: own assignments, plus team-category tickets when access is configured
 * - `group`: team-category tickets and own assignments only
 */
export function isTicketVisibleForAgent(
  ticket: TicketCategoryRef,
  opts: {
    agentId: string;
    scope: TicketVisibilityScope;
    teamAccess?: TeamCategoryAccess;
  },
): boolean {
  if (opts.scope === 'all') return true;

  const assigned =
    ticket.agentId === opts.agentId ||
    ticket.assignedTo === opts.agentId;

  if (assigned) return true;

  if (opts.teamAccess && ticketMatchesTeamCategories(ticket, opts.teamAccess)) {
    return true;
  }

  return false;
}

/** Filter a ticket list for the agent (pure; safe for unit tests). */
export function filterTicketsForAgentTeamAccess<T extends TicketCategoryRef>(
  tickets: T[],
  opts: {
    agentId: string;
    scope: TicketVisibilityScope;
    teamAccess?: TeamCategoryAccess;
  },
): T[] {
  return tickets.filter((t) => isTicketVisibleForAgent(t, opts));
}
