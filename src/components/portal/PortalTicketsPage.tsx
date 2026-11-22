import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Search, Ticket } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { portalService, type PortalTicket } from '../../services/portalService';
import {
  PORTAL_STATUS_FILTERS,
  portalPriorityLabel,
  portalStatusLabel,
  type PortalStatusFilter,
} from '../../lib/portal/status';
import {
  formatPortalDate,
  portalPriorityBadgeClass,
  portalStatusBadgeClass,
  ticketNumberLabel,
} from './portalUi';
import { cn } from '../../lib/utils';

export function PortalTicketsPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PortalStatusFilter>('all');
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await portalService.listTickets({ status, q });
      setTickets(list);
    } catch (err: any) {
      toast.error(err?.message || 'Tickets konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const emptyHint = useMemo(() => {
    if (q || status !== 'all') return 'Keine Tickets für diesen Filter.';
    return 'Sie haben noch keine Tickets. Erstellen Sie Ihr erstes Anliegen.';
  }, [q, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Meine Tickets</h1>
          <p className="text-sm text-slate-500 mt-1">
            Übersicht Ihrer Anfragen bei Hubcom - Citadelle AG.
          </p>
        </div>
        <Button
          type="button"
          className="gap-1.5 font-bold"
          onClick={() => navigate('/portal/new')}
        >
          <Plus className="w-4 h-4" />
          Neues Ticket erstellen
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Suchen nach Betreff, Nummer, Kategorie…"
            className="pl-10 h-11 rounded-xl bg-white"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PORTAL_STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatus(f.value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-bold border transition',
              status === f.value
                ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Tickets werden geladen…
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Ticket className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm text-slate-500">{emptyHint}</p>
            <Button type="button" variant="outline" onClick={() => navigate('/portal/new')}>
              Neues Ticket erstellen
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  to={`/portal/tickets/${ticket.id}`}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4 hover:bg-slate-50/80 transition"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-slate-400">
                        {ticketNumberLabel(ticket)}
                      </span>
                      <span className={portalStatusBadgeClass(ticket.status)}>
                        {portalStatusLabel(ticket.status)}
                      </span>
                      <span className={portalPriorityBadgeClass(ticket.priority)}>
                        {portalPriorityLabel(ticket.priority)}
                      </span>
                    </div>
                    <p className="font-bold text-slate-900 truncate">{ticket.subject}</p>
                    <p className="text-xs text-slate-500">
                      {ticket.categoryName ? `${ticket.categoryName} · ` : ''}
                      Erstellt {formatPortalDate(ticket.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#1B6CA8] shrink-0">Öffnen →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PortalTicketsPage;
