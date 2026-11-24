import { Company, Ticket } from '../../../types';

export interface HydratedCompany extends Company {
  tier: string;
  healthScore: number | null;
  healthStatus: string | null;
  openTicketsCount: number;
  slaRisksCount: number;
  accountOwner: string;
  accountOwnerId?: string;
  contractPlan: string;
  contractSla: string;
  contractRenewalDate: string;
  contractStatus: 'ACTIVE' | 'EXPIRED' | '';
  contractReference: string;
  contractTerm: string;
  contractNotes: string;
  monthlySpend: string;
  hasContract: boolean;
  usersCount: number | null;
  assetsCount: number | null;
  vaultEntriesCount: number | null;
  slaPerformance: string;
  customerSince: string;
  createdAtIso: string;
  /** Normalized logo for header/list (CRM logoUrl or org logo_url). */
  logoUrl: string;
  organizationId?: string | null;
}

/** Format a date for German UI (e.g. 24.11.2026). */
export function formatDateDe(value: unknown): string {
  if (value == null || value === '') return '';
  let d: Date | null = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'object' && value && typeof (value as any).toDate === 'function') {
    d = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string' || typeof value === 'number') {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatDateTimeDe(value: unknown): string {
  if (value == null || value === '') return '';
  let d: Date | null = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'object' && value && typeof (value as any).toDate === 'function') {
    d = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string' || typeof value === 'number') {
    d = new Date(value);
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function invitationStatusLabelDe(status: string | null | undefined): string {
  switch (String(status || '').toLowerCase()) {
    case 'accepted':
      return 'Aktiv';
    case 'sent':
      return 'Einladung gesendet';
    case 'pending':
      return 'Einladung ausstehend';
    case 'expired':
      return 'Einladung abgelaufen';
    case 'failed':
      return 'Einladung fehlgeschlagen';
    case 'none':
      return '';
    default:
      return status ? String(status) : '';
  }
}

/**
 * Hydrate company for UI. Does NOT invent fixture account managers, SLA %,
 * or demo metrics when fields are missing.
 */
export function hydrateCompany(company: Company | null, ticketHistory: Ticket[]): HydratedCompany | null {
  if (!company) return null;
  const raw = company as any;

  const openTicketsCount = ticketHistory.filter(
    (t) => t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'trash',
  ).length;

  const slaRisksCount = ticketHistory.filter(
    (t) => t.priority === 'urgent' && t.status !== 'resolved' && t.status !== 'closed',
  ).length;

  const logoUrl = String(raw.logoUrl || raw.logo_url || '').trim();

  const contractStatus: HydratedCompany['contractStatus'] =
    raw.contractStatus === 'ACTIVE' || raw.contractStatus === 'EXPIRED'
      ? raw.contractStatus
      : raw.wartungsvertragStatus === 'Active'
        ? 'ACTIVE'
        : raw.wartungsvertragStatus === 'Expired'
          ? 'EXPIRED'
          : '';

  const contractPlan =
    raw.contractPlan != null && String(raw.contractPlan).trim() !== ''
      ? String(raw.contractPlan)
      : raw.tier != null
        ? String(raw.tier)
        : '';
  const contractSla =
    raw.contractSla != null && String(raw.contractSla).trim() !== ''
      ? String(raw.contractSla)
      : raw.sla != null
        ? String(raw.sla)
        : '';
  const contractRenewalDate =
    raw.contractRenewalDate != null && String(raw.contractRenewalDate).trim() !== ''
      ? String(raw.contractRenewalDate)
      : raw.contract_renewal != null
        ? String(raw.contract_renewal)
        : '';
  const monthlySpend =
    raw.monthlySpend != null && String(raw.monthlySpend).trim() !== ''
      ? String(raw.monthlySpend)
      : raw.monthly_rate != null
        ? String(raw.monthly_rate)
        : '';
  const contractReference =
    raw.contractReference != null
      ? String(raw.contractReference)
      : raw.contract_reference != null
        ? String(raw.contract_reference)
        : '';
  const contractTerm =
    raw.contractTerm != null
      ? String(raw.contractTerm)
      : raw.contract_term != null
        ? String(raw.contract_term)
        : '';
  const contractNotes =
    raw.contractNotes != null
      ? String(raw.contractNotes)
      : raw.contract_notes != null
        ? String(raw.contract_notes)
        : '';

  const createdAtIso = String(
    raw.createdAtIso ||
      raw.created_at ||
      (raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : raw.createdAt) ||
      '',
  );
  const customerSinceRaw =
    raw.customerSince != null && String(raw.customerSince).trim() !== ''
      ? String(raw.customerSince)
      : formatDateDe(createdAtIso);

  const hasContract = Boolean(
    contractPlan ||
      contractSla ||
      contractRenewalDate ||
      monthlySpend ||
      contractReference ||
      contractTerm ||
      contractNotes,
  );

  return {
    ...company,
    logoUrl,
    organizationId: raw.organizationId || raw.organization_id || null,
    tier: raw.tier != null && String(raw.tier).trim() !== '' ? String(raw.tier) : contractPlan,
    healthScore: null,
    healthStatus: null,
    openTicketsCount,
    slaRisksCount,
    accountOwner: raw.accountOwner != null ? String(raw.accountOwner) : '',
    accountOwnerId: raw.accountOwnerId != null ? String(raw.accountOwnerId) : '',
    contractPlan,
    contractSla,
    contractRenewalDate,
    contractStatus,
    contractReference,
    contractTerm,
    contractNotes,
    monthlySpend,
    hasContract,
    usersCount: null,
    assetsCount: null,
    vaultEntriesCount: null,
    slaPerformance: '',
    customerSince: customerSinceRaw,
    createdAtIso,
  };
}

/** Build activity events from real tickets / vault items / company metadata. */
export function buildCompanyActivityEvents(params: {
  company: HydratedCompany;
  tickets: Ticket[];
  vaultItems?: Array<{ id: string; createdAt?: unknown; metadata?: Record<string, unknown> }>;
}): Array<{ time: string; title: string; desc: string; color: string; sort: number }> {
  const events: Array<{ time: string; title: string; desc: string; color: string; sort: number }> =
    [];

  for (const ticket of params.tickets.slice(0, 40)) {
    const created = (ticket as any).createdAt?.toDate
      ? (ticket as any).createdAt.toDate()
      : ticket.createdAt
        ? new Date(ticket.createdAt as any)
        : null;
    const sort = created && !Number.isNaN(created.getTime()) ? created.getTime() : 0;
    events.push({
      sort,
      time: formatDateTimeDe(created) || '—',
      title: `Ticket #${ticket.id} erstellt`,
      desc: `${ticket.subject || 'Ohne Betreff'}${
        ticket.customerName ? ` — von ${ticket.customerName}` : ''
      }`,
      color: 'bg-primary',
    });
  }

  for (const item of params.vaultItems || []) {
    const created = (item as any).createdAt?.toDate
      ? (item as any).createdAt.toDate()
      : item.createdAt
        ? new Date(item.createdAt as any)
        : null;
    const sort = created && !Number.isNaN(created.getTime()) ? created.getTime() : 0;
    const label =
      item.metadata?.requestName ||
      item.metadata?.secretType ||
      'Tresor-Eintrag';
    events.push({
      sort,
      time: formatDateTimeDe(created) || '—',
      title: 'Tresor-Eintrag registriert',
      desc: String(label),
      color: 'bg-amber-500',
    });
  }

  if (params.company.createdAtIso) {
    const d = new Date(params.company.createdAtIso);
    if (!Number.isNaN(d.getTime())) {
      events.push({
        sort: d.getTime(),
        time: formatDateTimeDe(d),
        title: 'Unternehmen angelegt',
        desc: `${params.company.name} wurde im System erfasst.`,
        color: 'bg-emerald-500',
      });
    }
  }

  return events.sort((a, b) => b.sort - a.sort);
}

/** Derive simple AI insight rows from real tickets only (no mock copy). */
export function deriveTicketInsights(tickets: Ticket[]): {
  topCategory: string | null;
  openCount: number;
  automationHint: string | null;
} {
  if (!tickets.length) {
    return { topCategory: null, openCount: 0, automationHint: null };
  }
  const buckets = new Map<string, number>();
  for (const t of tickets) {
    const cat =
      String((t as any).category || (t as any).type || '').trim() ||
      guessCategoryFromSubject(String(t.subject || ''));
    buckets.set(cat, (buckets.get(cat) || 0) + 1);
  }
  let topCategory: string | null = null;
  let topCount = 0;
  for (const [k, v] of buckets) {
    if (v > topCount) {
      topCategory = k;
      topCount = v;
    }
  }
  const openCount = tickets.filter(
    (t) => t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'trash',
  ).length;
  const automationHint =
    topCount >= 3 && topCategory
      ? `${topCount} Tickets in „${topCategory}“ — Automatisierung prüfen.`
      : null;
  return { topCategory, openCount, automationHint };
}

function guessCategoryFromSubject(subject: string): string {
  const s = subject.toLowerCase();
  if (/auth|login|sso|mfa|passwort|password/.test(s)) return 'Authentifizierung';
  if (/vpn|netz|network|wifi/.test(s)) return 'Netzwerk';
  if (/mail|outlook|exchange/.test(s)) return 'E-Mail';
  if (/druck|print/.test(s)) return 'Drucker';
  return 'Allgemein';
}
