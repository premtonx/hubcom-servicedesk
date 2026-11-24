/**
 * Role-aware Kunden-Portal dashboard aggregator.
 * Pure functions — safe for isolation unit tests without HTTP/DB.
 */

import {
  evaluateClientTicketVisibility,
  sanitizeTicketForClient,
  ticketOrganizationId,
  ticketRequesterId,
} from './ticket-visibility.js';
import { isClientPortalRole, type ClientPortalRole } from './roles.js';
import { toPortalStatusGroup } from '../portal/status.js';

export interface PortalDashboardTicketRow {
  id: string;
  customId: string | null;
  subject: string;
  status: string;
  priority: string;
  updatedAt: string;
  requesterName: string | null;
  waitingOnCustomer: boolean;
}

export interface PortalDashboardTeamSummary {
  totalActive: number;
  clientAdmins: number;
  clientSupporters: number;
  clientUsers: number;
}

export interface PortalDashboardEmailStatus {
  configured: boolean;
  healthy: boolean;
  mailbox: string | null;
  status: string | null;
  sendAsEnabled: boolean;
}

export interface PortalDashboardActivityPoint {
  date: string;
  name: string;
  created: number;
  resolved: number;
}

export interface PortalDashboardPayload {
  role: ClientPortalRole;
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    portalBannerUrl: string | null;
    portalTitle: string;
  };
  user: {
    id: string;
    name: string;
  };
  kpis: Record<string, number | string>;
  tickets: PortalDashboardTicketRow[];
  myOpenTickets?: PortalDashboardTicketRow[];
  recentlyResolved?: PortalDashboardTicketRow[];
  activity?: PortalDashboardActivityPoint[];
  team?: PortalDashboardTeamSummary | null;
  email?: PortalDashboardEmailStatus | null;
}

function parseTs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value).getTime() || 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function isOpenStatus(status: string): boolean {
  const s = status.toLowerCase();
  return !['closed', 'resolved', 'merged', 'deleted', 'trash', 'spam'].includes(s);
}

function avgFirstResponseHours(tickets: Array<Record<string, unknown>>): string {
  const samples: number[] = [];
  for (const t of tickets) {
    const created = parseTs(t.createdAt || t.created_at);
    const first =
      parseTs(t.firstRespondedAt) ||
      parseTs(t.first_response_at) ||
      parseTs(t.firstAgentReplyAt);
    if (created && first && first >= created) {
      samples.push((first - created) / 3_600_000);
    }
  }
  if (samples.length === 0) return '—';
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (avg < 1) return `${Math.round(avg * 60)} Min.`;
  if (avg < 24) return `${Math.round(avg * 10) / 10} Std.`;
  return `${Math.round((avg / 24) * 10) / 10} Tg.`;
}

function toTicketRow(ticket: Record<string, unknown>): PortalDashboardTicketRow {
  const status = String(ticket.status || 'open');
  return {
    id: String(ticket.id),
    customId: ticket.customId ? String(ticket.customId) : null,
    subject: String(ticket.subject || 'Ohne Betreff'),
    status,
    priority: String(ticket.priority || 'medium'),
    updatedAt: new Date(
      parseTs(ticket.updatedAt || ticket.updated_at) || Date.now(),
    ).toISOString(),
    requesterName:
      (ticket.customerName && String(ticket.customerName)) ||
      (ticket.requesterName && String(ticket.requesterName)) ||
      (ticket.from_name && String(ticket.from_name)) ||
      null,
    waitingOnCustomer: toPortalStatusGroup(status) === 'waiting_customer',
  };
}

function buildActivity(
  tickets: Array<Record<string, unknown>>,
  days = 30,
): PortalDashboardActivityPoint[] {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const points: PortalDashboardActivityPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const created = tickets.filter((t) => {
      const ts = parseTs(t.createdAt || t.created_at);
      return ts && new Date(ts).toISOString().slice(0, 10) === iso;
    }).length;
    const resolved = tickets.filter((t) => {
      const status = String(t.status || '').toLowerCase();
      if (status !== 'resolved' && status !== 'closed') return false;
      const ts = parseTs(t.resolvedAt || t.closedAt || t.updatedAt);
      return ts && new Date(ts).toISOString().slice(0, 10) === iso;
    }).length;
    points.push({
      date: iso,
      name: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      created,
      resolved,
    });
  }
  return points;
}

/**
 * Build a portal dashboard payload from already-loaded org-scoped tickets.
 * Enforces CLIENT_USER own/participant visibility and strips internal fields.
 */
export function buildPortalDashboardPayload(params: {
  role: string;
  userId: string;
  userName: string;
  organizationId: string;
  organization: {
    id: string;
    name: string;
    logoUrl?: string | null;
    portalBannerUrl?: string | null;
    portalTitle?: string | null;
  };
  tickets: Array<Record<string, unknown>>;
  /** For CLIENT_USER: ticket ids where the user is a participant. */
  participantTicketIds?: string[];
  teamSummary?: PortalDashboardTeamSummary | null;
  emailStatus?: PortalDashboardEmailStatus | null;
}): PortalDashboardPayload {
  if (!isClientPortalRole(params.role)) {
    throw Object.assign(new Error('Not a client portal role'), { status: 403 });
  }
  const role = params.role as ClientPortalRole;
  const orgId = params.organizationId;

  // Hard tenant filter first — never trust caller-supplied cross-org tickets.
  const orgTickets = params.tickets.filter((t) => ticketOrganizationId(t) === orgId);

  const session = {
    id: params.userId,
    role,
    organizationId: orgId,
  };

  const participantSet = new Set(params.participantTicketIds || []);
  const visible = orgTickets.filter((t) => {
    if (role === 'CLIENT_USER') {
      const requester = ticketRequesterId(t);
      if (requester === params.userId) return true;
      return participantSet.has(String(t.id));
    }
    return evaluateClientTicketVisibility(session, t);
  });

  const sanitized = visible.map((t) => sanitizeTicketForClient(t));
  const openTickets = sanitized.filter((t) => isOpenStatus(String(t.status || '')));
  const waitingCustomer = openTickets.filter(
    (t) => toPortalStatusGroup(String(t.status || '')) === 'waiting_customer',
  );
  const waitingClientIt = openTickets.filter((t) => {
    const group = toPortalStatusGroup(String(t.status || ''));
    return group === 'open' || group === 'in_progress';
  });

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const resolved30 = sanitized.filter((t) => {
    const status = String(t.status || '').toLowerCase();
    if (status !== 'resolved' && status !== 'closed') return false;
    const ts = parseTs(t.resolvedAt || t.closedAt || t.updatedAt);
    return ts >= thirtyDaysAgo;
  });

  const myParticipations = sanitized.filter((t) => {
    if (!isOpenStatus(String(t.status || ''))) return false;
    const requester = ticketRequesterId(t);
    return requester === params.userId || participantSet.has(String(t.id));
  });

  const sortedOpen = [...openTickets].sort(
    (a, b) => parseTs(b.updatedAt) - parseTs(a.updatedAt),
  );
  const ticketRows = sortedOpen.slice(0, 12).map(toTicketRow);

  const baseOrg = {
    id: params.organization.id,
    name: params.organization.name,
    logoUrl: params.organization.logoUrl || null,
    portalBannerUrl: params.organization.portalBannerUrl || null,
    portalTitle:
      params.organization.portalTitle ||
      `${params.organization.name} ServiceDesk`,
  };

  if (role === 'CLIENT_USER') {
    const myOpen = sortedOpen
      .filter((t) => {
        const requester = ticketRequesterId(t);
        return requester === params.userId || participantSet.has(String(t.id));
      })
      .slice(0, 10)
      .map(toTicketRow);
    const recentlyResolved = resolved30
      .filter((t) => {
        const requester = ticketRequesterId(t);
        return requester === params.userId || participantSet.has(String(t.id));
      })
      .sort((a, b) => parseTs(b.resolvedAt || b.closedAt || b.updatedAt) - parseTs(a.resolvedAt || a.closedAt || a.updatedAt))
      .slice(0, 8)
      .map(toTicketRow);

    return {
      role,
      organization: baseOrg,
      user: { id: params.userId, name: params.userName },
      kpis: {
        myOpenCount: myOpen.length,
        recentlyResolvedCount: recentlyResolved.length,
      },
      tickets: myOpen,
      myOpenTickets: myOpen,
      recentlyResolved,
      team: null,
      email: null,
    };
  }

  if (role === 'CLIENT_SUPPORTER') {
    return {
      role,
      organization: baseOrg,
      user: { id: params.userId, name: params.userName },
      kpis: {
        openCompanyTickets: openTickets.length,
        waitingOnClientIt: waitingClientIt.length,
        myParticipations: myParticipations.length,
      },
      tickets: ticketRows,
      activity: buildActivity(sanitized, 30),
      team: null,
      email: null,
    };
  }

  // CLIENT_ADMIN
  return {
    role,
    organization: baseOrg,
    user: { id: params.userId, name: params.userName },
    kpis: {
      openCompanyTickets: openTickets.length,
      waitingOnCustomer: waitingCustomer.length,
      resolvedLast30Days: resolved30.length,
      avgResponseTime: avgFirstResponseHours(sanitized),
    },
    tickets: ticketRows,
    activity: buildActivity(sanitized, 30),
    team: params.teamSummary || {
      totalActive: 0,
      clientAdmins: 0,
      clientSupporters: 0,
      clientUsers: 0,
    },
    email: params.emailStatus || {
      configured: false,
      healthy: false,
      mailbox: null,
      status: null,
      sendAsEnabled: false,
    },
  };
}

/** Assert a dashboard payload never contains another org's tickets (test helper). */
export function assertPortalDashboardTenantIsolation(
  payload: PortalDashboardPayload,
  organizationId: string,
  allSourceTickets: Array<Record<string, unknown>>,
): { ok: boolean; reason?: string } {
  const allowedIds = new Set(
    allSourceTickets
      .filter((t) => ticketOrganizationId(t) === organizationId)
      .map((t) => String(t.id)),
  );
  for (const row of [
    ...payload.tickets,
    ...(payload.myOpenTickets || []),
    ...(payload.recentlyResolved || []),
  ]) {
    if (!allowedIds.has(row.id)) {
      return { ok: false, reason: `Ticket ${row.id} is outside organization ${organizationId}` };
    }
  }
  if (payload.organization.id !== organizationId) {
    return { ok: false, reason: 'Organization id mismatch' };
  }
  return { ok: true };
}
