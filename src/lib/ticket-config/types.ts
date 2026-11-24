/**
 * Configurable ticket taxonomy (statuses, priorities, types).
 * Stored in geistdesk_documents collections; `key` is what tickets persist.
 */

export const TICKET_STATUSES_COLLECTION = 'ticket_statuses';
export const TICKET_PRIORITIES_COLLECTION = 'ticket_priorities';
export const TICKET_TYPES_COLLECTION = 'ticket_types';

/** Workflow meaning — shown in admin list alongside the label. */
export type StatusWorkflowKind = 'open' | 'in_progress' | 'waiting' | 'closed';

export const STATUS_WORKFLOW_KINDS: Array<{
  value: StatusWorkflowKind;
  label: string;
  hint: string;
}> = [
  { value: 'open', label: 'Open', hint: 'Neu / noch nicht in Bearbeitung' },
  { value: 'in_progress', label: 'In progress', hint: 'Aktive Bearbeitung' },
  { value: 'waiting', label: 'Waiting', hint: 'Wartet auf Kunde, Vendor oder interne Freigabe' },
  { value: 'closed', label: 'Closed / resolved', hint: 'Abgeschlossen oder gelöst' },
];

export interface TicketStatusConfig {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  workflowKind: StatusWorkflowKind;
  /** System defaults cannot change key; can still rename label / deactivate with replacement. */
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketPriorityConfig {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  /** Lower number = lower priority (lowest → highest in the list). */
  sortOrder: number;
  isActive: boolean;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TicketTypeConfig {
  id: string;
  key: string;
  name: string;
  description: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatusConfigInput = {
  name: string;
  key?: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
  workflowKind?: StatusWorkflowKind;
};

export type TicketPriorityConfigInput = {
  name: string;
  key?: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type TicketTypeConfigInput = {
  name: string;
  key?: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
};

export const RECOMMENDED_PRIORITY_COLORS: Record<string, string> = {
  low: '#94A3B8',
  medium: '#3B82F6',
  high: '#F97316',
  urgent: '#EF4444',
};

/** Urgent / closed colour conflict heuristics (hex). */
export const URGENT_PRIORITY_COLOR = '#EF4444';
export const CLOSED_SAFE_COLORS = ['#10B981', '#059669', '#64748B', '#94A3B8', '#6B7280'];

export const DEFAULT_TICKET_STATUSES: Array<
  Omit<TicketStatusConfig, 'id' | 'createdAt' | 'updatedAt'>
> = [
  {
    key: 'open',
    name: 'Open',
    description: 'Neues Ticket, noch nicht in Bearbeitung.',
    color: '#3B82F6',
    sortOrder: 10,
    isActive: true,
    workflowKind: 'open',
    isSystem: true,
  },
  {
    key: 'pending',
    name: 'Pending',
    description: 'Wartet auf Rückmeldung oder Freigabe.',
    color: '#F59E0B',
    sortOrder: 20,
    isActive: true,
    workflowKind: 'waiting',
    isSystem: true,
  },
  {
    key: 'in_progress',
    name: 'In Progress',
    description: 'Wird aktiv bearbeitet.',
    color: '#8B5CF6',
    sortOrder: 30,
    isActive: true,
    workflowKind: 'in_progress',
    isSystem: true,
  },
  {
    key: 'qs',
    name: 'QS',
    description: 'Qualitätsprüfung vor Abschluss.',
    color: '#06B6D4',
    sortOrder: 40,
    isActive: true,
    workflowKind: 'waiting',
    isSystem: true,
  },
  {
    key: 'resolved',
    name: 'Resolved',
    description: 'Lösung bereitgestellt.',
    color: '#10B981',
    sortOrder: 50,
    isActive: true,
    workflowKind: 'closed',
    isSystem: true,
  },
  {
    key: 'closed',
    name: 'Closed',
    description: 'Ticket geschlossen.',
    color: '#64748B',
    sortOrder: 60,
    isActive: true,
    workflowKind: 'closed',
    isSystem: true,
  },
];

export const DEFAULT_TICKET_PRIORITIES: Array<
  Omit<TicketPriorityConfig, 'id' | 'createdAt' | 'updatedAt'>
> = [
  {
    key: 'low',
    name: 'Low',
    description: 'Niedrige Priorität.',
    color: RECOMMENDED_PRIORITY_COLORS.low,
    sortOrder: 10,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'medium',
    name: 'Medium',
    description: 'Standardpriorität.',
    color: RECOMMENDED_PRIORITY_COLORS.medium,
    sortOrder: 20,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'high',
    name: 'High',
    description: 'Erhöhte Priorität.',
    color: RECOMMENDED_PRIORITY_COLORS.high,
    sortOrder: 30,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'urgent',
    name: 'Urgent',
    description: 'Höchste Priorität / kritisch.',
    color: RECOMMENDED_PRIORITY_COLORS.urgent,
    sortOrder: 40,
    isActive: true,
    isSystem: true,
  },
];

export const DEFAULT_TICKET_TYPES: Array<
  Omit<TicketTypeConfig, 'id' | 'createdAt' | 'updatedAt'>
> = [
  {
    key: 'question',
    name: 'Question',
    description: 'Allgemeine Anfrage oder Frage.',
    color: '#3B82F6',
    sortOrder: 10,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'incident',
    name: 'Incident',
    description: 'Störung oder Ausfall.',
    color: '#EF4444',
    sortOrder: 20,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'problem',
    name: 'Problem',
    description: 'Wiederkehrendes oder zugrunde liegendes Problem.',
    color: '#F59E0B',
    sortOrder: 30,
    isActive: true,
    isSystem: true,
  },
  {
    key: 'feature_request',
    name: 'Feature Request',
    description: 'Wunsch nach neuer Funktion oder Änderung.',
    color: '#8B5CF6',
    sortOrder: 40,
    isActive: true,
    isSystem: true,
  },
];

export function slugifyConfigKey(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'item'
  );
}

/** Approximate hex colour distance (0 identical → ~441 max). */
export function colorDistance(a: string, b: string): number {
  const parse = (hex: string) => {
    const h = hex.replace('#', '').trim();
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h.padEnd(6, '0').slice(0, 6);
    return {
      r: parseInt(full.slice(0, 2), 16) || 0,
      g: parseInt(full.slice(2, 4), 16) || 0,
      b: parseInt(full.slice(4, 6), 16) || 0,
    };
  };
  try {
    const x = parse(a);
    const y = parse(b);
    return Math.sqrt((x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2);
  } catch {
    return 999;
  }
}

export function statusColorConflictWarning(
  workflowKind: StatusWorkflowKind,
  color: string,
): string | null {
  if (workflowKind === 'closed' && colorDistance(color, URGENT_PRIORITY_COLOR) < 80) {
    return 'Diese Farbe liegt nah an Urgent-Rot — für Closed/Resolved-Status unüblich und leicht mit hoher Priorität zu verwechseln.';
  }
  if (workflowKind === 'open' && colorDistance(color, '#94A3B8') < 50) {
    return 'Grau wirkt oft inaktiv — für Open-Status eher blau oder eine klare Aktionsfarbe wählen.';
  }
  return null;
}
