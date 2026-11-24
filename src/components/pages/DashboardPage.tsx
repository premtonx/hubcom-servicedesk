import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  CheckCircle2,
  Calendar,
  ChevronDown,
  ArrowUpRight,
  BookOpen,
  Plus,
  AlertTriangle,
  Inbox,
  Loader2,
  Building2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { CreateTicketDialog } from '../CreateTicketDialog';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../lib/hooks';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  executiveDashboardApi,
  type DashboardStatsPayload,
} from '../../services/executiveDashboardApi';
import {
  dashboardPriorityLabel,
  dashboardTicketNumber,
  formatRelativeTime,
  organizationInitialsFromName,
} from '../../lib/dashboard-format-utils';
import { getModuleConfig } from '../../lib/module-config';

type TicketFilterTab = 'unassigned' | 'mine' | 'all';

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userProfile } = usePermissions();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticketTab, setTicketTab] = useState<TicketFilterTab>('unassigned');
  const [moduleFlags, setModuleFlags] = useState(() => getModuleConfig().platformModules);

  useEffect(() => {
    const sync = () => setModuleFlags(getModuleConfig().platformModules);
    window.addEventListener('module-config-changed', sync);
    return () => window.removeEventListener('module-config-changed', sync);
  }, []);

  useEffect(() => {
    if (!userProfile) return;
    let active = true;

    const load = async () => {
      try {
        const stats = await executiveDashboardApi.getStats();
        if (active) setDashboardStats(stats);
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const intervalId = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [userProfile]);

  const buckets = dashboardStats?.buckets;
  const kpis = dashboardStats?.kpis;
  const trendChart = dashboardStats?.trendChart ?? [];
  const trendFooter = dashboardStats?.trendFooter;
  const kbHealth = dashboardStats?.kbHealth;
  const aiInsights = dashboardStats?.aiInsights;
  const clientOrgs = dashboardStats?.clientOrganizations ?? [];

  const filteredTickets = useMemo(() => {
    const all = dashboardStats?.recentTickets ?? [];
    const uid = user?.uid;
    if (ticketTab === 'unassigned') {
      return all.filter((t) => !t.agentId || t.agentId === '' || t.agentId === 'unassigned');
    }
    if (ticketTab === 'mine' && uid) {
      return all.filter((t) => t.agentId === uid);
    }
    return all;
  }, [dashboardStats?.recentTickets, ticketTab, user?.uid]);

  const displayName = userProfile?.name || user?.displayName || 'Operator';

  const exportReport = () => {
    if (!dashboardStats) return;
    const rows = [
      ['Kennzahl', 'Wert'],
      ['Nicht zugewiesen', String(buckets?.unassigned ?? 0)],
      ['Überfällig / SLA-Risiko', String(buckets?.overdue ?? 0)],
      ['Offen & In Bearbeitung', String(buckets?.openInProgress ?? 0)],
      ['Gelöst (Zeitraum)', String(buckets?.resolvedInPeriod ?? 0)],
      ['Lösungsquote', kpis?.resolutionRate ?? '—'],
      ['Ø Lösungszeit', kpis?.avgResolutionTime ?? '—'],
      ['Eingehend', String(trendFooter?.incoming ?? 0)],
      ['Gelöst', String(trendFooter?.resolved ?? 0)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hubcom-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div id="dashboard-scroller" className="flex-1 overflow-y-auto min-h-0 bg-[#F8F9FA] custom-scrollbar">
      <CreateTicketDialog isOpen={isNewTicketOpen} onClose={() => setIsNewTicketOpen(false)} />

      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto pb-20">
        {/* Compact header */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#202124] truncate">
              {t('dashboard.welcome', 'Willkommen zurück, {{name}}! 👋').replace(
                '{{name}}',
                displayName,
              )}
            </h1>
            <p className="text-sm text-[#5F6368] font-medium mt-0.5">
              {t(
                'dashboard.subtitle',
                'Hier ist der aktuelle Stand Ihrer Support-Aktivitäten heute.',
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="bg-white border-gray-200 text-gray-700 h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 shadow-sm"
            >
              <Calendar className="w-3.5 h-3.5 text-gray-500" />
              {dashboardStats?.dateRange.label ?? t('dashboard.days7', '7 Tage')}
              <ChevronDown className="w-3 h-3 text-gray-400" />
            </Button>
            <Button
              variant="outline"
              onClick={exportReport}
              className="bg-white border-gray-200 text-gray-700 h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 shadow-sm"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-gray-500" />
              {t('dashboard.exportReport', 'Bericht exportieren')}
            </Button>
            <div className="w-px h-6 bg-slate-200 hidden sm:block" />
            <Button
              onClick={() => setIsNewTicketOpen(true)}
              className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              Ticket erstellen
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/kb')}
              className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 bg-white"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Wissensdatenbank
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('/credentials')}
              className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 bg-white"
            >
              Tresor
            </Button>
          </div>
        </div>

        {/* 4 action KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <ActionKpiCard
            label="Nicht zugewiesen"
            value={buckets?.unassigned ?? (loading ? '…' : 0)}
            icon={<Inbox className="w-4 h-4" />}
            danger={(buckets?.unassigned ?? 0) > 0}
            onClick={() => navigate('/tickets?view=unassigned')}
          />
          <ActionKpiCard
            label="Überfällig / SLA-Risiko"
            value={buckets?.overdue ?? (loading ? '…' : 0)}
            icon={<AlertTriangle className="w-4 h-4" />}
            danger={(buckets?.overdue ?? 0) > 0}
            onClick={() => navigate('/tickets?view=overdue')}
          />
          <ActionKpiCard
            label="Offen & In Bearbeitung"
            value={buckets?.openInProgress ?? (loading ? '…' : 0)}
            subtitle={`Ø Lösungszeit: ${kpis?.avgResolutionTime ?? '—'}`}
            icon={<Clock className="w-4 h-4" />}
            onClick={() => navigate('/tickets?view=open')}
          />
          <ActionKpiCard
            label="Gelöst (Zeitraum)"
            value={buckets?.resolvedInPeriod ?? (loading ? '…' : 0)}
            subtitle={`Lösungsquote: ${kpis?.resolutionRate ?? '—'}`}
            icon={<CheckCircle2 className="w-4 h-4" />}
            onClick={() => navigate('/tickets?view=resolved')}
          />
        </div>

        {/* Main 2-column: tickets + clients */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <CardShell className="lg:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                Aktuelle Tickets
              </h2>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    { id: 'unassigned', label: 'Nicht zugewiesen' },
                    { id: 'mine', label: 'Mir zugewiesen' },
                    { id: 'all', label: 'Alle' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTicketTab(tab.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors',
                      ticketTab === tab.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {loading && filteredTickets.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Tickets werden geladen…
              </div>
            ) : filteredTickets.length === 0 ? (
              <div className="py-14 text-center text-sm text-slate-500">
                Keine Tickets in dieser Ansicht.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredTickets.map((ticket) => {
                  const company = ticket.company || 'Intern';
                  const initials = organizationInitialsFromName(company);
                  return (
                    <li key={ticket.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                        className="w-full text-left py-3.5 flex items-start gap-3 hover:bg-slate-50/80 rounded-xl px-2 -mx-2 transition-colors"
                      >
                        <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-[#1B6CA8]">
                              {dashboardTicketNumber(ticket)}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-600">
                              <Building2 className="w-3 h-3 text-slate-400" />
                              {company}
                            </span>
                            <PriorityBadge priority={ticket.priority} />
                          </div>
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {ticket.subject}
                          </p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                            <span>{ticket.category || 'Allgemein'}</span>
                            <span className="text-slate-300">·</span>
                            <span>{formatRelativeTime(ticket.updatedAt, 'de')}</span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="pt-3 mt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => navigate('/tickets')}
                className="text-xs font-bold text-[#1B6CA8] hover:underline"
              >
                Alle Tickets anzeigen →
              </button>
            </div>
          </CardShell>

          <CardShell>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-4">
              Kunden-Übersicht
            </h2>
            {clientOrgs.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                Noch keine aktiven Kundenorganisationen.
              </p>
            ) : (
              <ul className="space-y-2">
                {clientOrgs.map((org) => (
                  <li key={org.id}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/tickets?organizationId=${encodeURIComponent(org.id)}`)
                      }
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors text-left"
                    >
                      {org.logoUrl ? (
                        <img
                          src={org.logoUrl}
                          alt=""
                          className="w-9 h-9 rounded-xl object-contain border border-slate-100 bg-white shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-[10px] font-black shrink-0">
                          {organizationInitialsFromName(org.name)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900 truncate">{org.name}</p>
                        <p className="text-[11px] text-slate-500 font-medium">
                          {org.openCount} offen
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          'text-[9px] font-black uppercase border shrink-0',
                          org.slaStatus === 'risk'
                            ? 'bg-rose-50 text-rose-700 border-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-100',
                        )}
                      >
                        {org.slaStatus === 'risk' ? 'SLA-Risiko' : 'Gesund'}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardShell>
        </div>

        {/* Lower analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CardShell>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                Ticket-Trends
              </h2>
              <div className="flex items-center gap-3 text-[10px] font-bold text-slate-500">
                <span>
                  Eingehend: {trendFooter?.incoming ?? 0}
                </span>
                <span>
                  Gelöst: {trendFooter?.resolved ?? 0}
                </span>
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChart}>
                  <defs>
                    <linearGradient id="incomingFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1B6CA8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#1B6CA8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="resolvedFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EAED" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#80868B' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#80868B' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #E8EAED',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, fontWeight: 700 }}
                    formatter={(value) =>
                      value === 'incoming' ? 'Eingehend' : value === 'resolved' ? 'Gelöst' : value
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="incoming"
                    name="incoming"
                    stroke="#1B6CA8"
                    fill="url(#incomingFill)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="resolved"
                    name="resolved"
                    stroke="#059669"
                    fill="url(#resolvedFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardShell>

          <div className="space-y-4">
            <CardShell>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                  KI-Erkenntnisse
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/insights')}
                  className="text-[11px] font-bold text-[#1B6CA8] hover:underline"
                >
                  Alle anzeigen →
                </button>
              </div>
              {aiInsights?.offline ? (
                <p className="text-sm text-slate-500 py-4">
                  KI-Analyse derzeit offline. Keine Cluster verfügbar.
                </p>
              ) : (aiInsights?.items?.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                  Keine wiederkehrenden Problemmuster erkannt.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {(aiInsights?.items || []).map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{item.title}</p>
                        <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                          {item.count} ähnliche Tickets
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          'text-[9px] font-black uppercase border shrink-0',
                          item.impact === 'high' && 'bg-rose-50 text-rose-700 border-rose-100',
                          item.impact === 'medium' && 'bg-amber-50 text-amber-700 border-amber-100',
                          item.impact === 'low' && 'bg-slate-100 text-slate-600 border-slate-200',
                        )}
                      >
                        {item.impact === 'high'
                          ? 'Hoch'
                          : item.impact === 'medium'
                            ? 'Mittel'
                            : 'Niedrig'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {aiInsights?.summary && (aiInsights?.items?.length ?? 0) > 0 && (
                <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                  {aiInsights.summary}
                </p>
              )}
            </CardShell>

            {moduleFlags.geistKB !== false && (
              <CardShell>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                    KB-Abdeckung
                  </h2>
                  <span className="text-sm font-black text-slate-900">
                    {kbHealth?.score ?? 0}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#1B6CA8] transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, kbHealth?.score ?? 0))}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 font-medium mt-2">
                  {kbHealth?.label === 'wellMaintained'
                    ? 'Gut gepflegt'
                    : kbHealth?.label === 'stable'
                      ? 'Stabil'
                      : 'Aufmerksamkeit erforderlich'}
                </p>
              </CardShell>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CardShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200/80 rounded-2xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function ActionKpiCard({
  label,
  value,
  subtitle,
  icon,
  onClick,
  danger,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-2xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md',
        danger
          ? 'border-rose-200 ring-1 ring-rose-100'
          : 'border-slate-200/80 hover:border-slate-300',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center border',
            danger
              ? 'bg-rose-50 text-rose-600 border-rose-100'
              : 'bg-slate-50 text-slate-600 border-slate-100',
          )}
        >
          {icon}
        </span>
        <ArrowUpRight className="w-3.5 h-3.5 text-slate-300" />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-3">
        {label}
      </p>
      <p
        className={cn(
          'text-2xl font-black tracking-tight mt-1',
          danger ? 'text-rose-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      {subtitle && (
        <p className="text-[11px] text-slate-500 font-medium mt-1">{subtitle}</p>
      )}
    </button>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = String(priority || 'medium').toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold border',
        p === 'urgent' || p === 'critical'
          ? 'bg-rose-50 text-rose-700 border-rose-100'
          : p === 'high'
            ? 'bg-orange-50 text-orange-700 border-orange-100'
            : p === 'low'
              ? 'bg-slate-50 text-slate-600 border-slate-200'
              : 'bg-sky-50 text-sky-700 border-sky-100',
      )}
    >
      {dashboardPriorityLabel(priority)}
    </span>
  );
}
