/**
 * Typed adapter for TicketDetailWorkbench — Shared UI, Separate APIs.
 * Staff → TicketsPage / ticketService; portal → /api/portal/tickets* only.
 */

import type { Ticket, TicketStatus } from '../../types';
import type { PortalMember, PortalTicketAttachment } from '../../services/clientPortalApi';

export type TicketDetailWorkbenchMode = 'staff' | 'portal';

export type TicketDetailWorkbenchCapabilities = {
  /** KI-Sync header action */
  aiSync: boolean;
  /** Convert ticket → KB */
  convertToKb: boolean;
  /** Interne Notiz composer / workspace notes */
  internalNotes: boolean;
  /** Merge tickets */
  merge: boolean;
  /** Spam action */
  spam: boolean;
  /** Sentiment glyph in header */
  sentimentGlyph: boolean;
  /** Swarm outage banner */
  swarmBanner: boolean;

  tabCustomer: boolean;
  tabTimeline: boolean;
  tabAiInsights: boolean;
  tabAssets: boolean;
  tabRelatedTickets: boolean;
  tabTasks: boolean;
  tabTime: boolean;

  aiSummaryCard: boolean;
  emailComposer: boolean;
  /** Portal public reply (RichText + attachments via adapter) */
  portalPublicReply: boolean;
  ticketKindFields: boolean;
  smartContextMobile: boolean;

  /** Staff RedesignedSidebar / TicketDetailContextPane */
  staffContextPane: boolean;
  /** Portal Eigenschaften + Beteiligte + Aktionen rail */
  portalPropertiesPane: boolean;
  participantsPanel: boolean;
  canManageParticipants: boolean;
  statusActions: boolean;
  canMarkClosed: boolean;

  canUpdateStatus: boolean;
  canUpdatePriority: boolean;
  canEditAssignee: boolean;
  canEditTags: boolean;
};

export const STAFF_TICKET_DETAIL_CAPABILITIES: TicketDetailWorkbenchCapabilities = {
  aiSync: true,
  convertToKb: true,
  internalNotes: true,
  merge: true,
  spam: true,
  sentimentGlyph: true,
  swarmBanner: true,
  tabCustomer: true,
  tabTimeline: true,
  tabAiInsights: true,
  tabAssets: true,
  tabRelatedTickets: true,
  tabTasks: true,
  tabTime: true,
  aiSummaryCard: true,
  emailComposer: true,
  portalPublicReply: false,
  ticketKindFields: true,
  smartContextMobile: true,
  staffContextPane: true,
  portalPropertiesPane: false,
  participantsPanel: false,
  canManageParticipants: false,
  statusActions: false,
  canMarkClosed: false,
  canUpdateStatus: true,
  canUpdatePriority: true,
  canEditAssignee: true,
  canEditTags: true,
};

export const PORTAL_TICKET_DETAIL_CAPABILITIES: TicketDetailWorkbenchCapabilities = {
  aiSync: false,
  convertToKb: false,
  internalNotes: false,
  merge: false,
  spam: false,
  sentimentGlyph: false,
  swarmBanner: false,
  tabCustomer: false,
  tabTimeline: false,
  tabAiInsights: false,
  tabAssets: false,
  tabRelatedTickets: false,
  tabTasks: false,
  tabTime: false,
  aiSummaryCard: false,
  emailComposer: false,
  portalPublicReply: true,
  ticketKindFields: false,
  smartContextMobile: false,
  staffContextPane: false,
  portalPropertiesPane: true,
  participantsPanel: true,
  canManageParticipants: false,
  statusActions: true,
  canMarkClosed: false,
  canUpdateStatus: true,
  canUpdatePriority: false,
  canEditAssignee: false,
  canEditTags: false,
};

export type PortalTicketDetailPayload = {
  ticket: Ticket;
  messages: any[];
  participants: Array<{
    ticket_id: string;
    user_id: string;
    added_by: string | null;
    created_at: string;
  }>;
  attachments: PortalTicketAttachment[];
  members: PortalMember[];
};

export interface TicketDetailWorkbenchAdapter {
  /** Portal: load detail via /api/portal/tickets/:id (+ members when org-wide). */
  getDetail?(ticketId: string): Promise<PortalTicketDetailPayload>;

  reply?(
    ticketId: string,
    payload: {
      content: string;
      senderName?: string;
      attachments?: PortalTicketAttachment[];
    },
  ): Promise<void>;

  updateStatus?(ticketId: string, status: TicketStatus): Promise<Ticket | null>;

  addParticipant?(ticketId: string, userId: string): Promise<void>;

  removeParticipant?(ticketId: string, userId: string): Promise<void>;

  openBack(): void;
}
