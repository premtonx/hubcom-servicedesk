import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Image,
  Loader2,
  Mail,
  Package,
  PackageCheck,
  PackageOpen,
  Palette,
  Plus,
  ShieldAlert,
  Ticket as TicketIcon,
  Users,
  Zap,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import {
  clientPortalApi,
  type PortalDashboardResponse,
  type PortalDashboardReturnsActivityPoint,
  type PortalDashboardReturnsKpis,
  type PortalReturnsTrendRange,
} from '../../../services/clientPortalApi';
import {
  dashboardPriorityLabel,
  dashboardTicketNumber,
  formatRelativeTime,
} from '../../../lib/dashboard-format-utils';
import { portalStatusLabel } from '../../../lib/portal/status';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';

const RETURNS_TREND_OPTIONS: Array<{ id: PortalReturnsTrendRange; label: string }> = [
  { id: '7d', label: '7 Tage' },
  { id: '30d', label: '30 Tage' },
  { id: '90d', label: '90 Tage' },
  { id: '12m', label: '12 Monate' },
  { id: 'all', label: 'Alle' },
];

const HERO_GRADIENT =
  'linear-gradient(105deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.82) 38%, rgba(255,255,255,0.35) 62%, rgba(255,255,255,0.08) 100%)';
const FALLBACK_HERO_BG =
  'linear-gradient(135deg, #E8F1FA 0%, #D6E8F6 42%, #EEF4FB 100%)';

const KPI_ICON_TONES = {
  blue: 'bg-sky-100 text-sky-700',
  sky: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  purple: 'bg-violet-100 text-violet-700',
  amber: 'bg-amber-100 text-amber-700',
} as const;

const ZERO_RETURNS_KPIS: PortalDashboardReturnsKpis = {
  open: 0,
  overdue: 0,
  stage3: 0,
  returnedLast30: 0,
};

function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e?.name === 'CanceledError' || e?.name === 'AbortError' || e?.code === 'ERR_CANCELED';
}

export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const { session, isOrgWide } = useClientPortalSession();

  const [data, setData] = useState<PortalDashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [ticketTab, setTicketTab] = useState<'all' | 'mine'>('all');
  const [returnsTrendRange, setReturnsTrendRange] =
    useState<PortalReturnsTrendRange>('7d');
  const [returnsTrendData, setReturnsTrendData] = useState<
    PortalDashboardReturnsActivityPoint[]
  >([]);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // Dashboard KPIs — once on mount; never refetch on timeframe change.
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const payload = await clientPortalApi.getDashboard({ signal: ac.signal });
        setData(payload);
        setDashboardError(null);
      } catch (err: any) {
        if (isAbortError(err)) return;
        setDashboardError(
          err?.response?.data?.error ||
            err?.message ||
            'Dashboard konnte nicht geladen werden.',
        );
      } finally {
        if (!ac.signal.aborted) setDashboardLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, []);

  const hardwareReturnsEnabled =
    data?.organization.hardwareReturnsEnabled === true;
  // Org-wide roles see returns strip immediately at 0 while first dashboard fetch
  // is in flight; hide after load if module is off. CLIENT_USER never sees it.
  const showReturns = isOrgWide && (dashboardLoading || hardwareReturnsEnabled);

  // Independent trends fetch — AbortController cancels on timeframe change.
  useEffect(() => {
    if (!showReturns || !hardwareReturnsEnabled) {
      setReturnsTrendData([]);
      setTrendsLoading(false);
      return;
    }
    const ac = new AbortController();
    setTrendsLoading(true);
    void (async () => {
      try {
        const res = await clientPortalApi.getReturnsTrends(returnsTrendRange, {
          signal: ac.signal,
        });
        if (!ac.signal.aborted) {
          setReturnsTrendData(res.points);
        }
      } catch (err: any) {
        if (isAbortError(err)) return;
        if (!ac.signal.aborted) setReturnsTrendData([]);
      } finally {
        if (!ac.signal.aborted) setTrendsLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [returnsTrendRange, showReturns, hardwareReturnsEnabled]);

  const shellData: PortalDashboardResponse = data || {
    role: session?.role || 'CLIENT_USER',
    organization: {
      id: session?.organizationId || '',
      name: '',
      logoUrl: null,
      portalBannerUrl: null,
      portalTitle: 'ServiceDesk',
      hardwareReturnsEnabled: false,
    },
    user: { id: session?.id || '', name: session?.name || 'Nutzer' },
    kpis: {
      openTickets: 0,
      openCompanyTickets: 0,
      inProgressTickets: 0,
      resolvedLast30Days: 0,
      recentlyResolvedCount: 0,
      avgResponseTime: '—',
    },
    tickets: [],
    myOpenTickets: [],
    activity: [],
    team: null,
    email: null,
    returnsKpis: ZERO_RETURNS_KPIS,
    returnsActivityByRange: null,
  };

  const returnsKpis: PortalDashboardReturnsKpis =
    data?.returnsKpis || ZERO_RETURNS_KPIS;

  return (
    <PortalDashboardShell
      data={shellData}
      returnsKpis={returnsKpis}
      showReturns={Boolean(showReturns)}
      dashboardLoading={dashboardLoading}
      dashboardError={dashboardError}
      navigate={navigate}
      ticketTab={ticketTab}
      setTicketTab={setTicketTab}
      returnsTrendRange={returnsTrendRange}
      setReturnsTrendRange={setReturnsTrendRange}
      returnsTrendData={returnsTrendData}
      trendsLoading={trendsLoading}
    />
  );
}

function PortalDashboardShell({
  data,
  returnsKpis,
  showReturns,
  dashboardLoading,
  dashboardError,
  navigate,
  ticketTab,
  setTicketTab,
  returnsTrendRange,
  setReturnsTrendRange,
  returnsTrendData,
  trendsLoading,
}: {
  data: PortalDashboardResponse;
  returnsKpis: PortalDashboardReturnsKpis;
  showReturns: boolean;
  dashboardLoading: boolean;
  dashboardError: string | null;
  navigate: ReturnType<typeof useNavigate>;
  ticketTab: 'all' | 'mine';
  setTicketTab: (t: 'all' | 'mine') => void;
  returnsTrendRange: PortalReturnsTrendRange;
  setReturnsTrendRange: (r: PortalReturnsTrendRange) => void;
  returnsTrendData: PortalDashboardReturnsActivityPoint[];
  trendsLoading: boolean;
}) {
  const isAdmin = data.role === 'CLIENT_ADMIN';
  const isOrgWide = data.role === 'CLIENT_ADMIN' || data.role === 'CLIENT_SUPPORTER';
  const bannerUrl = data.organization.portalBannerUrl;
  const dateLabel = new Date().toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  const openCount = Number(data.kpis.openTickets ?? data.kpis.openCompanyTickets ?? 0);
  const inProgressCount = Number(data.kpis.inProgressTickets ?? 0);
  const resolvedCount = Number(data.kpis.resolvedLast30Days ?? data.kpis.recentlyResolvedCount ?? 0);
  const avgResponse = String(data.kpis.avgResponseTime ?? '—');

  const listedTickets = useMemo(() => {
    if (!isOrgWide || ticketTab === 'all') return data.tickets;
    return (data.myOpenTickets || data.tickets).filter(Boolean);
  }, [data, isOrgWide, ticketTab]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#F8F9FA]">
      <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-6 pb-20">
        {dashboardError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-medium flex-1">{dashboardError}</span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl shrink-0"
              onClick={() => window.location.reload()}
            >
              Erneut laden
            </Button>
          </div>
        ) : null}

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
                <h1 className="text-2xl sm:text-[1.75rem] font-bold tracking-tight text-[#202124]">
                  Willkommen zurück, {data.user.name || 'Nutzer'}!{' '}
                  <span className="inline-block" aria-hidden>
                    👋
                  </span>
                </h1>
                <p className="text-sm text-[#5F6368] font-medium mt-1">
                  {data.organization.portalTitle ||
                    (data.organization.name
                      ? `${data.organization.name} ServiceDesk`
                      : 'ServiceDesk')}{' '}
                  {data.organization.name ? `— ${data.organization.name}` : null}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {isOrgWide ? (
                  <Button
                    variant="outline"
                    className="bg-white/90 backdrop-blur-sm border-white/80 text-gray-700 h-9 px-3 rounded-xl text-xs font-semibold gap-1.5 shadow-sm"
                  >
                    <Calendar className="w-3.5 h-3.5 text-gray-500" />
                    {dateLabel}
                  </Button>
                ) : null}
                <Button
                  onClick={() => navigate('/portal/tickets/new')}
                  className="h-9 px-3.5 rounded-xl text-xs font-bold gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Neues Ticket erstellen
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <HeroKpiCard
                label="Offene Tickets"
                value={openCount}
                loading={dashboardLoading}
                icon={<TicketIcon className="w-4 h-4" />}
                iconTone="blue"
                onClick={() => navigate('/portal/tickets?status=open')}
              />
              <HeroKpiCard
                label="In Bearbeitung"
                value={inProgressCount}
                loading={dashboardLoading}
                icon={<Clock className="w-4 h-4" />}
                iconTone="sky"
                onClick={() => navigate('/portal/tickets?status=in_progress')}
              />
              <HeroKpiCard
                label="Gelöst (letzte 30 Tage)"
                value={resolvedCount}
                loading={dashboardLoading}
                icon={<CheckCircle2 className="w-4 h-4" />}
                iconTone="green"
                onClick={() => navigate('/portal/tickets?status=resolved')}
              />
              <HeroKpiCard
                label="Ø Reaktionszeit"
                value={avgResponse}
                loading={dashboardLoading}
                icon={<Zap className="w-4 h-4" />}
                iconTone="purple"
                onClick={() => navigate('/portal/tickets')}
              />
            </div>

            {showReturns ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <PackageOpen className="w-3.5 h-3.5 text-sky-700" />
                    Rücklieferungen
                  </h2>
                  <button
                    type="button"
                    className="text-[11px] font-bold text-sky-700 hover:text-sky-900"
                    onClick={() => navigate('/portal/returns')}
                  >
                    Zur Übersicht →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <HeroKpiCard
                    label="Offene Rücklieferungen"
                    value={returnsKpis.open}
                    loading={dashboardLoading}
                    icon={<Package className="w-4 h-4" />}
                    iconTone="blue"
                    onClick={() => navigate('/portal/returns?view=open')}
                  />
                  <HeroKpiCard
                    label="Überfällig"
                    value={returnsKpis.overdue}
                    loading={dashboardLoading}
                    icon={<AlertTriangle className="w-4 h-4" />}
                    iconTone="amber"
                    onClick={() => navigate('/portal/returns?view=overdue')}
                  />
                  <HeroKpiCard
                    label="Letzte Stufe / Eskaliert (4.+ Erinnerung)"
                    value={returnsKpis.stage3}
                    loading={dashboardLoading}
                    icon={<ShieldAlert className="w-4 h-4" />}
                    iconTone="purple"
                    onClick={() =>
                      navigate('/portal/returns?view=open&mailStatus=mail4plus')
                    }
                  />
                  <HeroKpiCard
                    label="Zurückgeliefert (30 Tage)"
                    value={returnsKpis.returnedLast30}
                    loading={dashboardLoading}
                    icon={<PackageCheck className="w-4 h-4" />}
                    iconTone="green"
                    onClick={() => navigate('/portal/returns?view=done')}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
            <CardShell className="flex flex-col min-h-[28rem]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 shrink-0">
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-800">
                  Aktuelle Tickets
                </h2>
                {isOrgWide ? (
                  <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                    {(
                      [
                        { id: 'all' as const, label: 'Alle Firmen-Tickets' },
                        { id: 'mine' as const, label: 'Meine Tickets' },
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
                ) : (
                  <span className="text-[11px] font-bold text-slate-500">Meine Tickets</span>
                )}
              </div>
              {dashboardLoading ? (
                <div className="flex-1 flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Tickets werden geladen…
                </div>
              ) : (
                <TicketList tickets={listedTickets} navigate={navigate} showRequester={isOrgWide} />
              )}

              {data.activity && data.activity.length > 0 ? (
                <div className="mt-6 pt-5 border-t border-slate-100">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3">
                    Ticket-Trends
                  </h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.activity}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={4} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area
                          type="monotone"
                          dataKey="created"
                          name="Eingehend"
                          stroke="#1B6CA8"
                          fill="#1B6CA822"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="resolved"
                          name="Gelöst"
                          stroke="#059669"
                          fill="#05966922"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : null}
            </CardShell>

            {showReturns ? (
              <CardShell>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <PackageOpen className="w-4 h-4 text-sky-600" />
                    Rücklieferungen-Trends
                    {trendsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" aria-label="Trends laden" />
                    ) : null}
                  </h3>
                  <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
                    {RETURNS_TREND_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setReturnsTrendRange(opt.id)}
                        className={cn(
                          'px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors',
                          returnsTrendRange === opt.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="h-56 relative">
                  {trendsLoading && returnsTrendData.length === 0 ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 text-slate-400 text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Trends werden geladen…
                    </div>
                  ) : returnsTrendData.length > 0 ? (
                    <>
                      {trendsLoading ? (
                        <div className="absolute inset-0 z-10 bg-white/40 flex items-start justify-end p-2 pointer-events-none">
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        </div>
                      ) : null}
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={returnsTrendData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10 }}
                            interval={
                              returnsTrendRange === '90d'
                                ? 6
                                : returnsTrendRange === '7d'
                                  ? 0
                                  : 4
                            }
                          />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Area
                            type="monotone"
                            dataKey="offeneRuecklieferungen"
                            name="Offene Rücklieferungen"
                            stroke="#1B6CA8"
                            fill="#1B6CA822"
                            strokeWidth={2}
                          />
                          <Area
                            type="monotone"
                            dataKey="ueberfaellig"
                            name="Überfällig"
                            stroke="#D97706"
                            fill="#D9770622"
                            strokeWidth={2}
                          />
                          <Area
                            type="monotone"
                            dataKey="letzteStufeEskaliert"
                            name="Letzte Stufe / Eskaliert"
                            stroke="#7C3AED"
                            fill="#7C3AED22"
                            strokeWidth={2}
                          />
                          <Area
                            type="monotone"
                            dataKey="zurueckgeliefert"
                            name="Zurückgeliefert"
                            stroke="#059669"
                            fill="#05966922"
                            strokeWidth={2}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500 py-16 text-center">
                      Noch keine Rücklieferungsdaten für diesen Zeitraum.
                    </p>
                  )}
                </div>
              </CardShell>
            ) : null}
          </div>

          <div className="space-y-4">
            {isAdmin ? (
              <>
                <CardShell>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4 text-sky-600" /> Mitarbeiter & Rollen
                  </h3>
                  <dl className="space-y-2 text-sm">
                    <SummaryRow label="Aktive Nutzer" value={data.team?.totalActive ?? 0} />
                    <SummaryRow label="Admins" value={data.team?.clientAdmins ?? 0} />
                    <SummaryRow label="Supporter" value={data.team?.clientSupporters ?? 0} />
                    <SummaryRow label="Benutzer" value={data.team?.clientUsers ?? 0} />
                  </dl>
                  <Button
                    variant="outline"
                    className="w-full mt-4 rounded-xl font-bold"
                    onClick={() => navigate('/portal/members')}
                  >
                    Zum Team
                  </Button>
                </CardShell>
                <CardShell>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-emerald-600" /> E-Mail & M365
                  </h3>
                  <p className="text-sm font-bold text-slate-900">
                    {data.email?.configured
                      ? data.email.healthy
                        ? 'Send-As verbunden'
                        : 'Kanal prüfen'
                      : 'Noch nicht eingerichtet'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {data.email?.mailbox || 'Kein Postfach verknüpft'}
                  </p>
                  <Button
                    variant="outline"
                    className="w-full mt-4 rounded-xl font-bold"
                    onClick={() => navigate('/portal/email')}
                  >
                    Integration verwalten
                  </Button>
                </CardShell>
                <CardShell>
                  <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3 flex items-center gap-2">
                    <Palette className="w-4 h-4 text-violet-600" /> Portal-Branding
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    Logo, Portal-Titel und Dashboard-Banner für Ihr Kunden-Portal.
                  </p>
                  <Button
                    className="w-full mt-4 rounded-xl font-bold bg-[#1B6CA8] hover:bg-[#155a8a] text-white gap-2"
                    onClick={() => navigate('/portal/branding')}
                  >
                    <Image className="w-4 h-4" />
                    Branding öffnen
                  </Button>
                </CardShell>
              </>
            ) : (
              <CardShell>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-3">
                  {data.role === 'CLIENT_SUPPORTER' ? 'Ihr Support-Team' : 'Schnelles Ticket'}
                </h3>
                <p className="text-sm text-slate-600 font-medium leading-relaxed">
                  {data.role === 'CLIENT_SUPPORTER'
                    ? 'Erstellen Sie Tickets für Kollegen und behalten Sie offene Firmen-Anfragen im Blick.'
                    : 'Melden Sie ein Problem oder stellen Sie eine Anfrage an Hubcom Support.'}
                </p>
                <Button
                  className="w-full mt-4 rounded-xl font-bold bg-[#1B6CA8] hover:bg-[#155a8a] text-white gap-2"
                  onClick={() => navigate('/portal/tickets/new')}
                >
                  <Plus className="w-4 h-4" />
                  Neues Ticket erstellen
                </Button>
              </CardShell>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroKpiCard({
  label,
  value,
  icon,
  iconTone,
  onClick,
  loading = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  iconTone: keyof typeof KPI_ICON_TONES;
  onClick: () => void;
  loading?: boolean;
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
        <p
          className={cn(
            'text-xl font-black tracking-tight text-slate-900 leading-none inline-flex items-center gap-1.5',
            loading && 'animate-pulse',
          )}
        >
          {value}
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" aria-hidden />
          ) : null}
        </p>
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

function CardShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500 font-medium">{label}</dt>
      <dd className="font-black text-slate-900">{value}</dd>
    </div>
  );
}

function TicketList({
  tickets,
  navigate,
  showRequester,
  empty = 'Keine Tickets vorhanden.',
}: {
  tickets: PortalDashboardResponse['tickets'];
  navigate: ReturnType<typeof useNavigate>;
  showRequester?: boolean;
  empty?: string;
}) {
  if (!tickets.length) {
    return <p className="text-sm text-slate-500 py-8 text-center">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100 flex-1">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <button
            type="button"
            onClick={() => navigate(`/portal/tickets/${ticket.id}`)}
            className="w-full text-left py-3 flex items-start gap-3 hover:bg-slate-50 rounded-xl px-2 -mx-2 transition-colors"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] font-bold text-slate-700">
                  {dashboardTicketNumber(ticket)}
                </span>
                <Badge className="text-[9px] font-bold border bg-slate-50 text-slate-700 border-slate-200">
                  {portalStatusLabel(ticket.status)}
                </Badge>
                <Badge className="text-[9px] font-bold border bg-white text-slate-700 border-slate-200">
                  {dashboardPriorityLabel(ticket.priority)}
                </Badge>
              </div>
              <p className="text-sm font-semibold text-slate-900 truncate">{ticket.subject}</p>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                {showRequester && ticket.requesterName ? (
                  <>
                    <span>{ticket.requesterName}</span>
                    <span className="text-slate-300">·</span>
                  </>
                ) : null}
                <span>{formatRelativeTime(ticket.updatedAt, 'de')}</span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
