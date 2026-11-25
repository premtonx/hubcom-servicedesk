import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Button } from '../../ui/button';
import { cn, getInitials, safeString } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { clientPortalApi } from '../../../services/clientPortalApi';
import type { Ticket, TicketStatus } from '../../../types';
import {
  portalPriorityLabel,
  portalStatusLabel,
  ticketMatchesPortalStatusFilter,
  toPortalStatusGroup,
} from '../../../lib/portal/status';
import { formatRelativeTime } from '../../../lib/dashboard-format-utils';
import { portalPriorityBadgeClass, portalStatusBadgeClass } from '../../portal/portalUi';
import { TicketsPageHeader } from '../../tickets/TicketsPageHeader';
import { TicketsViewModeSelector, type TicketsLayoutMode } from '../../tickets/TicketsViewModeSelector';
import { TicketsKanbanBoard } from '../../tickets/TicketsKanbanBoard';
import { ModulePageTabs, ModuleToolbar, ModuleToolbarSelect } from '../../ui/module-page';
import {
  PortalTicketsSidebar,
  type PortalQueueViewId,
} from './PortalTicketsSidebar';

type SortMode = 'newest' | 'oldest' | 'priority';

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function formatTicketRef(t: Ticket): string {
  const custom = String(t.customId || '').trim();
  if (custom) return custom.startsWith('#') ? custom : `#${custom}`;
  const id = String(t.id || '');
  const upper = id.toUpperCase();
  if (upper.startsWith('TKT') || upper.startsWith('HC-')) return `#${upper}`;
  return `#TKT-${id.slice(-4).toUpperCase()}`;
}

function creatorName(t: Ticket): string {
  return (
    safeString(t.customerName) ||
    safeString(t.customerEmail) ||
    safeString((t as any).requesterName) ||
    'Kollege'
  );
}

function assigneeLabel(t: Ticket): string {
  const name = safeString(t.agentName);
  if (name) return name;
  if (t.agentId || t.assigneeId || t.assignedTo) return 'Zugewiesen';
  return 'In Prüfung';
}

function categoryLabel(t: Ticket): string {
  return safeString(t.categoryName) || safeString((t as any).category) || '—';
}

export default function ClientTicketsPage() {
  const { session, isOrgWide } = useClientPortalSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [statusQueuesOpen, setStatusQueuesOpen] = useState(true);
  const [layoutMode, setLayoutMode] = useState<TicketsLayoutMode>('list');
  const [sort, setSort] = useState<SortMode>('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const initialView = ((): PortalQueueViewId => {
    const status = searchParams.get('status');
    if (status === 'open') return 'open';
    if (status === 'in_progress' || status === 'pending') return 'in_progress';
    if (status === 'waiting' || status === 'waiting_customer') return 'waiting';
    if (status === 'resolved' || status === 'closed') return 'resolved';
    if (searchParams.get('scope') === 'mine') return 'mine';
    return isOrgWide ? 'company_all' : 'mine';
  })();
  const [activeView, setActiveView] = useState<PortalQueueViewId>(initialView);

  useEffect(() => {
    if (!isOrgWide && activeView === 'company_all') setActiveView('mine');
  }, [isOrgWide, activeView]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        // Status sidebar views load the company queue (org-wide) then filter locally.
        const listScope: 'mine' | 'all' =
          !isOrgWide || activeView === 'mine' ? 'mine' : 'all';
        const result = await clientPortalApi.listTickets({ scope: listScope });
        if (!active) return;
        setTickets(result.tickets);
        setServerCounts(result.counts || {});
      } catch {
        if (active) {
          setTickets([]);
          setServerCounts({});
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [session?.id, isOrgWide, activeView]);

  /** Tickets already match the active Alle Firmen / Meine scope from the API. */
  const scopeTickets = tickets;

  const counts = useMemo(() => {
    const derived = { open: 0, in_progress: 0, waiting: 0, resolved: 0 };
    for (const t of tickets) {
      const group = toPortalStatusGroup(t.status);
      if (group === 'open') derived.open += 1;
      else if (group === 'in_progress') derived.in_progress += 1;
      else if (group === 'waiting') derived.waiting += 1;
      else if (group === 'resolved' || group === 'closed') derived.resolved += 1;
    }
    return {
      companyAll: Number(serverCounts.companyAll ?? tickets.length) || tickets.length,
      mine: Number(serverCounts.mine ?? tickets.length) || tickets.length,
      open: Number(serverCounts.companyOpen ?? derived.open) || derived.open,
      in_progress: Number(serverCounts.companyInProgress ?? derived.in_progress) || derived.in_progress,
      waiting: Number(serverCounts.companyWaiting ?? derived.waiting) || derived.waiting,
      resolved: Number(serverCounts.companyResolved ?? derived.resolved) || derived.resolved,
    };
  }, [tickets, serverCounts]);

  const filtered = useMemo(() => {
    let rows = [...scopeTickets];

    if (activeView === 'open') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'open'));
    } else if (activeView === 'in_progress') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'in_progress'));
    } else if (activeView === 'waiting') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'waiting'));
    } else if (activeView === 'resolved') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'resolved'));
    }

    if (priorityFilter !== 'all') {
      rows = rows.filter(
        (t) => String(t.priority || 'medium').toLowerCase() === priorityFilter,
      );
    }

    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((t) => {
        const hay = [
          t.subject,
          t.customId,
          t.id,
          t.customerName,
          t.customerEmail,
          t.categoryName,
          t.agentName,
        ]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        return hay.includes(q);
      });
    }

    rows.sort((a, b) => {
      if (sort === 'priority') {
        const pa = PRIORITY_RANK[String(a.priority || 'medium').toLowerCase()] ?? 9;
        const pb = PRIORITY_RANK[String(b.priority || 'medium').toLowerCase()] ?? 9;
        if (pa !== pb) return pa - pb;
      }
      const ta = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
      const tb = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
      return sort === 'oldest' ? ta - tb : tb - ta;
    });

    return rows;
  }, [scopeTickets, activeView, priorityFilter, search, sort]);

  const tabCounts = useMemo(() => {
    const source = scopeTickets;
    const base = {
      all: source.length,
      open: 0,
      in_progress: 0,
      waiting: 0,
      urgent: 0,
    };
    for (const t of source) {
      const group = toPortalStatusGroup(t.status);
      if (group === 'open') base.open += 1;
      else if (group === 'in_progress') base.in_progress += 1;
      else if (group === 'waiting') base.waiting += 1;
      const p = String(t.priority || '').toLowerCase();
      if (p === 'urgent' || p === 'high' || p === 'critical') base.urgent += 1;
    }
    return base;
  }, [scopeTickets]);

  const [topTab, setTopTab] = useState<string>('all');

  const tableRows = useMemo(() => {
    if (topTab === 'all') return filtered;
    if (topTab === 'urgent') {
      return filtered.filter((t) => {
        const p = String(t.priority || '').toLowerCase();
        return p === 'urgent' || p === 'high' || p === 'critical';
      });
    }
    return filtered.filter((t) => ticketMatchesPortalStatusFilter(t.status, topTab));
  }, [filtered, topTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeView, topTab, search, sort, priorityFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const pageSlice = tableRows.slice((page - 1) * pageSize, page * pageSize);

  const handleViewChange = (view: PortalQueueViewId) => {
    setActiveView(view);
    // Sidebar defines the queue; status tabs refine within it (Alle = entire queue).
    setTopTab('all');
    const next = new URLSearchParams(searchParams);
    if (view === 'mine') next.set('scope', 'mine');
    else if (view === 'company_all') next.set('scope', 'all');
    else next.delete('scope');

    if (view === 'open' || view === 'in_progress' || view === 'waiting' || view === 'resolved') {
      next.set('status', view);
    } else {
      next.delete('status');
    }
    setSearchParams(next, { replace: true });
  };

  const openTicket = (id: string) => {
    navigate(`/portal/tickets/${id}`);
  };

  const handleKanbanStatus = async (id: string, status: TicketStatus) => {
    try {
      const updated = await clientPortalApi.updateTicketStatus(id, status);
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: updated?.status || status } : t)),
      );
    } catch {
      /* ignore — list will refresh on next load */
    }
  };

  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full h-full overflow-hidden bg-slate-50">
      <PortalTicketsSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        isOrgWide={isOrgWide}
        activeView={activeView}
        onViewChange={handleViewChange}
        counts={counts}
        statusQueuesOpen={statusQueuesOpen}
        onToggleStatusQueues={() => setStatusQueuesOpen((v) => !v)}
      />

      <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col overflow-hidden bg-white">
        <TicketsPageHeader
          stats={{ total: tableRows.length, open: tabCounts.open }}
          trailing={
            <Button
              type="button"
              className="h-9 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold"
              onClick={() => navigate('/portal/tickets/new')}
            >
              <Plus className="w-4 h-4" />
              Ticket erstellen
            </Button>
          }
        />

        <ModulePageTabs
          tabs={[
            { id: 'all', label: `Alle (${tabCounts.all})` },
            { id: 'open', label: `Offen (${tabCounts.open})` },
            { id: 'in_progress', label: `In Bearbeitung (${tabCounts.in_progress})` },
            { id: 'waiting', label: `Wartend (${tabCounts.waiting})` },
            { id: 'urgent', label: `Dringend (${tabCounts.urgent})` },
          ]}
          activeId={topTab}
          onChange={setTopTab}
        />

        <ModuleToolbar
          searchPlaceholder="Suchen..."
          searchValue={search}
          onSearchChange={setSearch}
          onFilterClick={() => setFilterOpen((v) => !v)}
          filterActive={filterOpen || priorityFilter !== 'all'}
          sortControl={
            <div className="flex items-center gap-1 shrink-0">
              <span className="hidden sm:inline text-[11px] font-medium text-slate-500">
                Sortieren
              </span>
              <ModuleToolbarSelect
                value={sort}
                onChange={(v) => setSort(v as SortMode)}
                aria-label="Sortieren"
              >
                <option value="newest">Neueste</option>
                <option value="oldest">Älteste</option>
                <option value="priority">Priorität</option>
              </ModuleToolbarSelect>
            </div>
          }
          viewsSlot={<TicketsViewModeSelector value={layoutMode} onChange={setLayoutMode} />}
        />

        {filterOpen ? (
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Priorität</span>
            {(['all', 'urgent', 'high', 'medium', 'low'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriorityFilter(p)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-bold',
                  priorityFilter === p
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600',
                )}
              >
                {p === 'all' ? 'Alle' : portalPriorityLabel(p)}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="p-16 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Tickets werden geladen…
            </div>
          ) : layoutMode === 'kanban' ? (
            <TicketsKanbanBoard
              tickets={tableRows}
              onSelect={openTicket}
              onStatusChange={handleKanbanStatus}
              onPriorityChange={() => undefined}
            />
          ) : layoutMode === 'cards' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
              {tableRows.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTicket(t.id)}
                  className="text-left rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-bold text-slate-900 line-clamp-2">{t.subject}</p>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', portalStatusBadgeClass(t.status))}>
                      {portalStatusLabel(t.status)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mb-3">{formatTicketRef(t)}</p>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{creatorName(t)}</span>
                    <span>{formatRelativeTime(t.updatedAt || t.createdAt)}</span>
                  </div>
                </button>
              ))}
              {tableRows.length === 0 ? (
                <p className="col-span-full text-center text-sm text-slate-400 py-12">
                  Keine Tickets in dieser Ansicht.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="min-w-[1100px]">
              <div className="grid grid-cols-[minmax(160px,180px)_minmax(240px,1.5fr)_minmax(120px,140px)_minmax(110px,130px)_minmax(120px,140px)_minmax(140px,160px)_minmax(110px,130px)] gap-x-3 px-4 h-9 items-center bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                {['Ersteller', 'Betreff', 'Status', 'Priorität', 'Kategorie', 'Zuständiger', 'Aktivität'].map(
                  (label) => (
                    <div
                      key={label}
                      className="font-semibold text-[10px] text-slate-500 uppercase tracking-wider"
                    >
                      {label}
                    </div>
                  ),
                )}
              </div>
              {pageSlice.length === 0 ? (
                <p className="text-center text-sm text-slate-400 py-16">
                  Keine Tickets in dieser Ansicht.
                </p>
              ) : (
                pageSlice.map((t) => {
                  const creator = creatorName(t);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => openTicket(t.id)}
                      className="w-full grid grid-cols-[minmax(160px,180px)_minmax(240px,1.5fr)_minmax(120px,140px)_minmax(110px,130px)_minmax(120px,140px)_minmax(140px,160px)_minmax(110px,130px)] gap-x-3 px-4 py-2.5 items-center border-b border-slate-100 hover:bg-slate-50/80 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {getInitials(creator)}
                        </div>
                        <span className="text-xs font-semibold text-slate-700 truncate">{creator}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{t.subject}</p>
                        <p className="text-[11px] font-mono text-slate-400">{formatTicketRef(t)}</p>
                      </div>
                      <div>
                        <span
                          className={cn(
                            'inline-flex text-[11px] font-bold px-2 py-0.5 rounded-full',
                            portalStatusBadgeClass(t.status),
                          )}
                        >
                          {portalStatusLabel(t.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full',
                            portalPriorityBadgeClass(t.priority).includes('rose') ||
                              portalPriorityBadgeClass(t.priority).includes('red')
                              ? 'bg-rose-500'
                              : portalPriorityBadgeClass(t.priority).includes('amber')
                                ? 'bg-amber-500'
                                : 'bg-slate-400',
                          )}
                        />
                        {portalPriorityLabel(t.priority)}
                      </div>
                      <div className="text-xs text-slate-600 truncate">{categoryLabel(t)}</div>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-[9px] font-bold shrink-0">
                          {getInitials(assigneeLabel(t))}
                        </div>
                        <span className="text-xs text-slate-700 truncate">{assigneeLabel(t)}</span>
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {formatRelativeTime(t.updatedAt || t.createdAt)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {layoutMode === 'list' ? (
          <div className="shrink-0 h-12 px-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Zeige {(page - 1) * pageSize + (tableRows.length ? 1 : 0)} bis{' '}
              {Math.min(page * pageSize, tableRows.length)} von {tableRows.length} Tickets
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-500 flex items-center gap-2">
                Zeilen pro Seite
                <select
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 25)}
                >
                  {[10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs font-semibold text-slate-600 tabular-nums px-2">
                  {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
