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
  approvalStatus?: PortalApprovalStatus;
  approvalRequestedAt?: string | null;
  authMethod?: string | null;
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

export type PortalSsoApprovalMode =
  | 'admin_approval'
  | 'pre_provisioned_only'
  | 'auto_domain';

export type PortalApprovalStatus = 'active' | 'pending_approval' | 'rejected';

export interface PortalKbSuggestHit {
  id: string;
  title: string;
  snippet: string;
  category_name: string | null;
}

export interface PortalEmailOrgSettings {
  id: string;
  name: string;
  domain?: string | null;
  m365TenantId?: string | null;
  ssoEnabled?: boolean;
  ssoApprovalMode?: PortalSsoApprovalMode;
  second_level_notify_enabled?: boolean;
  second_level_support_emails?: string[];
  second_level_label?: string;
  secondLevelNotify?: {
    second_level_notify_enabled: boolean;
    second_level_support_emails: string[];
    second_level_label: string;
  };
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
  openAddedLast7d?: number;
  overdueAddedToday?: number;
  overdueAddedLast7d?: number;
  escalatedLast7d?: number;
  returnedLast7d?: number;
}

export type PortalReturnsTrendRange = '7d' | '30d' | '90d' | '12m' | 'all';

export interface PortalDashboardReturnsActivityPoint {
  date: string;
  name: string;
  offeneRuecklieferungen: number;
  ueberfaellig: number;
  letzteStufeEskaliert: number;
  zurueckgeliefert: number;
  open: number;
  overdue: number;
  escalated: number;
  returned: number;
  offen?: number;
}

export interface PortalReturnsTrendsResponse {
  organizationId: string;
  timeframe: PortalReturnsTrendRange;
  points: PortalDashboardReturnsActivityPoint[];
  cached?: boolean;
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
  returnsActivityByRange?: Partial<
    Record<PortalReturnsTrendRange, PortalDashboardReturnsActivityPoint[]>
  > | null;
  returnStatusBreakdown?: {
    openTotal: number;
    versendet: number;
    ueberfaellig: number;
    eingegangen30d: number;
    versendetPct: number;
    ueberfaelligPct: number;
    eingegangenPct: number;
  } | null;
  weeklyPerformance?: {
    weeks: Array<{
      kwLabel: string;
      isoWeek: number;
      isoYear: number;
      weekStart: string;
      puenktlichPct: number;
      ueberfaelligPct: number;
      puenktlichCount: number;
      ueberfaelligCount: number;
      totalCompleted: number;
    }>;
    overallPuenktlichPct: number;
  } | null;
  recentActivities?: Array<{
    id: string;
    type: 'return_completed' | 'return_reminder' | 'return_created' | 'ticket';
    title: string;
    timestamp: string;
    href: string;
  }> | null;
}

export const clientPortalApi = {
  async getDashboard(opts?: { signal?: AbortSignal }): Promise<PortalDashboardResponse> {
    const path = '/api/portal/dashboard';
    assertNeverDb(path);
    const res = await axios.get(path, {
      withCredentials: true,
      signal: opts?.signal,
    });
    return res.data as PortalDashboardResponse;
  },

  /**
   * Independent Rücklieferungen trend series (Part 2) — never embeds in dashboard.
   * GET /api/portal/returns/trends?timeframe=7d|30d|90d|12m|all
   */
  async getReturnsTrends(
    timeframe: PortalReturnsTrendRange = '30d',
    opts?: { signal?: AbortSignal },
  ): Promise<PortalReturnsTrendsResponse> {
    const path = '/api/portal/returns/trends';
    assertNeverDb(path);
    const res = await axios.get(path, {
      withCredentials: true,
      signal: opts?.signal,
      params: { timeframe },
    });
    const points = Array.isArray(res.data?.points) ? res.data.points : [];
    return {
      organizationId: String(res.data?.organizationId || ''),
      timeframe: (res.data?.timeframe || timeframe) as PortalReturnsTrendRange,
      points: points.map((p: Record<string, unknown>) => {
        const open =
          Number(p.offeneRuecklieferungen ?? p.open ?? p.offen) || 0;
        const overdue = Number(p.ueberfaellig ?? p.overdue) || 0;
        const escalated =
          Number(p.letzteStufeEskaliert ?? p.escalated ?? p.stage3) || 0;
        const returned = Number(p.zurueckgeliefert ?? p.returned) || 0;
        return {
          date: String(p.date || ''),
          name: String(p.name || p.date || ''),
          offeneRuecklieferungen: open,
          ueberfaellig: overdue,
          letzteStufeEskaliert: escalated,
          zurueckgeliefert: returned,
          open,
          overdue,
          escalated,
          returned,
          offen: open,
        };
      }),
      cached: Boolean(res.data?.cached),
    };
  },

  async getMe(): Promise<{
    aiEnabled: boolean;
    aiMode: string;
    enabledModules?: Record<string, unknown>;
    user?: Record<string, unknown>;
  }> {
    const path = '/api/portal/me';
    assertNeverDb(path);
    const res = await axios.get(path, { withCredentials: true });
    return {
      aiEnabled: res.data?.aiEnabled !== false,
      aiMode: String(res.data?.aiMode || 'global_default'),
      enabledModules: res.data?.enabledModules,
      user: res.data?.user,
    };
  },

  async suggestKbArticles(query: string): Promise<PortalKbSuggestHit[]> {
    const path = '/api/portal/kb/suggest';
    assertNeverDb(path);
    const res = await axios.get(path, {
      withCredentials: true,
      params: { q: query },
    });
    const rows = Array.isArray(res.data?.articles) ? res.data.articles : [];
    return rows.map((a: Record<string, unknown>) => ({
      id: String(a.id || ''),
      title: String(a.title || ''),
      snippet: String(a.snippet || ''),
      category_name: a.category_name ? String(a.category_name) : null,
    })).filter((a: PortalKbSuggestHit) => a.id);
  },

  async markKbDeflected(articleId: string): Promise<{ deflected_count: number }> {
    const path = `/api/portal/kb/${encodeURIComponent(articleId)}/deflect`;
    assertNeverDb(path);
    const res = await axios.post(path, {}, { withCredentials: true });
    return {
      deflected_count: Number(res.data?.deflected_count || 0),
    };
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
    customer?: Record<string, unknown> | null;
    verlauf?: Array<Record<string, unknown>>;
    aiInsights?: Record<string, unknown> | null;
    assets?: Array<Record<string, unknown>>;
    neuralLinks?: Array<Record<string, unknown>>;
    tasks?: Array<{ id: string; task: string; completed: boolean; source?: string }>;
    timeEntries?: Array<Record<string, unknown>>;
    timeSummary?: { totalHours?: number; totalAmount?: number; count?: number } | null;
    meta?: {
      agents: Array<{ id: string; name: string; email: string; role: string }>;
      statuses: Array<Record<string, unknown>>;
      priorities: Array<Record<string, unknown>>;
      categories: Array<Record<string, unknown>>;
      ticket_types: Array<Record<string, unknown>>;
    } | null;
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
      customer: res.data?.customer ?? null,
      verlauf: Array.isArray(res.data?.verlauf)
        ? res.data.verlauf
        : Array.isArray(res.data?.activity_log)
          ? res.data.activity_log
          : [],
      aiInsights: (res.data?.aiInsights || res.data?.ai_insights || null) as Record<
        string,
        unknown
      > | null,
      assets: Array.isArray(res.data?.assets) ? res.data.assets : [],
      neuralLinks: Array.isArray(res.data?.neuralLinks)
        ? res.data.neuralLinks
        : Array.isArray(res.data?.related_tickets)
          ? res.data.related_tickets
          : [],
      tasks: Array.isArray(res.data?.tasks) ? res.data.tasks : [],
      timeEntries: Array.isArray(res.data?.timeEntries)
        ? res.data.timeEntries
        : Array.isArray(res.data?.time_entries)
          ? res.data.time_entries
          : [],
      timeSummary: res.data?.timeSummary || null,
      meta: res.data?.meta || null,
    };
  },

  async getTicketMeta(): Promise<{
    agents: Array<{ id: string; name: string; email: string; role: string }>;
    statuses: Array<Record<string, unknown>>;
    priorities: Array<Record<string, unknown>>;
    categories: Array<Record<string, unknown>>;
    ticket_types: Array<Record<string, unknown>>;
  }> {
    const path = '/api/portal/tickets/meta';
    assertNeverDb(path);
    const res = await axios.get(path, { withCredentials: true });
    const meta = res.data?.meta || {};
    return {
      agents: Array.isArray(meta.agents) ? meta.agents : [],
      statuses: Array.isArray(meta.statuses) ? meta.statuses : [],
      priorities: Array.isArray(meta.priorities) ? meta.priorities : [],
      categories: Array.isArray(meta.categories) ? meta.categories : [],
      ticket_types: Array.isArray(meta.ticket_types) ? meta.ticket_types : [],
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
      is_internal?: boolean;
    },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/messages`;
    assertNeverDb(path);
    const res = await axios.post(
      path,
      {
        content: payload.content,
        senderName: payload.senderName,
        attachments: payload.is_internal ? [] : payload.attachments || [],
        is_internal: payload.is_internal === true,
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
    patch: {
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
    },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}`;
    assertNeverDb(path);
    const body: Record<string, unknown> = {};
    if (patch.status != null) body.status = patch.status;
    if (patch.priority != null) body.priority = patch.priority;
    if (patch.assignee_id !== undefined) body.assignee_id = patch.assignee_id;
    if (patch.categoryId !== undefined) body.categoryId = patch.categoryId;
    if (patch.category !== undefined) body.category = patch.category;
    if (patch.ticket_type !== undefined) body.ticket_type = patch.ticket_type;
    if (patch.type !== undefined) body.type = patch.type;
    if (patch.sla_tier !== undefined) body.sla_tier = patch.sla_tier;
    if (patch.account_health !== undefined) body.account_health = patch.account_health;
    if (patch.escalated !== undefined) body.escalated = patch.escalated;
    const supportLevel =
      patch.support_level !== undefined
        ? patch.support_level
        : patch.supportLevel !== undefined
          ? patch.supportLevel
          : patch.assigned_queue !== undefined
            ? patch.assigned_queue
            : patch.assignedQueue;
    if (supportLevel !== undefined) {
      body.support_level = supportLevel;
      body.supportLevel = supportLevel;
      body.assigned_queue = supportLevel;
      body.assignedQueue = supportLevel;
    }
    if (Object.keys(body).length === 0) return null;
    const res = await axios.patch(path, body, { withCredentials: true });
    return res.data?.ticket;
  },

  async aiSyncTicket(ticketId: string, options?: { forceRefresh?: boolean }) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/ai-sync`;
    assertNeverDb(path);
    const res = await axios.post(
      path,
      { forceRefresh: options?.forceRefresh === true },
      { withCredentials: true },
    );
    return {
      ticket: res.data?.ticket as Ticket,
      aiInsights: res.data?.aiInsights || null,
    };
  },

  async addTicketTask(ticketId: string, task: string) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/tasks`;
    assertNeverDb(path);
    const res = await axios.post(path, { task }, { withCredentials: true });
    return (Array.isArray(res.data?.tasks) ? res.data.tasks : []) as Array<{
      id: string;
      task: string;
      completed: boolean;
      source?: string;
    }>;
  },

  async updateTicketTask(
    ticketId: string,
    taskId: string,
    patch: { task?: string; completed?: boolean },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/tasks/${encodeURIComponent(taskId)}`;
    assertNeverDb(path);
    const res = await axios.patch(path, patch, { withCredentials: true });
    return (Array.isArray(res.data?.tasks) ? res.data.tasks : []) as Array<{
      id: string;
      task: string;
      completed: boolean;
      source?: string;
    }>;
  },

  async deleteTicketTask(ticketId: string, taskId: string) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/tasks/${encodeURIComponent(taskId)}`;
    assertNeverDb(path);
    const res = await axios.delete(path, { withCredentials: true });
    return (Array.isArray(res.data?.tasks) ? res.data.tasks : []) as Array<{
      id: string;
      task: string;
      completed: boolean;
      source?: string;
    }>;
  },

  async addTicketTimeEntry(
    ticketId: string,
    payload: {
      hours: number;
      kuerzel?: string;
      description?: string;
      date?: string;
      sonderzahlung?: boolean;
    },
  ) {
    const path = `/api/portal/tickets/${encodeURIComponent(ticketId)}/time-entries`;
    assertNeverDb(path);
    const res = await axios.post(path, payload, { withCredentials: true });
    return (res.data?.entry || null) as Record<string, unknown> | null;
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
    ssoApprovalMode?: PortalSsoApprovalMode;
  }): Promise<PortalEmailOrgSettings | null> {
    const res = await axios.put(
      '/api/portal/email-channel/sso',
      {
        m365TenantId: payload.m365TenantId,
        ssoEnabled: payload.ssoEnabled,
        ssoApprovalMode: payload.ssoApprovalMode,
      },
      { withCredentials: true },
    );
    return res.data?.organization || null;
  },

  async updateSecondLevelNotify(payload: {
    second_level_notify_enabled?: boolean;
    second_level_support_emails?: string | string[];
    second_level_label?: string | null;
  }): Promise<PortalEmailOrgSettings | null> {
    const path = '/api/portal/settings/notifications';
    assertNeverDb(path);
    const res = await axios.put(path, payload, { withCredentials: true });
    return (
      res.data?.organization ||
      (res.data?.settings
        ? {
            id: '',
            name: '',
            second_level_notify_enabled: res.data.settings.second_level_notify_enabled,
            second_level_support_emails: res.data.settings.second_level_support_emails,
            second_level_label: res.data.settings.second_level_label,
            secondLevelNotify: res.data.settings,
          }
        : null)
    );
  },

  async sendSecondLevelTestEmail(payload?: {
    to?: string | string[];
  }): Promise<{ ok: boolean; message: string; emails?: string[] }> {
    const path = '/api/portal/settings/second-level-test';
    assertNeverDb(path);
    const res = await axios.post(path, payload || {}, { withCredentials: true });
    return {
      ok: Boolean(res.data?.ok ?? res.data?.success ?? res.data?.delivered),
      message: res.data?.message || res.data?.error || '',
      emails: Array.isArray(res.data?.emails) ? res.data.emails : undefined,
    };
  },

  async getAiSettings(): Promise<{ settings: Record<string, unknown>; organization: { id: string; name: string } }> {
    const path = '/api/portal/ai-settings';
    assertNeverDb(path);
    const res = await axios.get(path, { withCredentials: true });
    return {
      settings: (res.data?.settings || {}) as Record<string, unknown>,
      organization: res.data?.organization || { id: '', name: '' },
    };
  },

  async updateAiSettings(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const path = '/api/portal/ai-settings';
    assertNeverDb(path);
    const res = await axios.put(path, payload, { withCredentials: true });
    return (res.data?.settings || {}) as Record<string, unknown>;
  },

  async testAiSettings(payload?: {
    endpoint?: string;
    serverType?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    latencyMs?: number;
    models?: string[];
  }> {
    const path = '/api/portal/ai-settings/test';
    assertNeverDb(path);
    const res = await axios.post(path, payload || {}, { withCredentials: true });
    return {
      ok: Boolean(res.data?.ok ?? res.data?.success),
      message: res.data?.message || res.data?.error || '',
      latencyMs: typeof res.data?.latencyMs === 'number' ? res.data.latencyMs : undefined,
      models: Array.isArray(res.data?.models) ? res.data.models : undefined,
    };
  },

  async discoverAiModels(payload?: {
    endpoint?: string;
    serverType?: string;
  }): Promise<{
    ok: boolean;
    message: string;
    latencyMs?: number;
    models: string[];
    serverType?: string;
  }> {
    const path = '/api/portal/ai-settings/models';
    assertNeverDb(path);
    const res = await axios.post(path, payload || {}, { withCredentials: true });
    return {
      ok: Boolean(res.data?.ok ?? res.data?.success),
      message: res.data?.message || res.data?.error || '',
      latencyMs: typeof res.data?.latencyMs === 'number' ? res.data.latencyMs : undefined,
      models: Array.isArray(res.data?.models) ? res.data.models : [],
      serverType:
        typeof res.data?.serverType === 'string' ? res.data.serverType : undefined,
    };
  },

  async reindexAiSettings(): Promise<{
    ok: boolean;
    enqueued: number;
    deletedChunks: number;
    message: string;
  }> {
    const path = '/api/portal/ai-settings/reindex';
    assertNeverDb(path);
    const res = await axios.post(path, {}, { withCredentials: true });
    return {
      ok: Boolean(res.data?.success ?? true),
      enqueued: Number(res.data?.enqueued || 0),
      deletedChunks: Number(res.data?.deletedChunks || 0),
      message: res.data?.message || '',
    };
  },

  async approveTeamMember(
    userId: string,
    role: PortalTeamRole,
  ): Promise<PortalMember> {
    const res = await axios.post(
      `/api/portal/team/${encodeURIComponent(userId)}/approve`,
      { role },
      { withCredentials: true },
    );
    return res.data?.member;
  },

  async rejectTeamMember(userId: string): Promise<PortalMember> {
    const res = await axios.post(
      `/api/portal/team/${encodeURIComponent(userId)}/reject`,
      {},
      { withCredentials: true },
    );
    return res.data?.member;
  },
};
