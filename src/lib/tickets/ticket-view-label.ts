/**
 * Human-readable German (or i18n) labels for internal ticket view keys.
 * Never surface raw keys like `team_all_open` in the UI.
 */

const FALLBACK_DE: Record<string, string> = {
  all: 'Alle Tickets',
  team_all_open: 'Alle Tickets',
  assigned_me: 'Mir zugewiesen',
  unassigned: 'Nicht zugewiesen',
  status_open: 'Offen',
  open: 'Offen',
  status_pending: 'In Bearbeitung',
  open_in_progress: 'Offen & In Bearbeitung',
  sla_risk: 'SLA-Risiko',
  escalations: 'Eskalationen',
  help_requested: 'Hilfe angefordert',
  overdue: 'Überfällig / SLA',
  watching: 'Beobachtet',
  due_today: 'Heute fällig',
  waiting_my_response: 'Warte auf Antwort',
  waiting_review: 'Wartet auf Prüfung',
  new_tickets: 'Neue Tickets',
  status_paused: 'Pausiert',
  status_qs: 'In QS',
  status_waiting_customer: 'Wartend auf Kunde',
  status_waiting_dev: 'Wartend auf Entwickler',
  status_waiting_vendor: 'Wartend auf Drittanbieter',
  status_resolved: 'Gelöst',
  status_closed: 'Geschlossen',
  spam: 'Spam',
  negative_sentiment: 'Negative Stimmung',
  potential_escalations: 'Potenzielle Eskalationen',
  duplicates_detected: 'Duplikate erkannt',
  kb_suggestion: 'KB-Vorschlag verfügbar',
  my_paused: 'Pausiert',
  my_qs: 'In QS',
};

export type TicketViewLabelOptions = {
  viewId: string | null | undefined;
  /** Active Kunden org display name — takes precedence when filtering by client. */
  organizationName?: string | null;
  /** Optional i18n: (key, fallback) => string */
  t?: (key: string, fallback: string) => string;
};

/**
 * Resolve a clean display label for the active ticket list / rail view.
 * Prefer organization name when scoped to a Kunden filter.
 */
export function resolveTicketViewDisplayLabel(opts: TicketViewLabelOptions): string {
  const orgName = String(opts.organizationName || '').trim();
  if (orgName) return orgName;

  const viewId = String(opts.viewId || '').trim();
  if (!viewId || viewId === 'all') {
    return opts.t?.('tickets.allTickets', 'Alle Tickets') || 'Alle Tickets';
  }
  if (viewId.startsWith('custom:')) {
    return viewId.replace(/^custom:/, '') || 'Benutzerdefinierte Ansicht';
  }

  const fallback = FALLBACK_DE[viewId] || viewId;
  if (opts.t) {
    return opts.t(`tickets.items.${viewId}`, fallback);
  }
  // Never return an unmapped raw snake_case key when we have a German fallback map miss
  // that still looks like a key — soften to title-ish German only if needed.
  if (/^[a-z0-9_]+$/.test(fallback) && fallback.includes('_')) {
    return FALLBACK_DE.team_all_open;
  }
  return fallback;
}

/** Canonical Ansicht options for the Outlook rail (German labels). */
export const OUTLOOK_ANSICHT_OPTIONS: Array<{ id: string; fallback: string }> = [
  { id: 'team_all_open', fallback: 'Alle Tickets' },
  { id: 'status_open', fallback: 'Offen' },
  { id: 'assigned_me', fallback: 'Mir zugewiesen' },
  { id: 'unassigned', fallback: 'Nicht zugewiesen' },
  { id: 'sla_risk', fallback: 'SLA-Risiko' },
  { id: 'escalations', fallback: 'Eskalationen' },
];

/** Build the list-scope query string to carry into /tickets/:id and back. */
export function buildTicketsScopeQuery(params: {
  organizationId?: string | null;
  view?: string | null;
  status?: string | null;
  panel?: string | null;
  resolvedWithin?: string | null;
}): string {
  const next = new URLSearchParams();
  if (params.organizationId) next.set('organizationId', params.organizationId);
  if (params.panel) next.set('panel', params.panel);
  if (params.view) next.set('view', params.view);
  if (params.status) next.set('status', params.status);
  if (params.resolvedWithin) next.set('resolvedWithin', params.resolvedWithin);
  return next.toString();
}
