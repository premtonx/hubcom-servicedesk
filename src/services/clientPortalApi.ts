import axios from 'axios';
import type { Ticket, TicketPriority, TicketStatus } from '../types';

export interface PortalMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isDeactivated?: boolean;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export interface PortalTeamSummary {
  totalActive: number;
  clientAdmins: number;
  clientSupporters: number;
  clientUsers: number;
  total: number;
}

export type PortalTeamRole = 'CLIENT_ADMIN' | 'CLIENT_SUPPORTER' | 'CLIENT_USER';

export interface PortalTicketAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentBase64: string;
}

export interface PortalEmailChannel {
  id: string;
  name?: string;
  email?: string;
  mailbox?: string | null;
  tenantId?: string | null;
  clientId?: string | null;
  hasClientSecret?: boolean;
  inboundEnabled?: boolean;
  sendAsEnabled?: boolean;
  status?: string;
  lastTestOk?: boolean | null;
  lastTestAt?: string | null;
  lastError?: string | null;
  organizationId?: string | null;
  connectionType?: string;
  signature_enabled?: boolean;
  signature_html?: string | null;
  signature_logo_data?: string | null;
  signature_logo_mime?: string | null;
  hasSignatureLogo?: boolean;
}

export interface PortalEmailOrgSettings {
  id: string;
  name: string;
  domain?: string | null;
  m365TenantId?: string | null;
  ssoEnabled?: boolean;
}

async function dbAction<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const res = await axios.post('/api/db', payload, { withCredentials: true });
  return res.data?.result as T;
}

export interface PortalDashboardResponse {
  role: string;
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    portalBannerUrl?: string | null;
    portalTitle: string;
  };
  user: { id: string; name: string };
  kpis: Record<string, number | string>;
  tickets: Array<{
    id: string;
    customId: string | null;
    subject: string;
    status: string;
    priority: string;
    updatedAt: string;
    requesterName: string | null;
    waitingOnCustomer: boolean;
  }>;
  myOpenTickets?: PortalDashboardResponse['tickets'];
  recentlyResolved?: PortalDashboardResponse['tickets'];
  activity?: Array<{ date: string; name: string; created: number; resolved: number }>;
  team?: PortalTeamSummary | null;
  email?: {
    configured: boolean;
    healthy: boolean;
    mailbox: string | null;
    status: string | null;
    sendAsEnabled: boolean;
  } | null;
}

export const clientPortalApi = {
  async getDashboard(): Promise<PortalDashboardResponse> {
    const res = await axios.get('/api/portal/dashboard', { withCredentials: true });
    return res.data as PortalDashboardResponse;
  },

  async listMembers(): Promise<PortalMember[]> {
    const res = await axios.get('/api/portal/members', { withCredentials: true });
    return res.data?.members || [];
  },

  async inviteMember(payload: {
    name: string;
    email: string;
    role: 'CLIENT_SUPPORTER' | 'CLIENT_USER';
  }): Promise<{
    member: PortalMember;
    setupLink?: string | null;
    emailSent?: boolean;
    emailReason?: string | null;
    invitationStatus?: string;
  }> {
    const res = await axios.post('/api/portal/members', payload, { withCredentials: true });
    return {
      member: res.data?.member,
      setupLink: res.data?.setupLink ?? null,
      emailSent: res.data?.emailSent,
      emailReason: res.data?.emailReason ?? null,
      invitationStatus: res.data?.invitationStatus,
    };
  },

  async listTeam(): Promise<{ members: PortalMember[]; summary: PortalTeamSummary }> {
    const res = await axios.get('/api/portal/team', { withCredentials: true });
    const members = (res.data?.members || []).map((m: any) => ({
      ...m,
      isDeactivated: m.isActive === false,
    }));
    return {
      members,
      summary: res.data?.summary || {
        totalActive: 0,
        clientAdmins: 0,
        clientSupporters: 0,
        clientUsers: 0,
        total: 0,
      },
    };
  },

  async createTeamMember(payload: {
    name: string;
    email: string;
    role: PortalTeamRole;
  }): Promise<{
    member: PortalMember;
    setupLink?: string | null;
    emailSent?: boolean;
    emailReason?: string | null;
    invitationStatus?: string;
  }> {
    const res = await axios.post('/api/portal/team', payload, { withCredentials: true });
    return {
      member: { ...res.data?.member, isDeactivated: res.data?.member?.isActive === false },
      setupLink: res.data?.setupLink ?? null,
      emailSent: res.data?.emailSent,
      emailReason: res.data?.emailReason ?? null,
      invitationStatus: res.data?.invitationStatus,
    };
  },

  async updateTeamMember(
    userId: string,
    payload: { name?: string; role?: PortalTeamRole; isActive?: boolean },
  ): Promise<PortalMember> {
    const res = await axios.patch(`/api/portal/team/${encodeURIComponent(userId)}`, payload, {
      withCredentials: true,
    });
    const member = res.data?.member;
    return { ...member, isDeactivated: member?.isActive === false };
  },

  async resetTeamMemberPassword(userId: string): Promise<{
    setupLink?: string | null;
    emailSent?: boolean;
    emailReason?: string | null;
    invitationStatus?: string;
  }> {
    const res = await axios.post(
      `/api/portal/team/${encodeURIComponent(userId)}/reset-password`,
      {},
      { withCredentials: true },
    );
    return {
      setupLink: res.data?.setupLink ?? null,
      emailSent: res.data?.emailSent,
      emailReason: res.data?.emailReason ?? null,
      invitationStatus: res.data?.invitationStatus,
    };
  },

  async listTickets(): Promise<Ticket[]> {
    const docs = await dbAction<Ticket[]>({
      action: 'get_docs',
      collection: 'tickets',
      constraints: [],
    });
    return Array.isArray(docs) ? docs : [];
  },

  async getTicket(id: string): Promise<Ticket | null> {
    const doc = await dbAction<Ticket | null>({
      action: 'get_doc',
      collection: 'tickets',
      id,
    });
    return doc || null;
  },

  async createTicket(payload: {
    subject: string;
    description: string;
    priority: TicketPriority;
    category?: string;
    status?: TicketStatus;
    requesterId?: string;
    participantIds?: string[];
    attachments?: PortalTicketAttachment[];
    customerName?: string;
    customerEmail?: string;
  }): Promise<string> {
    const created = await dbAction<{ id: string }>({
      action: 'add_doc',
      collection: 'tickets',
      data: {
        subject: payload.subject,
        description: payload.description,
        html_content: payload.description,
        priority: payload.priority,
        status: payload.status || 'open',
        tags: payload.category ? ['client-portal', `category:${payload.category}`] : ['client-portal'],
        channel: 'portal',
        type: 'incident',
        ticketKind: 'support',
        customerName: payload.customerName || '',
        customerEmail: payload.customerEmail || '',
        requesterId: payload.requesterId,
        attachments: payload.attachments || [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const ticketId = created?.id;
    if (!ticketId) throw new Error('Ticket create failed — missing id.');

    // Add participants after create (server stamps organizationId).
    for (const userId of payload.participantIds || []) {
      if (!userId || userId === payload.requesterId) continue;
      try {
        await axios.post(
          `/api/tickets/${encodeURIComponent(ticketId)}/participants`,
          { userId },
          { withCredentials: true },
        );
      } catch {
        /* non-fatal — ticket already exists */
      }
    }

    return ticketId;
  },

  async listMessages(ticketId: string): Promise<any[]> {
    const docs = await dbAction<any[]>({
      action: 'get_docs',
      collection: `tickets/${ticketId}/messages`,
      constraints: [],
    });
    return Array.isArray(docs) ? docs : [];
  },

  async reply(
    ticketId: string,
    payload: { content: string; senderId: string; senderName?: string },
  ) {
    const res = await axios.post(
      `/api/tickets/${encodeURIComponent(ticketId)}/replies`,
      {
        content: payload.content,
        senderId: payload.senderId,
        senderName: payload.senderName,
        senderType: 'customer',
      },
      { withCredentials: true },
    );
    return res.data;
  },

  async updateTicketStatus(ticketId: string, status: TicketStatus) {
    const res = await axios.patch(
      `/api/tickets/${encodeURIComponent(ticketId)}`,
      { status },
      { withCredentials: true },
    );
    return res.data?.ticket;
  },

  async listParticipants(ticketId: string) {
    const res = await axios.get(`/api/tickets/${encodeURIComponent(ticketId)}/participants`, {
      withCredentials: true,
    });
    return (res.data?.participants || []) as Array<{
      ticket_id: string;
      user_id: string;
      added_by: string | null;
      created_at: string;
    }>;
  },

  async addParticipant(ticketId: string, userId: string) {
    const res = await axios.post(
      `/api/tickets/${encodeURIComponent(ticketId)}/participants`,
      { userId },
      { withCredentials: true },
    );
    return res.data?.participant;
  },

  async removeParticipant(ticketId: string, userId: string) {
    await axios.delete(
      `/api/tickets/${encodeURIComponent(ticketId)}/participants/${encodeURIComponent(userId)}`,
      { withCredentials: true },
    );
  },

  async getEmailChannel(): Promise<{
    channel: PortalEmailChannel | null;
    organization: PortalEmailOrgSettings | null;
  }> {
    const res = await axios.get('/api/portal/email-channel', { withCredentials: true });
    return {
      channel: res.data?.channel || null,
      organization: res.data?.organization || null,
    };
  },

  async saveEmailChannel(payload: Record<string, unknown>): Promise<PortalEmailChannel> {
    const res = await axios.put('/api/portal/email-channel', payload, {
      withCredentials: true,
    });
    return res.data?.channel;
  },

  async testEmailChannel(
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; message: string }> {
    const res = await axios.post('/api/portal/email-channel/test', payload, {
      withCredentials: true,
    });
    return {
      ok: Boolean(res.data?.ok ?? res.data?.success),
      message: res.data?.message || res.data?.error || '',
    };
  },

  async updateEmailSso(payload: {
    m365TenantId?: string | null;
    ssoEnabled?: boolean;
  }): Promise<PortalEmailOrgSettings | null> {
    const res = await axios.put(
      '/api/portal/email-channel/sso',
      {
        m365TenantId: payload.m365TenantId,
        ssoEnabled: payload.ssoEnabled,
      },
      { withCredentials: true },
    );
    return res.data?.organization || null;
  },
};
