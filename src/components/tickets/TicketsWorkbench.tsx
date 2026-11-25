/**
 * Shared Tickets workbench — Liste | Kanban | Karten.
 * Presentational shell only: all I/O via TicketsWorkbenchAdapter.
 * Staff keeps TicketsLeftSidebar + detail/returns outside; portal owns PortalTicketsSidebar here.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { TicketListView, type TicketListViewProps } from './TicketListView';
import {
  PortalTicketsSidebar,
  type PortalQueueViewId,
} from '../pages/client-portal/PortalTicketsSidebar';
import {
  PORTAL_TICKETS_CAPABILITIES,
  STAFF_TICKETS_CAPABILITIES,
  type TicketsWorkbenchAdapter,
  type TicketsWorkbenchCapabilities,
  type TicketsWorkbenchMode,
} from '../../lib/tickets/tickets-workbench-adapter';
import type { Ticket as TicketType, TicketPriority, TicketStatus } from '../../types';
import type { TicketsLayoutMode } from './TicketsViewModeSelector';
import type { TopStatusFilterId, TicketQueueStats } from '../../lib/ticketViewFilters';
import { computeTicketQueueStats } from '../../lib/ticketViewFilters';
import {
  ticketMatchesPortalStatusFilter,
  toPortalStatusGroup,
} from '../../lib/portal/status';
import { useClientPortalSession } from '../../hooks/useClientPortalSession';

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const EMPTY_FILTERS: Record<string, any> = {
  agent: 'any',
  priority: 'any',
  category: 'any',
  company: 'any',
  source: 'any',
  tags: 'any',
  contacts: 'any',
  sentiment: 'any',
  teamCategories: 'any',
  slaDue: 'any',
};

function computePortalQueueStats(pool: TicketType[]): TicketQueueStats {
  const active = pool.filter((t) => {
    const s = String(t.status || '').toLowerCase();
    return s !== 'trash' && s !== 'spam' && s !== 'merged';
  });
  let open = 0;
  let pending = 0;
  let onhold = 0;
  let urgent = 0;
  let unassigned = 0;
  for (const t of active) {
    const group = toPortalStatusGroup(t.status);
    if (group === 'open') open += 1;
    else if (group === 'in_progress') pending += 1;
    else if (group === 'waiting') onhold += 1;
    const p = String(t.priority || '').toLowerCase();
    if (p === 'urgent' || p === 'high' || p === 'critical') urgent += 1;
    if (!t.agentId && !t.assigneeId && !t.assignedTo && !t.agentName) unassigned += 1;
  }
  return {
    all: active.length,
    open,
    pending,
    onhold,
    urgent,
    unassigned,
    critical: urgent,
    slaRisk: 0,
    bugs: 0,
  };
}

function filterByPortalTopStatus(
  tickets: TicketType[],
  filterId: TopStatusFilterId,
): TicketType[] {
  switch (filterId) {
    case 'open':
      return tickets.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'open'));
    case 'pending':
      return tickets.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'in_progress'));
    case 'onhold':
      return tickets.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'waiting'));
    case 'urgent':
      return tickets.filter((t) => {
        const p = String(t.priority || '').toLowerCase();
        return p === 'urgent' || p === 'high' || p === 'critical';
      });
    case 'unassigned':
      return tickets.filter((t) => !t.agentId && !t.assigneeId && !t.assignedTo && !t.agentName);
    case 'all':
    default:
      return tickets;
  }
}

export type StaffTicketsWorkbenchListProps = Omit<
  TicketListViewProps,
  'mode' | 'capabilities'
>;

export interface TicketsWorkbenchProps {
  mode: TicketsWorkbenchMode;
  adapter: TicketsWorkbenchAdapter;
  capabilities?: TicketsWorkbenchCapabilities;
  /** Staff list shell — parent owns sidebar, detail, returns, and data. */
  staffListProps?: StaffTicketsWorkbenchListProps;
}

function PortalTicketsWorkbench({
  adapter,
  capabilities,
}: {
  adapter: TicketsWorkbenchAdapter;
  capabilities: TicketsWorkbenchCapabilities;
}) {
  const { session, isOrgWide, loading: sessionLoading } = useClientPortalSession();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tickets, setTickets] = useState<TicketType[]>([]);
  const [serverCounts, setServerCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [statusQueuesOpen, setStatusQueuesOpen] = useState(true);
  const [layoutMode, setLayoutMode] = useState<TicketsLayoutMode>('list');
  const [listSort, setListSort] = useState<'newest' | 'oldest' | 'priority'>('newest');
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, any>>({ ...EMPTY_FILTERS });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [topStatusFilter, setTopStatusFilter] = useState<TopStatusFilterId>('all');
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [drawerTicketId, setDrawerTicketId] = useState<string | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

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
        const listScope: 'mine' | 'all' =
          !isOrgWide || activeView === 'mine' ? 'mine' : 'all';
        const result = await adapter.listTickets({ scope: listScope });
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
  }, [adapter, session?.id, isOrgWide, activeView]);

  const sidebarCounts = useMemo(() => {
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
      in_progress:
        Number(serverCounts.companyInProgress ?? derived.in_progress) || derived.in_progress,
      waiting: Number(serverCounts.companyWaiting ?? derived.waiting) || derived.waiting,
      resolved: Number(serverCounts.companyResolved ?? derived.resolved) || derived.resolved,
    };
  }, [tickets, serverCounts]);

  const scopeTickets = useMemo(() => {
    let rows = [...tickets];
    if (activeView === 'open') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'open'));
    } else if (activeView === 'in_progress') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'in_progress'));
    } else if (activeView === 'waiting') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'waiting'));
    } else if (activeView === 'resolved') {
      rows = rows.filter((t) => ticketMatchesPortalStatusFilter(t.status, 'resolved'));
    }
    return rows;
  }, [tickets, activeView]);

  const ticketQueueStats = useMemo(
    () => computePortalQueueStats(scopeTickets),
    [scopeTickets],
  );

  const filteredTickets = useMemo(() => {
    let rows = filterByPortalTopStatus(scopeTickets, topStatusFilter);

    if (filters.priority && filters.priority !== 'any') {
      rows = rows.filter(
        (t) => String(t.priority || 'medium').toLowerCase() === String(filters.priority).toLowerCase(),
      );
    }

    const q = searchQuery.trim().toLowerCase();
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
      if (listSort === 'priority') {
        const pa = PRIORITY_RANK[String(a.priority || 'medium').toLowerCase()] ?? 9;
        const pb = PRIORITY_RANK[String(b.priority || 'medium').toLowerCase()] ?? 9;
        if (pa !== pb) return pa - pb;
      }
      const ta = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
      const tb = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
      return listSort === 'oldest' ? ta - tb : tb - ta;
    });

    return rows;
  }, [scopeTickets, topStatusFilter, filters.priority, searchQuery, listSort]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeView, topStatusFilter, searchQuery, listSort, filters.priority, pageSize]);

  const handleViewChange = (view: PortalQueueViewId) => {
    setActiveView(view);
    setTopStatusFilter('all');
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

  const handleInlineUpdate = useCallback(
    async (id: string, data: Partial<TicketType>) => {
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...data } : t)));
      try {
        if (adapter.updateTicketFields) {
          await adapter.updateTicketFields(id, data);
          return;
        }
        if (data.status != null && adapter.updateTicketStatus) {
          await adapter.updateTicketStatus(id, data.status as TicketStatus);
        }
        if (data.priority != null && adapter.updateTicketPriority) {
          await adapter.updateTicketPriority(id, data.priority as TicketPriority);
        }
      } catch {
        /* list refreshes on next load */
      }
    },
    [adapter],
  );

  const noopPresence = useMemo(
    () => ({ setPresence: (_id: string, _present: boolean) => undefined }),
    [],
  );

  if (sessionLoading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full h-full overflow-hidden bg-slate-50">
      <PortalTicketsSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        isOrgWide={isOrgWide}
        activeView={activeView}
        onViewChange={handleViewChange}
        counts={sidebarCounts}
        statusQueuesOpen={statusQueuesOpen}
        onToggleStatusQueues={() => setStatusQueuesOpen((v) => !v)}
      />

      <div className="flex-1 min-w-0 min-h-0 h-full flex flex-col overflow-hidden bg-white">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
            Tickets werden geladen…
          </div>
        ) : (
          <TicketListView
            mode="portal"
            capabilities={capabilities}
            ticketQueueStats={ticketQueueStats}
            topStatusFilter={topStatusFilter}
            setTopStatusFilter={setTopStatusFilter}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isFilterDrawerOpen={isFilterDrawerOpen}
            setIsFilterDrawerOpen={setIsFilterDrawerOpen}
            listSort={listSort}
            setListSort={setListSort}
            layoutMode={layoutMode}
            setLayoutMode={setLayoutMode}
            openCreateTicket={() => adapter.openCreateTicket()}
            tickets={filteredTickets}
            filters={filters}
            setFilters={setFilters}
            user={
              session
                ? {
                    uid: session.id,
                    displayName: session.name || session.email,
                    email: session.email,
                  }
                : null
            }
            handleViewChange={(view) => {
              if (
                view === 'company_all' ||
                view === 'mine' ||
                view === 'open' ||
                view === 'in_progress' ||
                view === 'waiting' ||
                view === 'resolved'
              ) {
                handleViewChange(view);
              }
            }}
            selectedTicketIds={selectedTicketIds}
            setSelectedTicketIds={setSelectedTicketIds}
            toggleSelectAll={() => undefined}
            toggleTicketSelection={() => undefined}
            headerCheckboxActive={false}
            handleInlineUpdate={handleInlineUpdate}
            handleTicketSelect={(id) => adapter.openTicket(id)}
            handleBulkUpdate={async () => undefined}
            viewDensity="comfortable"
            setHoveredTicketId={() => undefined}
            mousePosRef={mousePosRef}
            setPeekOffset={() => undefined}
            handleMouseMove={(_e: MouseEvent) => undefined}
            setIsMobileSidebarOpen={() => undefined}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            pageSize={pageSize}
            setPageSize={setPageSize}
            drawerTicketId={drawerTicketId}
            setDrawerTicketId={setDrawerTicketId}
            allTickets={tickets}
            kbArticles={[]}
            openFullTicketView={(id) => adapter.openTicket(id)}
            ticketService={noopPresence}
          />
        )}
      </div>
    </div>
  );
}

export function TicketsWorkbench({
  mode,
  adapter,
  capabilities: capabilitiesProp,
  staffListProps,
}: TicketsWorkbenchProps) {
  const capabilities =
    capabilitiesProp ??
    (mode === 'portal' ? PORTAL_TICKETS_CAPABILITIES : STAFF_TICKETS_CAPABILITIES);

  if (mode === 'portal') {
    return <PortalTicketsWorkbench adapter={adapter} capabilities={capabilities} />;
  }

  if (!staffListProps) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
        Staff TicketsWorkbench requires staffListProps.
      </div>
    );
  }

  // Staff: parent owns data + detail/returns; adapter is wired in staffListProps
  // (openTicket / openCreate / mutations). Workbench is presentation-only.
  void adapter;
  return (
    <TicketListView
      {...staffListProps}
      mode="staff"
      capabilities={capabilities}
    />
  );
}

/** Re-export for callers that want staff stats helper without importing filters directly. */
export { computeTicketQueueStats };
