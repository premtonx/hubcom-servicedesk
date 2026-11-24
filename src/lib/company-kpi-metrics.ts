/**
 * Company-scoped KPI helpers — never invent demo counts or cross-tenant aggregates.
 */

import type { Ticket } from '../types';

export type CompanyKpiMetrics = {
  contactsCount: number;
  openTicketsCount: number;
  slaRisksCount: number;
  /** Only when a real vault/asset inventory exists for this company. */
  assetsCount: number | null;
  vaultEntriesCount: number | null;
  /** Only when a documented SLA compliance series exists for this company. */
  slaPerformance: string | null;
  monthlySpend: string | null;
  healthScore: number | null;
};

export function computeCompanyTicketMetrics(ticketHistory: Ticket[]): {
  openTicketsCount: number;
  slaRisksCount: number;
} {
  const openTicketsCount = ticketHistory.filter(
    (t) => t.status !== 'resolved' && t.status !== 'closed' && t.status !== 'trash',
  ).length;
  const slaRisksCount = ticketHistory.filter(
    (t) => t.priority === 'urgent' && t.status !== 'resolved' && t.status !== 'closed',
  ).length;
  return { openTicketsCount, slaRisksCount };
}

/**
 * Build display KPIs from live company-scoped lists.
 * Stored fixture fields on the company document are ignored.
 */
export function buildCompanyKpiMetrics(params: {
  contactsCount: number;
  ticketHistory: Ticket[];
  assetsCount?: number | null;
  vaultEntriesCount?: number | null;
  slaPerformance?: string | null;
  monthlySpend?: string | null;
}): CompanyKpiMetrics {
  const tickets = computeCompanyTicketMetrics(params.ticketHistory);
  return {
    contactsCount: Math.max(0, Number(params.contactsCount) || 0),
    openTicketsCount: tickets.openTicketsCount,
    slaRisksCount: tickets.slaRisksCount,
    assetsCount:
      params.assetsCount === undefined || params.assetsCount === null
        ? 0
        : Number(params.assetsCount) || 0,
    vaultEntriesCount:
      params.vaultEntriesCount === undefined || params.vaultEntriesCount === null
        ? 0
        : Number(params.vaultEntriesCount) || 0,
    // No fabricated SLA % or spend — only show when caller supplies a real series.
    slaPerformance: params.slaPerformance?.trim() ? params.slaPerformance.trim() : null,
    monthlySpend: params.monthlySpend?.trim() ? params.monthlySpend.trim() : null,
    healthScore: null,
  };
}

/** Fixture strings that must never appear as live company KPI values. */
export const FORBIDDEN_COMPANY_KPI_FIXTURES = [
  '142',
  '87',
  '23',
  '99.8%',
  '€4,520',
  '↑ 8 this month',
  '↑ 5 this month',
  '↑ 3 expiring soon',
  '↑ 1.2% vs last 30d',
  '↑ 12% vs last month',
] as const;
