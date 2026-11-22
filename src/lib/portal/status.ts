/** Kundenfreundliche Status-Labels und Filter für das Portal. */

export type PortalStatusFilter =
  | 'all'
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'resolved'
  | 'closed';

/** Interne Status → Portal-Anzeigegruppe. */
export function toPortalStatusGroup(status: string | null | undefined): PortalStatusFilter {
  const s = String(status || 'open').toLowerCase().trim();
  if (s === 'open') return 'open';
  if (s === 'waiting_customer') return 'waiting_customer';
  if (s === 'resolved') return 'resolved';
  if (s === 'closed' || s === 'merged' || s === 'deleted' || s === 'trash' || s === 'spam') {
    return 'closed';
  }
  // pending, in_progress, on-hold, paused, qs, waiting_dev, waiting_vendor, …
  return 'in_progress';
}

export const PORTAL_STATUS_LABELS: Record<Exclude<PortalStatusFilter, 'all'>, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  waiting_customer: 'Wartet auf Ihre Rückmeldung',
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
  { value: 'waiting_customer', label: PORTAL_STATUS_LABELS.waiting_customer },
  { value: 'resolved', label: PORTAL_STATUS_LABELS.resolved },
  { value: 'closed', label: PORTAL_STATUS_LABELS.closed },
];

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
