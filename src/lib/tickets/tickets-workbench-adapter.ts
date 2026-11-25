/**
 * Typed adapter for TicketsWorkbench — Shared UI, Separate APIs.
 * Staff → ticketService / staff APIs; portal → /api/portal/tickets* only.
 */

import type { Ticket, TicketPriority, TicketStatus } from '../../types';

export type TicketsWorkbenchMode = 'staff' | 'portal';

export type TicketsWorkbenchCapabilities = {
  /** FAVORITEN / DRINGLICHKEIT / STATUS staff sidebar groups + KUNDEN */
  staffSidebar: boolean;
  /** Expandable KUNDEN with DPG → Tickets / Rücklieferungen */
  kundenNav: boolean;
  /** Bulk selection + mass assign / merge / AI mass-resolve */
  bulkSelection: boolean;
  /** Inline status / priority dropdowns */
  inlineStatusPriority: boolean;
  /** Inline agent assignment */
  inlineAssignee: boolean;
  /** KI-Zusammenfassung / TicketsQueueAiChip */
  aiSummaryChip: boolean;
  /** SLA / escalation visual cues in rows */
  slaChrome: boolean;
  /** Team-category filter strip */
  teamCategoryFilter: boolean;
  /** Unassigned top tab */
  unassignedTab: boolean;
  /** Ticket erstellen header CTA */
  canCreateTicket: boolean;
};

export const STAFF_TICKETS_CAPABILITIES: TicketsWorkbenchCapabilities = {
  staffSidebar: true,
  kundenNav: true,
  bulkSelection: true,
  inlineStatusPriority: true,
  inlineAssignee: true,
  aiSummaryChip: true,
  slaChrome: true,
  teamCategoryFilter: true,
  unassignedTab: true,
  canCreateTicket: true,
};

export const PORTAL_TICKETS_CAPABILITIES: TicketsWorkbenchCapabilities = {
  staffSidebar: false,
  kundenNav: false,
  bulkSelection: false,
  inlineStatusPriority: true,
  inlineAssignee: false,
  aiSummaryChip: false,
  slaChrome: false,
  teamCategoryFilter: false,
  unassignedTab: false,
  canCreateTicket: true,
};

export type PortalTicketsQueueView =
  | 'company_all'
  | 'mine'
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'resolved';

export type TicketsListScope = 'mine' | 'all';

export interface TicketsWorkbenchAdapter {
  /** Load tickets for the active scope (portal) or subscribe/push updates (staff). */
  listTickets(options?: {
    scope?: TicketsListScope;
  }): Promise<{ tickets: Ticket[]; counts?: Record<string, number> }>;

  /** Optional realtime/push subscription — staff uses ticketService; portal may poll. */
  subscribeTickets?(
    callback: (tickets: Ticket[]) => void,
  ): () => void;

  updateTicketStatus?(id: string, status: TicketStatus): Promise<void>;

  updateTicketPriority?(id: string, priority: TicketPriority): Promise<void>;

  updateTicketFields?(id: string, patch: Partial<Ticket>): Promise<void>;

  /** Row click / open detail */
  openTicket(id: string): void;

  /** Create ticket CTA */
  openCreateTicket(): void;
}
