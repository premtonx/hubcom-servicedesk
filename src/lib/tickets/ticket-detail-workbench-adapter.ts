/**
 * Typed adapter for TicketDetailWorkbench — Shared UI, Separate APIs.
 * Staff → TicketsPage / ticketService; portal → /api/portal/tickets* only.
 */

import type { Ticket, TicketPriority, TicketStatus } from '../../types';
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
  /** Editable Kategorie / Tickettyp / SLA / Kontogesundheit */
  canEditProperties: boolean;
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
  canEditProperties: true,
};

/**
 * Base portal capabilities — full workspace tabs.
 * Role gates (CLIENT_USER vs org-wide) are applied in ClientTicketDetailPage.
 */
export const PORTAL_TICKET_DETAIL_CAPABILITIES: TicketDetailWorkbenchCapabilities = {
  aiSync: true,
  convertToKb: true,
  internalNotes: true,
  merge: false,
  spam: false,
  sentimentGlyph: true,
  swarmBanner: false,
  tabCustomer: true,
  tabTimeline: true,
  tabAiInsights: true,
  tabAssets: true,
  tabRelatedTickets: true,
  tabTasks: true,
  tabTime: true,
  aiSummaryCard: true,
  /** Exact staff EmailComposer (Von/An/CC/Betreff) with portalMode gates. */
  emailComposer: true,
  portalPublicReply: false,
  ticketKindFields: true,
  smartContextMobile: false,
  /** Exact staff TicketDetailContextPane / RedesignedSidebar. */
  staffContextPane: true,
  portalPropertiesPane: false,
  participantsPanel: true,
  canManageParticipants: false,
  statusActions: true,
  canMarkClosed: false,
  canUpdateStatus: true,
  canUpdatePriority: true,
  canEditAssignee: true,
  canEditTags: false,
  canEditProperties: true,
};

/** CLIENT_USER: read-only Eigenschaften, no Interne Notiz / KI-Sync / In KB. */
export const PORTAL_TICKET_DETAIL_CAPABILITIES_CLIENT_USER: TicketDetailWorkbenchCapabilities = {
  ...PORTAL_TICKET_DETAIL_CAPABILITIES,
  aiSync: false,
  convertToKb: false,
  internalNotes: false,
  canUpdatePriority: false,
  canEditAssignee: false,
  canEditProperties: false,
  canManageParticipants: false,
  canMarkClosed: false,
  canUpdateStatus: true,
};

export type PortalTicketWorkspaceMeta = {
  agents: Array<{ id: string; name: string; email: string; role: string }>;
  statuses: Array<{
    id: string;
    key: string;
    name: string;
    color: string;
    workflowKind?: string;
    sortOrder?: number;
  }>;
  priorities: Array<{
    id: string;
    key: string;
    name: string;
    color: string;
    sortOrder?: number;
  }>;
  categories: Array<{ id: string; name: string; slug?: string; color?: string | null }>;
  ticket_types: Array<{
    id: string;
    key: string;
    name: string;
    color?: string;
    sortOrder?: number;
  }>;
};

export type PortalTicketWorkspaceExtras = {
  customer: Record<string, unknown> | null;
  verlauf: Array<Record<string, unknown>>;
  aiInsights: {
    summary?: string | null;
    insights?: unknown[];
    rootCause?: string | null;
    sentiment?: string | null;
    suggestedReply?: string | null;
    accountHealth?: string | null;
  } | null;
  assets: Array<Record<string, unknown>>;
  neuralLinks: Array<Record<string, unknown>>;
  tasks: Array<{ id: string; task: string; completed: boolean; source?: string }>;
  timeEntries: Array<Record<string, unknown>>;
  timeSummary?: { totalHours?: number; totalAmount?: number; count?: number } | null;
  meta: PortalTicketWorkspaceMeta | null;
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
} & PortalTicketWorkspaceExtras;

export type PortalTicketFieldPatch = {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignee_id?: string | null;
  categoryId?: string | null;
  category?: string | null;
  ticket_type?: string | null;
  type?: string | null;
  sla_tier?: string | null;
  account_health?: string | null;
  escalated?: boolean;
  support_level?: string | null;
  supportLevel?: string | null;
  assigned_queue?: string | null;
  assignedQueue?: string | null;
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
      is_internal?: boolean;
    },
  ): Promise<void>;

  updateStatus?(ticketId: string, status: TicketStatus): Promise<Ticket | null>;

  updateFields?(ticketId: string, patch: PortalTicketFieldPatch): Promise<Ticket | null>;

  aiSync?(ticketId: string, options?: { forceRefresh?: boolean }): Promise<{
    ticket: Ticket;
    aiInsights?: PortalTicketWorkspaceExtras['aiInsights'];
  }>;

  addTask?(ticketId: string, task: string): Promise<PortalTicketWorkspaceExtras['tasks']>;

  updateTask?(
    ticketId: string,
    taskId: string,
    patch: { task?: string; completed?: boolean },
  ): Promise<PortalTicketWorkspaceExtras['tasks']>;

  deleteTask?(ticketId: string, taskId: string): Promise<PortalTicketWorkspaceExtras['tasks']>;

  addTimeEntry?(
    ticketId: string,
    payload: {
      hours: number;
      kuerzel?: string;
      description?: string;
      date?: string;
      sonderzahlung?: boolean;
    },
  ): Promise<Record<string, unknown>>;

  addParticipant?(ticketId: string, userId: string): Promise<void>;

  removeParticipant?(ticketId: string, userId: string): Promise<void>;

  openBack(): void;

  /** Optional: navigate to portal KB create (In KB). */
  openConvertToKb?(ticket: Ticket): void;
}
