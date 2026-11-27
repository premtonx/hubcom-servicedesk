/**
 * Outlook-style left ticket rail shown alongside ticket detail (/tickets/:id)
 * when workspace mode is `outlook`.
 */

import { useMemo, useState } from 'react';
import { Building2, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { cn, safeString } from '../../lib/utils';
import { Button } from '../ui/button';
import { useTranslation } from '../../lib/context/I18nContext';
import type { Ticket as TicketType } from '../../types';
import {
  type TicketQueueStats,
  type TopStatusFilterId,
  filterTicketsByTopStatus,
} from '../../lib/ticketViewFilters';
import { isResolvedQueueTicket } from '../../lib/ticket-status-groups';
import { CustomerOrgAvatar, resolveTicketOrgLogo } from './CustomerOrgAvatar';
import { resolveStatusConfig, softTintStyles } from '../../lib/ticket-config/display';
import { useTicketStatuses } from '../../hooks/useTicketStatuses';
import { htmlToAuditPlainText } from '../../lib/email-html-prepare';
import {
  OUTLOOK_ANSICHT_OPTIONS,
  resolveTicketViewDisplayLabel,
} from '../../lib/tickets/ticket-view-label';
import { UNASSIGNED_ORG_FILTER_ID } from '../../lib/tickets/ticket-workspace-mode';
import { TicketsWorkspaceModeToggle } from './TicketsWorkspaceModeToggle';
import type { TicketWorkspaceMode } from '../../lib/tickets/ticket-workspace-mode';
import type { KundenSidebarOrg } from './TicketsLeftSidebar';

export { OUTLOOK_ANSICHT_OPTIONS };

type RailFilterId = TopStatusFilterId | 'resolved';

export type TicketsDetailRailViewOption = {
  id: string;
  label: string;
  active?: boolean;
};

function relativeTime(value: unknown): string {
  try {
    const date =
      value && typeof (value as any).toDate === 'function'
        ? (value as any).toDate()
        : value
          ? new Date(value as any)
          : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'gerade eben';
    if (mins < 60) return `vor ${mins} Min.`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `vor ${days} T.`;
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

/** Plain-text preview for the rail — decode entities (&nbsp; → space) and collapse whitespace. */
export function snippetFromTicket(ticket: TicketType): string {
  const raw = String(ticket.description || ticket.aiSummary || '');
  const cleaned = htmlToAuditPlainText(raw).replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned.slice(0, 72) + (cleaned.length > 72 ? '…' : '');
  return safeString(ticket.customerName, '');
}

export type TicketsDetailRailProps = {
  tickets: TicketType[];
  selectedTicketId: string;
  onSelectTicket: (id: string) => void;
  onRefresh?: () => void;
  ticketQueueStats: TicketQueueStats;
  /** Active Ansicht (queue view) id — never a raw key in the UI. */
  activeViewId?: string;
  onSelectAnsicht?: (viewId: string) => void;
  /** Unternehmen filter (organizationId or UNASSIGNED_ORG_FILTER_ID). */
  selectedOrganizationId?: string | null;
  onSelectOrganization?: (organizationId: string | null) => void;
  kundenOrgs?: KundenSidebarOrg[];
  workspaceMode?: TicketWorkspaceMode;
  onWorkspaceModeChange?: (mode: TicketWorkspaceMode) => void;
  organizationNameById?: Record<string, string>;
  organizationLogoById?: Record<string, string | null>;
};

const FILTER_PILLS: Array<{ id: RailFilterId; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'open', label: 'Offen' },
  { id: 'pending', label: 'In Bearbeitung' },
  { id: 'onhold', label: 'Wartend' },
  { id: 'urgent', label: 'Dringend' },
  { id: 'resolved', label: 'Gelöst' },
];

export function TicketsDetailRail({
  tickets,
  selectedTicketId,
  onSelectTicket,
  onRefresh,
  ticketQueueStats,
  activeViewId = 'team_all_open',
  onSelectAnsicht,
  selectedOrganizationId = null,
  onSelectOrganization,
  kundenOrgs = [],
  workspaceMode = 'outlook',
  onWorkspaceModeChange,
  organizationNameById = {},
  organizationLogoById = {},
}: TicketsDetailRailProps) {
  const { t } = useTranslation();
  const { statuses } = useTicketStatuses();
  const [ansichtOpen, setAnsichtOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [companyQuery, setCompanyQuery] = useState('');
  const [railSearch, setRailSearch] = useState('');
  const [railFilter, setRailFilter] = useState<RailFilterId>('all');

  const ansichtLabel = resolveTicketViewDisplayLabel({
    viewId: activeViewId,
    t,
  });

  const companyLabel = useMemo(() => {
    if (!selectedOrganizationId) {
      return t('tickets.rail.allCompanies', 'Alle Unternehmen');
    }
    if (selectedOrganizationId === UNASSIGNED_ORG_FILTER_ID) {
      return t('tickets.rail.privateNoCompany', 'Privat / Ohne Unternehmen');
    }
    return (
      organizationNameById[selectedOrganizationId] ||
      kundenOrgs.find((o) => o.id === selectedOrganizationId)?.name ||
      t('tickets.rail.allCompanies', 'Alle Unternehmen')
    );
  }, [selectedOrganizationId, organizationNameById, kundenOrgs, t]);

  const filteredCompanies = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return kundenOrgs;
    return kundenOrgs.filter((o) => o.name.toLowerCase().includes(q));
  }, [kundenOrgs, companyQuery]);

  const resolvedCount = useMemo(
    () => tickets.filter(isResolvedQueueTicket).length,
    [tickets],
  );

  const filtered = useMemo(() => {
    let pool =
      railFilter === 'resolved'
        ? tickets.filter(isResolvedQueueTicket)
        : filterTicketsByTopStatus(tickets, railFilter);
    const q = railSearch.trim().toLowerCase();
    if (q) {
      pool = pool.filter((ticket) => {
        const subject = String(ticket.subject || '').toLowerCase();
        const number = String(
          (ticket as any).ticketNumber || (ticket as any).number || ticket.id || '',
        ).toLowerCase();
        const requester = String(
          ticket.customerName || ticket.customerEmail || (ticket as any).requesterEmail || '',
        ).toLowerCase();
        return subject.includes(q) || number.includes(q) || requester.includes(q);
      });
    }
    return pool;
  }, [tickets, railFilter, railSearch]);

  const resolveCompany = (ticket: TicketType) => {
    const orgId = String(ticket.organizationId || (ticket as any).organization_id || '').trim();
    if (orgId && organizationNameById[orgId]) return organizationNameById[orgId];
    return safeString(ticket.company, t('tickets.privateCustomer', 'Privat'));
  };

  const pillCount = (id: RailFilterId): number => {
    if (id === 'resolved') return resolvedCount;
    if (id === 'all') return ticketQueueStats.all;
    if (id === 'open') return ticketQueueStats.open;
    if (id === 'pending') return ticketQueueStats.pending;
    if (id === 'onhold') return ticketQueueStats.onhold;
    if (id === 'urgent') return ticketQueueStats.urgent;
    return 0;
  };

  return (
    <aside className="hidden md:flex w-[min(340px,34vw)] min-w-[300px] max-w-[360px] shrink-0 border-r border-slate-200 bg-white flex-col min-h-0 h-full">
      <div className="sticky top-0 z-20 shrink-0 px-3 pt-3 pb-2 border-b border-slate-100 space-y-2 bg-white">
        {/* Top bar: Ansicht + refresh + mode */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-800 flex items-center justify-between gap-1 min-w-0"
              onClick={() => {
                setAnsichtOpen((o) => !o);
                setCompanyOpen(false);
              }}
              aria-expanded={ansichtOpen}
            >
              <span className="truncate">
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mr-1.5">
                  {t('tickets.rail.ansicht', 'Ansicht')}
                </span>
                {ansichtLabel}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
            {ansichtOpen ? (
              <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-slate-200 bg-white shadow-lg p-1 max-h-64 overflow-y-auto">
                {OUTLOOK_ANSICHT_OPTIONS.map((opt) => {
                  const label = resolveTicketViewDisplayLabel({ viewId: opt.id, t });
                  const active = activeViewId === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50 truncate',
                        active && 'bg-sky-50 text-sky-900',
                      )}
                      onClick={() => {
                        setAnsichtOpen(false);
                        if (!active) onSelectAnsicht?.(opt.id);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            title={t('tickets.rail.refresh', 'Aktualisieren')}
            onClick={onRefresh}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {onWorkspaceModeChange ? (
            <TicketsWorkspaceModeToggle
              value={workspaceMode}
              onChange={onWorkspaceModeChange}
              compact
            />
          ) : null}
        </div>

        {/* Unternehmen selector */}
        <div className="relative min-w-0">
          <button
            type="button"
            className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-left text-xs font-semibold text-slate-800 flex items-center justify-between gap-1.5 min-w-0"
            onClick={() => {
              setCompanyOpen((o) => !o);
              setAnsichtOpen(false);
            }}
            aria-expanded={companyOpen}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mr-1.5">
                  {t('tickets.rail.company', 'Unternehmen')}
                </span>
                {companyLabel}
              </span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>
          {companyOpen ? (
            <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-lg border border-slate-200 bg-white shadow-lg p-2 space-y-1.5 max-h-72 overflow-hidden flex flex-col">
              <div className="relative shrink-0">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder={t('tickets.rail.companySearch', 'Unternehmen suchen…')}
                  className="w-full h-8 pl-8 pr-2 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                  autoFocus
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5">
                <button
                  type="button"
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50',
                    !selectedOrganizationId && 'bg-sky-50 text-sky-900',
                  )}
                  onClick={() => {
                    setCompanyOpen(false);
                    setCompanyQuery('');
                    onSelectOrganization?.(null);
                  }}
                >
                  {t('tickets.rail.allCompanies', 'Alle Unternehmen')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50',
                    selectedOrganizationId === UNASSIGNED_ORG_FILTER_ID && 'bg-sky-50 text-sky-900',
                  )}
                  onClick={() => {
                    setCompanyOpen(false);
                    setCompanyQuery('');
                    onSelectOrganization?.(UNASSIGNED_ORG_FILTER_ID);
                  }}
                >
                  {t('tickets.rail.privateNoCompany', 'Privat / Ohne Unternehmen')}
                </button>
                {filteredCompanies.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    className={cn(
                      'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50 flex items-center gap-2 min-w-0',
                      selectedOrganizationId === org.id && 'bg-sky-50 text-sky-900',
                    )}
                    onClick={() => {
                      setCompanyOpen(false);
                      setCompanyQuery('');
                      onSelectOrganization?.(org.id);
                    }}
                  >
                    <CustomerOrgAvatar
                      logoUrl={org.logo_url || organizationLogoById[org.id] || null}
                      companyName={org.name}
                      size="sm"
                    />
                    <span className="truncate flex-1 min-w-0">{org.name}</span>
                    {typeof org.openCount === 'number' ? (
                      <span className="tabular-nums text-[10px] text-slate-400 shrink-0">
                        {org.openCount}
                      </span>
                    ) : null}
                  </button>
                ))}
                {filteredCompanies.length === 0 ? (
                  <p className="px-2.5 py-2 text-[11px] text-slate-400 italic">
                    {t('tickets.rail.noCompanies', 'Keine Unternehmen gefunden.')}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Search */}
        <div className="relative min-w-0">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={railSearch}
            onChange={(e) => setRailSearch(e.target.value)}
            placeholder={t('tickets.rail.search', 'Tickets durchsuchen…')}
            className="w-full h-8 pl-8 pr-2 rounded-lg border border-slate-200 bg-slate-50/80 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 focus:bg-white"
          />
        </div>

        {/* Status chips — wrap so nothing clips */}
        <div className="flex flex-wrap gap-1.5">
          {FILTER_PILLS.map((pill) => {
            const active = railFilter === pill.id;
            const count = pillCount(pill.id);
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setRailFilter(pill.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border transition-colors',
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                {pill.label}
                <span className={cn('tabular-nums', active ? 'text-white/80' : 'text-slate-400')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-slate-400 font-medium">
            {t('tickets.rail.empty', 'Keine Tickets in dieser Ansicht.')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((ticket) => {
              const active = ticket.id === selectedTicketId;
              const company = resolveCompany(ticket);
              const logo = resolveTicketOrgLogo(ticket, organizationLogoById);
              const status = resolveStatusConfig(ticket.status, statuses);
              const tint = softTintStyles(status.color);
              const when = relativeTime(ticket.updatedAt || ticket.createdAt);
              return (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => onSelectTicket(ticket.id)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors min-w-0',
                      active
                        ? 'bg-sky-50 border-l-2 border-sky-500'
                        : 'hover:bg-slate-50 border-l-2 border-transparent',
                    )}
                  >
                    <CustomerOrgAvatar
                      logoUrl={logo}
                      companyName={company}
                      contactName={ticket.customerName}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] font-bold text-slate-900 truncate leading-snug">
                          {safeString(ticket.subject, '—')}
                        </p>
                        <span className="text-[9px] text-slate-400 font-medium shrink-0 tabular-nums">
                          {when}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 truncate">
                        {snippetFromTicket(ticket) || safeString(ticket.customerName)}
                      </p>
                      <div className="flex items-center justify-between gap-2 pt-0.5 min-w-0">
                        <span className="text-[10px] font-semibold text-slate-600 truncate">
                          {company}
                        </span>
                        <span
                          className="inline-flex h-4 items-center px-1.5 rounded-full text-[9px] font-bold border shrink-0"
                          style={tint}
                        >
                          {status.name}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
