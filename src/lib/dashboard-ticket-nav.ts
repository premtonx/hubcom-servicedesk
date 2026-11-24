/**
 * Canonical navigation from the Hubcom staff dashboard into the ticket list.
 * View ids must match `filterTicketsByView` / sidebar (or deep-link allow-list).
 */

export type DashboardTicketListTarget =
  | { kind: 'view'; view: string; resolvedWithinDays?: number }
  | { kind: 'organization'; organizationId: string };

/** Map legacy / short dashboard aliases onto real ticket-list view ids. */
export const DASHBOARD_VIEW_ALIASES: Record<string, string> = {
  unassigned: 'unassigned',
  overdue: 'overdue',
  open: 'open_in_progress',
  open_in_progress: 'open_in_progress',
  resolved: 'status_resolved',
  status_resolved: 'status_resolved',
  sla_risk: 'sla_risk',
};

/** Views that may be opened via URL even if hidden from the sidebar. */
export const TICKETS_DEEP_LINK_VIEWS = new Set([
  'unassigned',
  'overdue',
  'open_in_progress',
  'status_resolved',
  'status_open',
  'status_pending',
  'sla_risk',
  'team_all_open',
]);

export function resolveTicketsViewParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return DASHBOARD_VIEW_ALIASES[key] || key;
}

export function buildTicketsListUrl(target: DashboardTicketListTarget): string {
  const params = new URLSearchParams();
  if (target.kind === 'view') {
    params.set('view', target.view);
    if (target.resolvedWithinDays && target.resolvedWithinDays > 0) {
      params.set('resolvedWithin', `${target.resolvedWithinDays}d`);
    }
  } else {
    params.set('organizationId', target.organizationId);
    // Explicitly use all-open for the org — never inherit "unassigned".
    params.set('view', 'team_all_open');
  }
  const qs = params.toString();
  return qs ? `/tickets?${qs}` : '/tickets';
}

/** Parse `7d` / `7` style window into day count. */
export function parseResolvedWithinDays(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw)
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*d?$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
