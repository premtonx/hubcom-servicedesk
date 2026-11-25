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

export interface PortalDashboardReturnsKpis {
  open: number;
  overdue: number;
  stage3: number;
  returnedLast30: number;
}

/** One point on the Rücklieferungen-Trends chart. */
export interface PortalDashboardReturnsActivityPoint {
  date: string;
  name: string;
  open: number;
  overdue: number;
  returned: number;
}

export type PortalReturnsTrendRange = '7d' | '30d' | '90d' | '12m' | 'all';

export const PORTAL_RETURNS_TREND_RANGES: PortalReturnsTrendRange[] = [
  '7d',
  '30d',
  '90d',
  '12m',
  'all',
];

/** Minimal return facts for trend aggregation (no PII required). */
export interface PortalReturnsTrendSourceRow {
  createdAt: string | null;
  deliveryDate: string | null;
  returnDueDate: string | null;
  returned: boolean;
  returnedAt: string | null;
}

export interface PortalDashboardPayload {
  role: ClientPortalRole;
  organization: {
    id: string;
    name: string;
    logoUrl: string | null;
    portalBannerUrl: string | null;
    portalTitle: string;
    hardwareReturnsEnabled?: boolean;
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
  /** Present when org has hardware_returns_enabled and caller is org-wide. */
  returnsKpis?: PortalDashboardReturnsKpis | null;
  /** Precomputed trend series per timeframe (default chart uses `30d`). */
  returnsActivityByRange?: Partial<
    Record<PortalReturnsTrendRange, PortalDashboardReturnsActivityPoint[]>
  > | null;
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
    waitingOnCustomer: toPortalStatusGroup(status) === 'waiting',
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

function berlinDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function berlinMonthKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
  })
    .format(d)
    .slice(0, 7);
}

function berlinDayLabel(d: Date): string {
  return d.toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
  });
}

function berlinMonthLabel(d: Date): string {
  return d.toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    month: 'short',
    year: '2-digit',
  });
}

function parseDateOnlyUtc(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfBerlinDayUtc(now: Date = new Date()): Date {
  const key = berlinDayKey(now);
  return new Date(`${key}T00:00:00.000Z`);
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addUtcMonths(d: Date, months: number): Date {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  return next;
}

function wasOpenOnDay(
  row: PortalReturnsTrendSourceRow,
  dayStart: Date,
): boolean {
  const created = parseTs(row.createdAt) || parseTs(row.deliveryDate);
  if (created && created > dayStart.getTime() + 24 * 60 * 60 * 1000 - 1) {
    return false;
  }
  if (!row.returned) return true;
  const returnedAt = parseTs(row.returnedAt);
  if (!returnedAt) return false;
  // Still open on day if returned after end of that day.
  return returnedAt > dayStart.getTime() + 24 * 60 * 60 * 1000 - 1;
}

function wasOverdueOnDay(
  row: PortalReturnsTrendSourceRow,
  dayStart: Date,
): boolean {
  if (!wasOpenOnDay(row, dayStart)) return false;
  const due =
    parseDateOnlyUtc(row.returnDueDate) || parseDateOnlyUtc(row.deliveryDate);
  if (!due) return false;
  return due.getTime() < dayStart.getTime();
}

function returnedOnDay(row: PortalReturnsTrendSourceRow, dayStart: Date): boolean {
  if (!row.returned || !row.returnedAt) return false;
  const t = parseTs(row.returnedAt);
  if (!t) return false;
  const key = berlinDayKey(new Date(t));
  return key === berlinDayKey(dayStart);
}

function returnedInMonth(row: PortalReturnsTrendSourceRow, monthStart: Date): boolean {
  if (!row.returned || !row.returnedAt) return false;
  const t = parseTs(row.returnedAt);
  if (!t) return false;
  return berlinMonthKey(new Date(t)) === berlinMonthKey(monthStart);
}

function wasOpenInMonth(
  row: PortalReturnsTrendSourceRow,
  monthStart: Date,
): boolean {
  // Snapshot at end of month (or today if current month).
  const nextMonth = addUtcMonths(monthStart, 1);
  const end = addUtcDays(nextMonth, -1);
  const today = startOfBerlinDayUtc();
  const snapshot = end.getTime() > today.getTime() ? today : end;
  return wasOpenOnDay(row, snapshot);
}

function wasOverdueInMonth(
  row: PortalReturnsTrendSourceRow,
  monthStart: Date,
): boolean {
  const nextMonth = addUtcMonths(monthStart, 1);
  const end = addUtcDays(nextMonth, -1);
  const today = startOfBerlinDayUtc();
  const snapshot = end.getTime() > today.getTime() ? today : end;
  return wasOverdueOnDay(row, snapshot);
}

/**
 * Build Rücklieferungen-Trends series for a timeframe.
 * Daily buckets for 7d/30d/90d; monthly for 12m/all.
 */
export function buildReturnsActivitySeries(
  rows: PortalReturnsTrendSourceRow[],
  range: PortalReturnsTrendRange,
  now: Date = new Date(),
): PortalDashboardReturnsActivityPoint[] {
  const today = startOfBerlinDayUtc(now);

  if (range === '12m' || range === 'all') {
    let months = range === '12m' ? 12 : 24;
    if (range === 'all' && rows.length) {
      let earliest = today.getTime();
      for (const r of rows) {
        const t = parseTs(r.createdAt) || parseTs(r.deliveryDate);
        if (t && t < earliest) earliest = t;
      }
      const earliestMonth = new Date(
        Date.UTC(
          new Date(earliest).getUTCFullYear(),
          new Date(earliest).getUTCMonth(),
          1,
        ),
      );
      const span =
        (today.getUTCFullYear() - earliestMonth.getUTCFullYear()) * 12 +
        (today.getUTCMonth() - earliestMonth.getUTCMonth()) +
        1;
      months = Math.max(1, Math.min(60, span));
    }
    const points: PortalDashboardReturnsActivityPoint[] = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const monthStart = addUtcMonths(
        new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
        -i,
      );
      points.push({
        date: berlinMonthKey(monthStart),
        name: berlinMonthLabel(monthStart),
        open: rows.filter((r) => wasOpenInMonth(r, monthStart)).length,
        overdue: rows.filter((r) => wasOverdueInMonth(r, monthStart)).length,
        returned: rows.filter((r) => returnedInMonth(r, monthStart)).length,
      });
    }
    return points;
  }

  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const points: PortalDashboardReturnsActivityPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addUtcDays(today, -i);
    points.push({
      date: berlinDayKey(day),
      name: berlinDayLabel(day),
      open: rows.filter((r) => wasOpenOnDay(r, day)).length,
      overdue: rows.filter((r) => wasOverdueOnDay(r, day)).length,
      returned: rows.filter((r) => returnedOnDay(r, day)).length,
    });
  }
  return points;
}

/** Precompute all timeframe series for the dashboard payload. */
export function buildReturnsActivityByRange(
  rows: PortalReturnsTrendSourceRow[],
  now: Date = new Date(),
): Record<PortalReturnsTrendRange, PortalDashboardReturnsActivityPoint[]> {
  const out = {} as Record<
    PortalReturnsTrendRange,
    PortalDashboardReturnsActivityPoint[]
  >;
  for (const range of PORTAL_RETURNS_TREND_RANGES) {
    out[range] = buildReturnsActivitySeries(rows, range, now);
  }
  return out;
}

export function returnsTrendSourceFromWorkbenchItems(
  items: Array<{ hardwareReturn: Record<string, any> }>,
): PortalReturnsTrendSourceRow[] {
  return items.map((it) => {
    const hw = it.hardwareReturn || {};
    return {
      createdAt: hw.created_at ? String(hw.created_at) : null,
      deliveryDate: hw.delivery_date ? String(hw.delivery_date) : null,
      returnDueDate: hw.return_due_date ? String(hw.return_due_date) : null,
      returned: Boolean(hw.returned),
      returnedAt: hw.returned_at ? String(hw.returned_at) : null,
    };
  });
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
    hardwareReturnsEnabled?: boolean;
  };
  tickets: Array<Record<string, unknown>>;
  /** For CLIENT_USER: ticket ids where the user is a participant. */
  participantTicketIds?: string[];
  teamSummary?: PortalDashboardTeamSummary | null;
  emailStatus?: PortalDashboardEmailStatus | null;
  returnsKpis?: PortalDashboardReturnsKpis | null;
  returnsActivityByRange?: Partial<
    Record<PortalReturnsTrendRange, PortalDashboardReturnsActivityPoint[]>
  > | null;
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
    (t) => toPortalStatusGroup(String(t.status || '')) === 'waiting',
  );
  const inProgressTickets = openTickets.filter(
    (t) => toPortalStatusGroup(String(t.status || '')) === 'in_progress',
  );
  const openOnlyTickets = openTickets.filter(
    (t) => toPortalStatusGroup(String(t.status || '')) === 'open',
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
    hardwareReturnsEnabled: Boolean(params.organization.hardwareReturnsEnabled),
  };
  const returnsBlock =
    baseOrg.hardwareReturnsEnabled &&
    (role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER') &&
    params.returnsKpis
      ? {
          returnsKpis: params.returnsKpis,
          returnsActivityByRange: params.returnsActivityByRange || null,
        }
      : { returnsKpis: null, returnsActivityByRange: null };

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
        openTickets: openOnlyTickets.length,
        openCompanyTickets: openOnlyTickets.length,
        inProgressTickets: inProgressTickets.length,
        waitingTickets: waitingCustomer.length,
        resolvedLast30Days: resolved30.length,
        avgResponseTime: avgFirstResponseHours(sanitized),
      },
      tickets: myOpen,
      myOpenTickets: myOpen,
      recentlyResolved,
      activity: buildActivity(sanitized, 30),
      team: null,
      email: null,
      ...returnsBlock,
    };
  }

  if (role === 'CLIENT_SUPPORTER') {
    return {
      role,
      organization: baseOrg,
      user: { id: params.userId, name: params.userName },
      kpis: {
        openCompanyTickets: openOnlyTickets.length,
        openTickets: openOnlyTickets.length,
        inProgressTickets: inProgressTickets.length,
        waitingOnClientIt: waitingClientIt.length,
        waitingTickets: waitingCustomer.length,
        resolvedLast30Days: resolved30.length,
        avgResponseTime: avgFirstResponseHours(sanitized),
        myParticipations: myParticipations.length,
      },
      tickets: ticketRows,
      activity: buildActivity(sanitized, 30),
      team: null,
      email: null,
      ...returnsBlock,
    };
  }

  // CLIENT_ADMIN
  return {
    role,
    organization: baseOrg,
    user: { id: params.userId, name: params.userName },
    kpis: {
      openCompanyTickets: openOnlyTickets.length,
      openTickets: openOnlyTickets.length,
      inProgressTickets: inProgressTickets.length,
      waitingOnCustomer: waitingCustomer.length,
      waitingTickets: waitingCustomer.length,
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
    ...returnsBlock,
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
