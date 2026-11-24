import type { TicketStatus } from '../types';

/** Canonical Kanban lane buckets shown in the UI (4 columns matching real statuses). */
export type KanbanLaneId = 'offen' | 'in_bearbeitung' | 'wartend' | 'geloest';

/**
 * Normalize a raw ticket status string from the database / UI into a Kanban lane.
 * Accepts English system keys, German labels, aliases, and "+ new"-style chip values.
 */
export function normalizeKanbanStatus(rawStatus: string | undefined | null): KanbanLaneId {
  const normalized = String(rawStatus ?? 'open')
    .trim()
    .toLowerCase()
    // Chips render as "+ Offen" — status fields may store that prefix literally.
    .replace(/^\+\s*/, '')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');

  if (
    normalized === 'open' ||
    normalized === 'offen' ||
    normalized === 'new' ||
    normalized === '+_new' ||
    normalized === 'new_ticket' ||
    normalized === 'unassigned' ||
    normalized === 'nicht_zugewiesen' ||
    normalized === 'nichtzugewiesen'
  ) {
    return 'offen';
  }

  if (
    normalized === 'resolved' ||
    normalized === 'gelöst' ||
    normalized === 'geloest' ||
    normalized === 'gelöscht' ||
    normalized === 'geloescht' ||
    normalized === 'closed' ||
    normalized === 'geschlossen' ||
    normalized === 'done' ||
    normalized === 'fertig' ||
    normalized === 'deleted' ||
    normalized === 'trash' ||
    normalized === 'spam' ||
    normalized === 'merged'
  ) {
    return 'geloest';
  }

  if (
    normalized === 'waiting' ||
    normalized === 'wartend' ||
    normalized === 'paused' ||
    normalized === 'on_hold' ||
    normalized === 'onhold' ||
    normalized === 'waiting_customer' ||
    normalized === 'waiting_dev' ||
    normalized === 'waiting_vendor' ||
    normalized === 'hold' ||
    normalized === 'pending_customer'
  ) {
    return 'wartend';
  }

  if (
    normalized === 'pending' ||
    normalized === 'in_progress' ||
    normalized === 'inprogress' ||
    normalized === 'in_bearbeitung' ||
    normalized === 'bearbeitung' ||
    normalized === 'qs'
  ) {
    return 'in_bearbeitung';
  }

  // Fallback: treat unknown active statuses as in-progress; empty as open.
  if (!normalized) return 'offen';
  return 'in_bearbeitung';
}

/** Canonical TicketStatus keys to write when dropping a card onto a Kanban lane. */
export function kanbanLaneToTicketStatus(lane: KanbanLaneId): TicketStatus {
  switch (lane) {
    case 'offen':
      return 'open';
    case 'in_bearbeitung':
      return 'pending';
    case 'wartend':
      // Canonical hold status — matches tickets.pendingOnHold / isOnHoldTicket.
      return 'on_hold';
    case 'geloest':
      return 'resolved';
    default:
      return 'open';
  }
}

export const KANBAN_LANES: Array<{
  id: KanbanLaneId;
  /** i18n key under tickets.status.* / tickets.kanban.* */
  labelKey: string;
  defaultLabel: string;
  systemStatus: TicketStatus;
  dot: string;
}> = [
  {
    id: 'offen',
    labelKey: 'tickets.status.open',
    defaultLabel: 'Offen',
    systemStatus: 'open',
    dot: 'bg-blue-500',
  },
  {
    id: 'in_bearbeitung',
    labelKey: 'tickets.status.pending',
    defaultLabel: 'In Bearbeitung',
    systemStatus: 'pending',
    dot: 'bg-violet-500',
  },
  {
    id: 'wartend',
    labelKey: 'tickets.pendingOnHold',
    defaultLabel: 'Wartend',
    systemStatus: 'on_hold',
    dot: 'bg-amber-500',
  },
  {
    id: 'geloest',
    labelKey: 'tickets.status.resolved',
    defaultLabel: 'Gelöst',
    systemStatus: 'resolved',
    dot: 'bg-emerald-500',
  },
];
