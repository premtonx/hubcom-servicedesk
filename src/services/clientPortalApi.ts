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

/** @deprecated Portal ticket paths must never call /api/db — kept only as a hard guard. */
function assertNeverDb(path: string): void {
  if (path.includes('/api/db')) {
    throw new Error('Portal ticket client must not call /api/db');
  }
}

export interface PortalDashboardReturnsKpis {
  open: number;
  overdue: number;
  stage3: number;
  returnedLast30: number;
}

export interface PortalDashboardResponse {
  role: string;
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    portalBannerUrl?: string | null;
    portalTitle: string;
    hardwareReturnsEnabled?: boolean;
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
  returnsKpis?: PortalDashboardReturnsKpis | null;
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

  async deleteTeamMember(userId: string): Promise<{
    deletedUserId: string;
    email: string;
    name: string;
  }> {
    const res = await axios.delete(`/api/portal/team/${encodeURIComponent(userId)}`, {
      withCredentials: true,
    });
    return {
      deletedUserId: String(res.data?.deletedUserId || userId),
      email: String(res.data?.email || ''),
      name: String(res.data?.name || ''),
    };
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

  async listTickets(params?: {
    scope?: 'mine' | 'all';
    status?: string;
    q?: string;
  }): Promise<{
    tickets: Ticket[];
    counts: Record<string, number>;
    scope: 'mine' | 'all';
  }> {
    const path = '/api/portal/tickets';
    assertNeverDb(path);
    const res = await axios.get(path, {
      withCredentials: true,
      params: {
        scope: params?.scope,
        status: params?.status,
        q: params?.q,
      },
    });
    return {
      tickets: Array.isArray(res.data?.tickets) ? res.data.tickets : [],
      counts: (res.data?.counts || {}) as Record<string, number>,
      scope: res.data?.scope === 'all' ? 'all' : 'mine',
    };
  },

  async getTicket(id: string): Promise<{
    ticket: Ticket | null;
    messages: any[];
    participants: Array<{
      ticket_id: string;
      user_id: string;
      added_by: string | null;
      created_at: string;
    }>;
    attachments: PortalTicketAttachment[];
    hardwareReturn?: Record<string, unknown> | null;
    enabledModules?: { hardwareReturns?: boolean };
  }> {
    const path = `/api/portal/tickets/${encodeURIComponent(id)}`;
    assertNeverDb(path);
    const res = await axios.get(path, { withCredentials: true });
    return {
      ticket: (res.data?.ticket as Ticket) || null,
      messages: Array.isArray(res.data?.messages) ? res.data.messages : [],
      participants: Array.isArray(res.data?.participants) ? res.data.participants : [],
      attachments: Array.isArray(res.data?.attachments) ? res.data.attachments : [],
      hardwareReturn: res.data?.hardwareReturn ?? null,
      enabledModules: res.data?.enabledModules,
    };
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
    hardwareReturn?: Record<string, unknown> | null;
  }): Promise<string> {
    const path = '/api/portal/tickets';
    assertNeverDb(path);
    const res = await axios.post(
      path,
      {
        subject: payload.subject,
        description: payload.description,
        priority: payload.priority,
        category: payload.category,
        requesterId: payload.requesterId,
        participantIds: payload.participantIds,
        attachments: payload.attachments || [],
        customerName: payload.customerName || '',
        customerEmail: payload.customerEmail || '',
        hardwareReturn: payload.hardwareReturn || undefined,
      },
      { withCredentials: true },
    );
    const ticketId = res.data?.ticket?.id as string | undefined;
    if (!ticketId) throw new Error('Ticket create failed — missing id.');
    return ticketId;
  },

  async updateHardwareReturn(ticketId: string, hardwareReturn: Record<string, unknown>) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}`;
    assertNeverDb(path);
    const res = await axios.patch(
      path,
      { hardwareReturn },
      { withCredentials: true },
    );
    return res.data?.hardwareReturn || null;
  },

  /** @deprecated Prefer getTicket() which already returns public messages. */
  async listMessages(ticketId: string): Promise<any[]> {
    const detail = await this.getTicket(ticketId);
    return detail.messages;
  },

  async reply(
    ticketId: string,
    payload: {
      content: string;
      senderId?: string;
      senderName?: string;
      attachments?: PortalTicketAttachment[];
    },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/messages`;
    assertNeverDb(path);
    const res = await axios.post(
      path,
      {
        content: payload.content,
        senderName: payload.senderName,
        attachments: payload.attachments || [],
      },
      { withCredentials: true },
    );
    return res.data;
  },

  async updateTicketStatus(ticketId: string, status: TicketStatus) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}`;
    assertNeverDb(path);
    const res = await axios.patch(path, { status }, { withCredentials: true });
    return res.data?.ticket;
  },

  async updateTicketFields(
    ticketId: string,
    patch: { status?: TicketStatus; priority?: TicketPriority },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}`;
    assertNeverDb(path);
    const body: Record<string, unknown> = {};
    if (patch.status != null) body.status = patch.status;
    if (patch.priority != null) body.priority = patch.priority;
    if (Object.keys(body).length === 0) return null;
    const res = await axios.patch(path, body, { withCredentials: true });
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
