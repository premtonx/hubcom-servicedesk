import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Ticket as TicketIcon,
  Zap,
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
import axios from 'axios';
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
import { buildTicketsListUrl } from '../../lib/dashboard-ticket-nav';
import { getModuleConfig } from '../../lib/module-config';
import { isTicketAssignedToUser } from '../../lib/ticketAssignee';
import { isActiveSupportTicket, isUnassignedTicket } from '../../lib/ticketViewFilters';
import type { Ticket } from '../../types';

type TicketFilterTab = 'all' | 'unassigned' | 'mine';

const DASHBOARD_LIST_LIMIT = 6;
const CUSTOMER_LIST_LIMIT = 6;

const HERO_GRADIENT =
  'linear-gradient(90deg, rgba(238,244,251,0.98) 0%, rgba(238,244,251,0.88) 45%, rgba(238,244,251,0.35) 75%, rgba(238,244,251,0.12) 100%)';

const FALLBACK_HERO_BG =
  'linear-gradient(135deg, #E8F0FE 0%, #EEF4FB 40%, #DCE9F8 70%, #C5D9F0 100%)';

function recentTicketAsTicket(t: DashboardStatsPayload['recentTickets'][number]): Ticket {
  return {
    id: t.id,
    subject: t.subject,
    status: t.status,
    priority: t.priority as Ticket['priority'],
    agentId: t.agentId ?? undefined,
    agentName: t.agentName ?? undefined,
    assigneeId: t.assigneeId ?? undefined,
    assignedTo: t.assignedTo ?? undefined,
    assignedToEmail: t.assignedToEmail ?? undefined,
    organizationId: t.organizationId ?? undefined,
    company: t.company ?? undefined,
    slaDueAt: t.slaDueAt ?? undefined,
    firstResponseDue: t.firstResponseDue ?? undefined,
  } as Ticket;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { userProfile } = usePermissions();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticketTab, setTicketTab] = useState<TicketFilterTab>('all');
  const [moduleFlags, setModuleFlags] = useState(() => getModuleConfig().platformModules);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setModuleFlags(getModuleConfig().platformModules);
    window.addEventListener('module-config-changed', sync);
    return () => window.removeEventListener('module-config-changed', sync);
  }, []);

  useEffect(() => {
    if (!user) return;
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
  }, [user]);

  const loadBanner = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/dashboard-banner', { withCredentials: true });
      setBannerUrl(res.data?.imageDataUrl || null);
    } catch {
      /* staff-only; ignore for unauthorized */
    }
  }, []);

  useEffect(() => {
    void loadBanner();
  }, [loadBanner]);

  const buckets = dashboardStats?.buckets;
  const kpis = dashboardStats?.kpis;
  const trendChart = dashboardStats?.trendChart ?? [];
  const trendFooter = dashboardStats?.trendFooter;
  const kbHealth = dashboardStats?.kbHealth;
  const aiInsights = dashboardStats?.aiInsights;
  const clientOrgs = dashboardStats?.clientOrganizations ?? [];
  const visibleClientOrgs = clientOrgs.slice(0, CUSTOMER_LIST_LIMIT);

  const recentAll = dashboardStats?.recentTickets ?? [];

  const tabCounts = useMemo(() => {
    const allActive = recentAll.filter((t) => isActiveSupportTicket(recentTicketAsTicket(t)));
    const unassigned = recentAll.filter((t) => isUnassignedTicket(recentTicketAsTicket(t)));
    const me = user?.uid
      ? {
          userId: user.uid,
          userEmail: user.email,
          userName: user.displayName || user.email?.split('@')[0] || '',
        }
      : null;
    const mine = me
      ? recentAll.filter((t) => isTicketAssignedToUser(recentTicketAsTicket(t), me))
      : [];
    return {
      all: allActive.length,
      unassigned: buckets?.unassigned ?? unassigned.length,
      mine: mine.length,
    };
  }, [recentAll, buckets?.unassigned, user?.uid, user?.email, user?.displayName]);

  const filteredTickets = useMemo(() => {
    if (ticketTab === 'unassigned') {
      return recentAll
        .filter((t) => isUnassignedTicket(recentTicketAsTicket(t)))
        .slice(0, DASHBOARD_LIST_LIMIT);
    }
    if (ticketTab === 'mine' && user?.uid) {
      const me = {
        userId: user.uid,
        userEmail: user.email,
        userName: user.displayName || user.email?.split('@')[0] || '',
      };
      return recentAll
        .filter((t) => isTicketAssignedToUser(recentTicketAsTicket(t), me))
        .slice(0, DASHBOARD_LIST_LIMIT);
    }
    return recentAll
      .filter((t) => isActiveSupportTicket(recentTicketAsTicket(t)))
      .slice(0, DASHBOARD_LIST_LIMIT);
  }, [recentAll, ticketTab, user?.uid, user?.email, user?.displayName]);

  const listSeeAllUrl = useMemo(() => {
    if (ticketTab === 'unassigned') {
      return buildTicketsListUrl({ kind: 'view', view: 'unassigned' });
    }
    if (ticketTab === 'mine') {
      return buildTicketsListUrl({ kind: 'view', view: 'assigned_me' });
    }
    return buildTicketsListUrl({ kind: 'view', view: 'team_all_open' });
  }, [ticketTab]);

  const displayName =
    userProfile?.name || user?.displayName || user?.email?.split('@')[0] || 'Operator';

  const exportReport = () => {
    if (!dashboardStats) return;
    const rows = [
      ['Kennzahl', 'Wert'],
      ['Offene Tickets', String(buckets?.open ?? 0)],
      ['In Bearbeitung', String(buckets?.inProgress ?? 0)],
      ['Gelöst (30 Tage)', String(buckets?.resolvedInPeriod ?? 0)],
      ['Ø Reaktionszeit (SLA)', kpis?.avgResponseTime ?? '—'],
      ['Nicht zugewiesen', String(buckets?.unassigned ?? 0)],
      ['Lösungsquote', kpis?.resolutionRate ?? '—'],
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

      <div className="max-w-[1440px] mx-auto w-full px-6 lg:px-8 py-6 lg:py-8 space-y-6 pb-20">
        {/* Glassmorphic hero: greeting + actions + KPI cards */}
        <section
          className="relative overflow-hidden rounded-[28px] border border-white/60 shadow-[0_8px_30px_rgba(15,23,42,0.06)]"
          style={{
            backgroundColor: '#EEF4FB',
            backgroundImage: bannerUrl
              ? `${HERO_GRADIENT}, url("${String(bannerUrl).replace(/"/g, '%22')}")`
              : `${HERO_GRADIENT}, ${FALLBACK_HERO_BG}`,
            backgroundSize: 'cover, cover',
            backgroundPosition: 'center, right center',
            backgroundRepeat: 'no-repeat, no-repeat',
          }}
        >
          <div className="relative z-10 p-5 sm:p-6 lg:p-7 space-y-5">
            <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
              <div className="min-w-0 max-w-xl">
                <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-[#202124] whitespace-nowrap overflow-hidden text-ellipsis">
                  <span className="whitespace-nowrap">
                    Willkommen zurück, {displayName}!{' '}
                    <span className="inline-block" aria-hidden>
                      👋
                    </span>
                  </span>
                </h1>
                <p className="text-sm text-[#5F6368] font-medium mt-1">
                  {t(
                    'dashboard.subtitle',
                    'Hier ist der aktuelle Stand Ihrer Support-Aktivitäten heute.',
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-nowrap overflow-x-auto pb-0.5 max-w-full">
                <Button
                  variant="outline"
                  className="bg-white/90 backdrop-blur-sm border-white/80 text-gray-700 h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                >
                  <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  {dashboardStats?.dateRange.label ?? t('dashboard.days7', '7 Tage')}
                  <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                </Button>
                <Button
                  variant="outline"
                  onClick={exportReport}
                  className="bg-white/90 backdrop-blur-sm border-white/80 text-gray-700 h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 shadow-sm whitespace-nowrap shrink-0"
                >
                  <ArrowUpRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  {t('dashboard.exportReport', 'Bericht exportieren')}
                </Button>
                <div className="w-px h-6 bg-slate-200/80 shrink-0 hidden sm:block" />
                <Button
                  onClick={() => setIsNewTicketOpen(true)}
                  className="h-9 px-3 rounded-xl text-xs font-bold gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white whitespace-nowrap shrink-0 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  Ticket erstellen
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/kb')}
                  className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 bg-white/90 backdrop-blur-sm border-white/80 whitespace-nowrap shrink-0"
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  Wissensdatenbank
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate('/credentials')}
                  className="h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 bg-white/90 backdrop-blur-sm border-white/80 whitespace-nowrap shrink-0"
                >
                  Tresor
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <HeroKpiCard
                label="Offene Tickets"
                value={buckets?.open ?? (loading ? '…' : 0)}
                icon={<TicketIcon className="w-4 h-4" />}
                iconTone="blue"
                onClick={() =>
                  navigate(buildTicketsListUrl({ kind: 'status', status: 'open' }))
                }
              />
              <HeroKpiCard
                label="In Bearbeitung"
                value={buckets?.inProgress ?? (loading ? '…' : 0)}
                icon={<Clock className="w-4 h-4" />}
                iconTone="sky"
                onClick={() =>
                  navigate(buildTicketsListUrl({ kind: 'status', status: 'in_progress' }))
                }
              />
              <HeroKpiCard
                label="Gelöst (letzte 30 Tage)"
                value={buckets?.resolvedInPeriod ?? (loading ? '…' : 0)}
                icon={<CheckCircle2 className="w-4 h-4" />}
                iconTone="green"
                onClick={() =>
                  navigate(
                    buildTicketsListUrl({
                      kind: 'status',
                      status: 'resolved',
                      resolvedWithinDays: 30,
                    }),
                  )
                }
              />
              <HeroKpiCard
                label="Ø Reaktionszeit (SLA)"
                value={kpis?.avgResponseTime ?? (loading ? '…' : '—')}
                icon={<Zap className="w-4 h-4" />}
                iconTone="purple"
                onClick={() =>
                  navigate(buildTicketsListUrl({ kind: 'view', view: 'sla' }))
                }
              />
            </div>
          </div>
        </section>

        {/* Main 2-column: tickets + clients */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          <CardShell className="lg:col-span-2 flex flex-col min-h-[28rem]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                Aktuelle Tickets
              </h2>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 flex-wrap">
                {(
                  [
                    { id: 'all', label: 'Alle' },
                    {
                      id: 'unassigned',
                      label: `Nicht zugewiesen (${tabCounts.unassigned})`,
                    },
                    {
                      id: 'mine',
                      label: `Mir zugewiesen (${tabCounts.mine})`,
                    },
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

            <div className="flex-1 min-h-0">
              {loading && filteredTickets.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-16 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Tickets werden geladen…
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
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
                          className="w-full text-left py-3 flex items-start gap-3 hover:bg-slate-50/80 rounded-xl px-2 -mx-2 transition-colors"
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
                          <AssigneeAvatar
                            name={ticket.agentName || ticket.assignedTo || null}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-auto pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => navigate(listSeeAllUrl)}
                className="text-xs font-bold text-[#1B6CA8] hover:underline"
              >
                Alle Tickets anzeigen →
              </button>
            </div>
          </CardShell>

          <CardShell className="flex flex-col min-h-[28rem]">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-4 shrink-0">
              Kunden-Übersicht
            </h2>
            {visibleClientOrgs.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center flex-1">
                Noch keine aktiven Kundenorganisationen.
              </p>
            ) : (
              <ul className="space-y-2 flex-1 min-h-0 overflow-y-auto">
                {visibleClientOrgs.map((org) => (
                  <li key={org.id}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          buildTicketsListUrl({
                            kind: 'organization',
                            organizationId: org.id,
                          }),
                        )
                      }
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-colors text-left"
                    >
                      <OrgThumb name={org.name} logoUrl={org.logoUrl} />
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
            <div className="mt-auto pt-3 border-t border-slate-100 shrink-0">
              <button
                type="button"
                onClick={() => navigate('/customers')}
                className="text-xs font-bold text-[#1B6CA8] hover:underline"
              >
                Alle Unternehmen →
              </button>
            </div>
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
                <span>Eingehend: {trendFooter?.incoming ?? 0}</span>
                <span>Gelöst: {trendFooter?.resolved ?? 0}</span>
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

const KPI_ICON_TONES = {
  blue: 'bg-blue-50 text-blue-600',
  sky: 'bg-sky-50 text-sky-600',
  green: 'bg-emerald-50 text-emerald-600',
  purple: 'bg-violet-50 text-violet-600',
} as const;

function HeroKpiCard({
  label,
  value,
  icon,
  iconTone,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  iconTone: keyof typeof KPI_ICON_TONES;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl bg-white/85 backdrop-blur-md border border-white/80 shadow-sm hover:bg-white transition px-5 py-4 flex items-center justify-between gap-4 text-left w-full"
    >
      <span
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
          KPI_ICON_TONES[iconTone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-black tracking-tight text-slate-900 leading-none">{value}</p>
        <p className="text-[12px] font-semibold text-slate-500 mt-1 truncate">{label}</p>
      </div>
      <span
        className="w-8 h-8 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center shrink-0 text-sm font-bold"
        aria-hidden
      >
        →
      </span>
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

/** Org thumbnail with clean initials fallback when logo is missing or fails to load. */
function OrgThumb({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(logoUrl) && !failed;
  if (showImg) {
    return (
      <img
        src={logoUrl!}
        alt=""
        className="w-9 h-9 rounded-xl object-contain border border-slate-100 bg-white shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-[10px] font-black shrink-0">
      {organizationInitialsFromName(name)}
    </div>
  );
}

function AssigneeAvatar({ name }: { name: string | null }) {
  if (!name) return <div className="w-8 shrink-0" />;
  const initials = organizationInitialsFromName(name);
  return (
    <div
      className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 text-[10px] font-black text-slate-600 flex items-center justify-center shrink-0"
      title={name}
    >
      {initials}
    </div>
  );
}
