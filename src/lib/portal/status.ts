/** Kundenfreundliche Status-Labels und Filter für das Portal. */

export type PortalStatusFilter =
  | 'all'
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'waiting_customer'
  | 'resolved'
  | 'closed';

/** Interne Status → Portal-Anzeigegruppe. */
export function toPortalStatusGroup(status: string | null | undefined): PortalStatusFilter {
  const s = String(status || 'open').toLowerCase().trim().replace(/-/g, '_');
  if (s === 'open' || s === 'new') return 'open';
  if (
    s === 'waiting' ||
    s === 'waiting_customer' ||
    s === 'waiting_dev' ||
    s === 'waiting_vendor' ||
    s === 'on_hold' ||
    s === 'paused'
  ) {
    return 'waiting';
  }
  if (s === 'resolved') return 'resolved';
  if (s === 'closed' || s === 'merged' || s === 'deleted' || s === 'trash' || s === 'spam') {
    return 'closed';
  }
  // pending, in_progress, qs, …
  return 'in_progress';
}

export const PORTAL_STATUS_LABELS: Record<Exclude<PortalStatusFilter, 'all'>, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  waiting: 'Wartend',
  waiting_customer: 'Wartend',
  resolved: 'Gelöst',
  closed: 'Geschlossen',
};

export function portalStatusLabel(status: string | null | undefined): string {
  const group = toPortalStatusGroup(status);
  if (group === 'all') return 'Offen';
  return PORTAL_STATUS_LABELS[group];
}

export const PORTAL_STATUS_FILTERS: Array<{ value: PortalStatusFilter; label: string }> = [
  { value: 'all', label: 'Alle' },
  { value: 'open', label: PORTAL_STATUS_LABELS.open },
  { value: 'in_progress', label: PORTAL_STATUS_LABELS.in_progress },
  { value: 'waiting', label: PORTAL_STATUS_LABELS.waiting },
  { value: 'resolved', label: PORTAL_STATUS_LABELS.resolved },
];

/** Match a ticket status against a portal tab/filter id (including aliases). */
export function ticketMatchesPortalStatusFilter(
  status: string | null | undefined,
  filter: string,
): boolean {
  if (!filter || filter === 'all') return true;
  const group = toPortalStatusGroup(status);
  if (filter === 'waiting' || filter === 'waiting_customer' || filter === 'onhold') {
    return group === 'waiting';
  }
  if (filter === 'resolved' || filter === 'closed') {
    return group === 'resolved' || group === 'closed';
  }
  if (filter === 'pending') return group === 'in_progress';
  return group === filter;
}

export const PORTAL_PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  urgent: 'Hoch',
  critical: 'Hoch',
};

export function portalPriorityLabel(priority: string | null | undefined): string {
  const key = String(priority || 'medium').toLowerCase();
  return PORTAL_PRIORITY_LABELS[key] || 'Mittel';
}
