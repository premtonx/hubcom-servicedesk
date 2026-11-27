/**
 * Outlook-style left ticket rail shown alongside ticket detail (/tickets/:id).
 */

import { useMemo, useState } from 'react';
import { ChevronDown, Menu, RefreshCw } from 'lucide-react';
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

type RailFilterId = TopStatusFilterId | 'resolved'; // includes Gelöst beyond list top filters

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
  onToggleQueueMenu?: () => void;
  ticketQueueStats: TicketQueueStats;
  activeViewLabel?: string;
  viewOptions?: TicketsDetailRailViewOption[];
  onSelectViewOption?: (optionId: string) => void;
  organizationNameById?: Record<string, string>;
  organizationLogoById?: Record<string, string | null>;
};

const FILTER_PILLS: Array<{ id: RailFilterId; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'open', label: 'Offen' },
  { id: 'pending', label: 'In Bearbeitung' },
  { id: 'onhold', label: 'Wartend' },
  { id: 'resolved', label: 'Gelöst' },
];

export function TicketsDetailRail({
  tickets,
  selectedTicketId,
  onSelectTicket,
  onRefresh,
  onToggleQueueMenu,
  ticketQueueStats,
  activeViewLabel = 'Alle Tickets',
  viewOptions = [],
  onSelectViewOption,
  organizationNameById = {},
  organizationLogoById = {},
}: TicketsDetailRailProps) {
  const { t } = useTranslation();
  const { statuses } = useTicketStatuses();
  const [viewOpen, setViewOpen] = useState(false);
  const [railFilter, setRailFilter] = useState<RailFilterId>('all');

  const resolvedCount = useMemo(
    () => tickets.filter(isResolvedQueueTicket).length,
    [tickets],
  );

  const filtered = useMemo(() => {
    if (railFilter === 'resolved') return tickets.filter(isResolvedQueueTicket);
    return filterTicketsByTopStatus(tickets, railFilter);
  }, [tickets, railFilter]);

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
    return 0;
  };

  const options =
    viewOptions.length > 0
      ? viewOptions
      : [{ id: 'current', label: activeViewLabel, active: true }];

  return (
    <aside className="hidden md:flex w-[290px] shrink-0 border-r border-slate-200 bg-white flex-col min-h-0 h-full min-w-0">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-slate-100 space-y-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {onToggleQueueMenu ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              title={t('tickets.rail.toggleQueue', 'Seitenleiste ein-/ausklappen')}
              onClick={onToggleQueueMenu}
            >
              <Menu className="w-3.5 h-3.5" />
            </Button>
          ) : null}
          <div className="relative flex-1 min-w-0">
            <button
              type="button"
              className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-800 flex items-center justify-between gap-1 min-w-0"
              onClick={() => setViewOpen((o) => !o)}
            >
              <span className="truncate">{activeViewLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
            {viewOpen ? (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-slate-200 bg-white shadow-lg p-1 max-h-64 overflow-y-auto">
                {options.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={cn(
                      'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-semibold hover:bg-slate-50 truncate',
                      opt.active && 'bg-sky-50 text-sky-900',
                    )}
                    onClick={() => {
                      setViewOpen(false);
                      if (opt.active) return;
                      onSelectViewOption?.(opt.id);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
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
        </div>

        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-0.5">
          {FILTER_PILLS.map((pill) => {
            const active = railFilter === pill.id;
            const count = pillCount(pill.id);
            return (
              <button
                key={pill.id}
                type="button"
                onClick={() => setRailFilter(pill.id)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border transition-colors',
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
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-[11px] font-semibold text-slate-500 truncate">
                          {company}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                          {when}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {safeString(ticket.subject, 'Ohne Betreff')}
                      </p>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-snug">
                        {snippetFromTicket(ticket)}
                      </p>
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                        style={tint}
                      >
                        {status.name}
                      </span>
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
