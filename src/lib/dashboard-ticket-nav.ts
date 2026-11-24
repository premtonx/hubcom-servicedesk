/**
 * Canonical navigation from the Hubcom staff dashboard into the ticket list.
 * Prefer `?status=` for KPI deep-links; `?view=` remains for sidebar views / org.
 */

import { resolveTicketsStatusParam } from './ticket-status-groups';

export type DashboardTicketListTarget =
  | { kind: 'view'; view: string; resolvedWithinDays?: number }
  | { kind: 'status'; status: string; resolvedWithinDays?: number }
  | { kind: 'organization'; organizationId: string };

/** Map legacy / short dashboard aliases onto real ticket-list view ids. */
export const DASHBOARD_VIEW_ALIASES: Record<string, string> = {
  unassigned: 'unassigned',
  overdue: 'overdue',
  open: 'status_open',
  open_in_progress: 'open_in_progress',
  in_progress: 'status_in_progress',
  pending: 'status_in_progress',
  resolved: 'status_resolved',
  status_resolved: 'status_resolved',
  status_open: 'status_open',
  status_pending: 'status_in_progress',
  status_in_progress: 'status_in_progress',
  sla: 'sla_risk',
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
  'status_in_progress',
  'sla_risk',
  'team_all_open',
  'assigned_me',
]);

export function resolveTicketsViewParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return DASHBOARD_VIEW_ALIASES[key] || key;
}

/**
 * Resolve either `status` or `view` query params into a ticket-list view id.
 * `status` wins when both are present (KPI deep-links).
 */
export function resolveTicketsListDeepLink(params: {
  status?: string | null;
  view?: string | null;
}): string | null {
  const fromStatus = resolveTicketsStatusParam(params.status);
  if (fromStatus) return fromStatus;
  return resolveTicketsViewParam(params.view);
}

export function buildTicketsListUrl(target: DashboardTicketListTarget): string {
  const params = new URLSearchParams();
  if (target.kind === 'status') {
    params.set('status', target.status);
    if (target.resolvedWithinDays && target.resolvedWithinDays > 0) {
      params.set('resolvedWithin', `${target.resolvedWithinDays}d`);
    }
  } else if (target.kind === 'view') {
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
