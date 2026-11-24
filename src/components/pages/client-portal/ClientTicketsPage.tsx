import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { cn, getInitials, safeString } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { clientPortalApi } from '../../../services/clientPortalApi';
import type { Ticket } from '../../../types';
import {
  PORTAL_STATUS_FILTERS,
  portalPriorityLabel,
  portalStatusLabel,
  ticketMatchesPortalStatusFilter,
  toPortalStatusGroup,
} from '../../../lib/portal/status';
import { formatRelativeTime } from '../../../lib/dashboard-format-utils';
import { portalStatusBadgeClass, portalPriorityBadgeClass } from '../../portal/portalUi';

type Scope = 'mine' | 'all';
type SortMode = 'newest' | 'oldest' | 'priority';

function ticketRequesterId(t: Ticket): string {
  return String(t.requesterId || t.requester_id || t.creatorId || '');
}

function formatTicketRef(t: Ticket): string {
  const custom = String(t.customId || '').trim();
  if (custom) return custom.startsWith('#') ? custom : `#${custom}`;
  const id = String(t.id || '');
  const upper = id.toUpperCase();
  if (upper.startsWith('TKT')) return `#${upper}`;
  return `#TKT-${id.slice(-4).toUpperCase()}`;
}

export default function ClientTicketsPage() {
  const { session, isOrgWide } = useClientPortalSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [participantTicketIds, setParticipantTicketIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<Scope>(
    () => (searchParams.get('scope') === 'all' && isOrgWide ? 'all' : 'mine'),
  );
  const [status, setStatus] = useState<string>(() => searchParams.get('status') || 'all');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [sort, setSort] = useState<SortMode>('newest');
  const [filterOpen, setFilterOpen] = useState(false);
  const [priority, setPriority] = useState<string>('all');

  // Sync URL → state (dashboard KPI deep-links).
  useEffect(() => {
    const urlStatus = searchParams.get('status');
    if (urlStatus) setStatus(urlStatus);
    const urlScope = searchParams.get('scope');
    if (urlScope === 'all' || urlScope === 'mine') setScope(urlScope);
    const urlQ = searchParams.get('q');
    if (urlQ != null) setSearch(urlQ);
  }, [searchParams]);

  useEffect(() => {
    if (!isOrgWide && scope !== 'mine') setScope('mine');
  }, [isOrgWide, scope]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const list = await clientPortalApi.listTickets();
        if (!active) return;
        setTickets(list);

        if (session && isOrgWide) {
          const mine = new Set<string>();
          await Promise.all(
            list.slice(0, 80).map(async (t) => {
              try {
                const parts = await clientPortalApi.listParticipants(t.id);
                if (parts.some((p) => p.user_id === session.id)) mine.add(t.id);
              } catch {
                /* ignore */
              }
            }),
          );
          if (active) setParticipantTicketIds(mine);
        }
      } catch {
        if (active) setTickets([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [session, isOrgWide]);

  const scopedTickets = useMemo(() => {
    if (!session) return [];
    let rows = [...tickets];
    if (!isOrgWide || scope === 'mine') {
      rows = rows.filter((t) => {
        const requester = ticketRequesterId(t);
        return requester === session.id || participantTicketIds.has(t.id);
      });
    }
    return rows;
  }, [tickets, session, isOrgWide, scope, participantTicketIds]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: scopedTickets.length,
      open: 0,
      in_progress: 0,
      waiting: 0,
      resolved: 0,
    };
    for (const t of scopedTickets) {
      const group = toPortalStatusGroup(t.status);
      if (group === 'open') counts.open += 1;
      else if (group === 'in_progress') counts.in_progress += 1;
      else if (group === 'waiting') counts.waiting += 1;
      else if (group === 'resolved' || group === 'closed') counts.resolved += 1;
    }
    return counts;
  }, [scopedTickets]);

  const filtered = useMemo(() => {
    let rows = scopedTickets.filter((t) => ticketMatchesPortalStatusFilter(t.status, status));
    if (priority !== 'all') {
      rows = rows.filter((t) => String(t.priority || '').toLowerCase() === priority);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (t) =>
          String(t.subject || '').toLowerCase().includes(q) ||
          String(t.id || '').toLowerCase().includes(q) ||
          String(t.customId || '').toLowerCase().includes(q) ||
          String(t.customerName || '').toLowerCase().includes(q),
      );
    }
    const priorityRank = (p?: string) => {
      const key = String(p || '').toLowerCase();
      if (key === 'urgent' || key === 'critical') return 4;
      if (key === 'high') return 3;
      if (key === 'medium') return 2;
      return 1;
    };
    rows.sort((a, b) => {
      if (sort === 'priority') return priorityRank(b.priority) - priorityRank(a.priority);
      const aT = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bT = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return sort === 'oldest' ? aT - bT : bT - aT;
    });
    return rows;
  }, [scopedTickets, status, priority, search, sort]);

  const setStatusTab = (next: string) => {
    setStatus(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('status');
    else params.set('status', next);
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#FAFBFC]">
      <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4 pb-20">
        <header className="h-14 flex items-center justify-between border-b border-slate-200/80 bg-white/80 rounded-2xl px-4 sm:px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-base font-bold tracking-tight text-slate-900">Tickets</h1>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums">
              {filtered.length} insgesamt
            </span>
          </div>
          <Button
            type="button"
            onClick={() => navigate('/portal/tickets/new')}
            className="h-9 rounded-lg px-3.5 gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-semibold"
          >
            <Plus className="w-4 h-4" />
            Neues Ticket erstellen
          </Button>
        </header>

        {isOrgWide ? (
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 w-fit">
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-xs font-bold rounded-lg',
                scope === 'mine' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500',
              )}
              onClick={() => setScope('mine')}
            >
              Meine Tickets
            </button>
            <button
              type="button"
              className={cn(
                'px-3 py-1.5 text-xs font-bold rounded-lg',
                scope === 'all' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500',
              )}
              onClick={() => setScope('all')}
            >
              Alle Firmen-Tickets
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200/80 pb-0 overflow-x-auto">
          {PORTAL_STATUS_FILTERS.map((tab) => {
            const count = statusCounts[tab.value] ?? 0;
            const active = status === tab.value || (tab.value === 'all' && status === 'all');
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusTab(tab.value)}
                className={cn(
                  'px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors',
                  active
                    ? 'border-[#1B6CA8] text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800',
                )}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="h-12 flex items-center gap-2 border-b border-slate-200/80 bg-white rounded-xl px-3">
          <div className="relative flex-1 min-w-[140px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen..."
              className="h-8 pl-8 text-xs bg-slate-50/80 border-slate-200/80 rounded-md"
            />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                'h-8 gap-1 rounded-md text-xs font-medium',
                filterOpen || priority !== 'all'
                  ? 'border-blue-200 bg-blue-50/50 text-blue-700'
                  : 'border-slate-200/80 text-slate-600',
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filtern
            </Button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sortieren"
              className="h-8 text-xs font-medium text-slate-700 bg-slate-50/80 border border-slate-200/80 rounded-md px-2"
            >
              <option value="newest">Neueste</option>
              <option value="oldest">Älteste</option>
              <option value="priority">Priorität</option>
            </select>
          </div>
        </div>

        {filterOpen ? (
          <div className="flex flex-wrap gap-2 items-center rounded-xl border border-slate-200 bg-white p-3">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Priorität</span>
            <select
              className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="all">Alle</option>
              <option value="low">Niedrig</option>
              <option value="medium">Mittel</option>
              <option value="high">Hoch</option>
              <option value="urgent">Dringend</option>
            </select>
          </div>
        ) : null}

        <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
              Tickets werden geladen…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">Keine Tickets gefunden.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100 bg-slate-50/80">
                    <th className="py-2.5 px-4 font-semibold">Betreff</th>
                    <th className="py-2.5 px-3 font-semibold">Ersteller</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Priorität</th>
                    <th className="py-2.5 px-3 font-semibold">Kategorie</th>
                    <th className="py-2.5 px-3 font-semibold">Zuständiger</th>
                    <th className="py-2.5 px-4 font-semibold">Aktivität</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const creator = safeString(t.customerName) || '—';
                    const assignee =
                      safeString(t.agentName) ||
                      (t.agentId ? 'Zugewiesen' : 'In Prüfung');
                    return (
                      <tr
                        key={t.id}
                        className="border-b border-slate-50 hover:bg-slate-50/80 cursor-pointer"
                        onClick={() => navigate(`/portal/tickets/${t.id}`)}
                      >
                        <td className="py-3 px-4 min-w-0">
                          <Link
                            to={`/portal/tickets/${t.id}`}
                            className="font-semibold text-slate-900 hover:text-[#1B6CA8] line-clamp-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t.subject || '(ohne Betreff)'}
                          </Link>
                          <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                            {formatTicketRef(t)}
                          </p>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-600 flex items-center justify-center shrink-0">
                              {getInitials(creator) || '—'}
                            </span>
                            <span className="text-xs font-medium text-slate-700 truncate max-w-[120px]">
                              {creator}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span className={portalStatusBadgeClass(t.status)}>
                            {portalStatusLabel(t.status)}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={portalPriorityBadgeClass(t.priority)}>
                            {portalPriorityLabel(t.priority)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 font-medium">
                          {safeString(t.categoryName) || '—'}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600 font-medium truncate max-w-[140px]">
                          {assignee}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 font-medium whitespace-nowrap">
                          {formatRelativeTime(t.updatedAt || t.createdAt, 'de')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
