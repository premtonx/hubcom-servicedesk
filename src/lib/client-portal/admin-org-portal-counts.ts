/**
 * Enrich admin organizations list with open ticket / returns counts (pure + SQL).
 */

import { queryDb, getDocsDirect } from '../postgres-backend.js';

export type OrgPortalListCounts = {
  open_tickets_count: number;
  open_returns_count: number;
};

export function emptyOrgPortalCounts(): OrgPortalListCounts {
  return { open_tickets_count: 0, open_returns_count: 0 };
}

/** Merge count map onto organization rows (pure, testable). */
export function mergeOrganizationsWithPortalCounts<
  T extends { id: string; logo_url?: string | null },
>(
  organizations: T[],
  countsByOrgId: Record<string, OrgPortalListCounts> | Map<string, OrgPortalListCounts>,
): Array<T & OrgPortalListCounts & { logo_url: string | null }> {
  const get = (id: string): OrgPortalListCounts => {
    if (countsByOrgId instanceof Map) {
      return countsByOrgId.get(id) || emptyOrgPortalCounts();
    }
    return countsByOrgId[id] || emptyOrgPortalCounts();
  };
  return organizations.map((o) => {
    const c = get(String(o.id));
    return {
      ...o,
      logo_url: o.logo_url ?? null,
      open_tickets_count: c.open_tickets_count,
      open_returns_count: c.open_returns_count,
    };
  });
}

function isOpenTicketStatus(status: unknown): boolean {
  const s = String(status || '')
    .toLowerCase()
    .trim();
  return s !== 'closed' && s !== 'resolved' && s !== 'merged' && s !== 'deleted' && s !== 'trash' && s !== 'spam';
}

/** Pure ticket open-count aggregation by organizationId (for tests + fallback). */
export function countOpenTicketsByOrganization(
  tickets: Array<Record<string, unknown>>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tickets) {
    const orgId = String(t.organizationId || t.organization_id || '').trim();
    if (!orgId) continue;
    if (!isOpenTicketStatus(t.status)) continue;
    map.set(orgId, (map.get(orgId) || 0) + 1);
  }
  return map;
}

/**
 * Load open ticket + open returns counts for all orgs (admin sidebar).
 * Returns never cross-contaminate — keyed strictly by organization_id.
 */
export async function fetchOrganizationPortalListCounts(): Promise<
  Map<string, OrgPortalListCounts>
> {
  const result = new Map<string, OrgPortalListCounts>();

  try {
    const tickets = await getDocsDirect('tickets', []);
    const ticketCounts = countOpenTicketsByOrganization(
      tickets as Array<Record<string, unknown>>,
    );
    for (const [orgId, n] of ticketCounts) {
      const cur = result.get(orgId) || emptyOrgPortalCounts();
      cur.open_tickets_count = n;
      result.set(orgId, cur);
    }
  } catch {
    /* tickets optional */
  }

  try {
    const res = await queryDb(
      `SELECT organization_id::text AS org_id,
              COUNT(*) FILTER (WHERE returned = FALSE)::int AS open_returns
         FROM ticket_hardware_returns
        WHERE return_required = TRUE
          AND organization_id IS NOT NULL
        GROUP BY organization_id`,
      [],
    );
    for (const row of res.rows || []) {
      const orgId = String(row.org_id || '').trim();
      if (!orgId) continue;
      const cur = result.get(orgId) || emptyOrgPortalCounts();
      cur.open_returns_count = Number(row.open_returns) || 0;
      result.set(orgId, cur);
    }
  } catch {
    /* returns table may be unavailable */
  }

  return result;
}

/** Assert open-ticket count for organizationId equals only that org's open tickets. */
export function assertCountsIsolatedToOrg(
  tickets: Array<Record<string, unknown>>,
  organizationId: string,
): boolean {
  const counts = countOpenTicketsByOrganization(tickets);
  const orgTickets = tickets.filter(
    (t) =>
      String(t.organizationId || t.organization_id || '').trim() === organizationId &&
      isOpenTicketStatus(t.status),
  );
  if ((counts.get(organizationId) || 0) !== orgTickets.length) return false;
  // Other orgs' tickets must not inflate this org's count.
  for (const t of tickets) {
    const oid = String(t.organizationId || t.organization_id || '').trim();
    if (oid && oid !== organizationId && isOpenTicketStatus(t.status)) {
      if ((counts.get(organizationId) || 0) > orgTickets.length) return false;
    }
  }
  return true;
}
