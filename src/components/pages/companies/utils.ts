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
  usersCount: number | null;
  assetsCount: number | null;
  vaultEntriesCount: number | null;
  slaPerformance: string;
  monthlySpend: string;
  customerSince: string;
  /** Normalized logo for header/list (CRM logoUrl or org logo_url). */
  logoUrl: string;
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

  return {
    ...company,
    logoUrl,
    tier: raw.tier != null && String(raw.tier).trim() !== '' ? String(raw.tier) : '',
    // Never surface stored demo KPI fields — live metrics come from CompanyKPI props.
    healthScore: null,
    healthStatus: null,
    openTicketsCount,
    slaRisksCount,
    accountOwner: raw.accountOwner != null ? String(raw.accountOwner) : '',
    accountOwnerId: raw.accountOwnerId != null ? String(raw.accountOwnerId) : '',
    contractPlan: raw.contractPlan != null ? String(raw.contractPlan) : '',
    contractSla: raw.contractSla != null ? String(raw.contractSla) : '',
    contractRenewalDate: raw.contractRenewalDate != null ? String(raw.contractRenewalDate) : '',
    contractStatus,
    usersCount: null,
    assetsCount: null,
    vaultEntriesCount: null,
    slaPerformance: '',
    monthlySpend: '',
    customerSince: raw.customerSince != null ? String(raw.customerSince) : '',
  };
}
