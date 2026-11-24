import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  Mail,
  Plus,
  Users,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import {
  clientPortalApi,
  type PortalDashboardResponse,
} from '../../../services/clientPortalApi';
import {
  dashboardPriorityLabel,
  dashboardTicketNumber,
  formatRelativeTime,
} from '../../../lib/dashboard-format-utils';
import { portalStatusLabel } from '../../../lib/portal/status';

export default function PortalDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<PortalDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const payload = await clientPortalApi.getDashboard();
        if (active) setData(payload);
      } catch (err: any) {
        if (active) {
          setError(
            err?.response?.data?.error ||
              err?.message ||
              'Dashboard konnte nicht geladen werden.',
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-slate-400 text-sm p-12">
        <Loader2 className="w-4 h-4 animate-spin" /> Dashboard wird geladen…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-12 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <p className="text-sm font-bold text-slate-800">{error || 'Keine Daten'}</p>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => window.location.reload()}
        >
          Erneut laden
        </Button>
      </div>
    );
  }

  if (data.role === 'CLIENT_USER') {
    return <ClientUserDashboard data={data} navigate={navigate} />;
  }
  if (data.role === 'CLIENT_SUPPORTER') {
    return <ClientSupporterDashboard data={data} navigate={navigate} />;
  }
  return <ClientAdminDashboard data={data} navigate={navigate} />;
}

function WelcomeHeader({
  data,
  ctaLabel,
  onCreate,
}: {
  data: PortalDashboardResponse;
  ctaLabel: string;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {data.organization.logoUrl ? (
          <img
            src={data.organization.logoUrl}
            alt=""
            className="w-12 h-12 rounded-2xl object-contain border border-slate-200 bg-white shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-sm font-black shrink-0">
            {data.organization.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">
            Willkommen zurück, {data.user.name || 'Nutzer'}
          </h1>
          <p className="text-sm text-slate-500 font-medium truncate">
            {data.organization.portalTitle || `${data.organization.name} ServiceDesk`}
          </p>
        </div>
      </div>
      <Button
        onClick={onCreate}
        className="h-11 px-5 rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-white gap-2 shrink-0"
      >
        <Plus className="w-4 h-4" />
        {ctaLabel}
      </Button>
    </div>
  );
}

function ClientAdminDashboard({
  data,
  navigate,
}: {
  data: PortalDashboardResponse;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto pb-20">
      <WelcomeHeader
        data={data}
        ctaLabel="+ Neues Ticket"
        onCreate={() => navigate('/portal/tickets/new')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Kpi
          label="Offene Firmen-Tickets"
          value={data.kpis.openCompanyTickets ?? 0}
          icon={<Inbox className="w-4 h-4" />}
          onClick={() => navigate('/portal/tickets?status=open')}
        />
        <Kpi
          label="Wartet auf Ihre Antwort"
          value={data.kpis.waitingOnCustomer ?? 0}
          icon={<Clock className="w-4 h-4" />}
          danger={Number(data.kpis.waitingOnCustomer || 0) > 0}
          onClick={() => navigate('/portal/tickets?status=waiting_customer')}
        />
        <Kpi
          label="Gelöst (30 Tage)"
          value={data.kpis.resolvedLast30Days ?? 0}
          icon={<CheckCircle2 className="w-4 h-4" />}
          onClick={() => navigate('/portal/tickets?status=resolved')}
        />
        <Kpi
          label="Ø Reaktionszeit"
          value={data.kpis.avgResponseTime ?? '—'}
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Panel title="Aktuelle Firmen-Tickets">
            <TicketList tickets={data.tickets} navigate={navigate} />
          </Panel>
          {data.activity && data.activity.length > 0 && (
            <Panel title="Ticket-Aktivität (30 Tage)">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.activity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={4} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="created"
                      name="Erstellt"
                      stroke="#0F172A"
                      fill="#0F172A22"
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
            </Panel>
          )}
        </div>

        <div className="space-y-4">
          <Panel title="Mitarbeiter & Rollen">
            <dl className="space-y-2 text-sm">
              <Row label="Aktive Nutzer" value={data.team?.totalActive ?? 0} />
              <Row label="Kunden-Admins" value={data.team?.clientAdmins ?? 0} />
              <Row label="Kunden-Supporter" value={data.team?.clientSupporters ?? 0} />
              <Row label="Kunden-Benutzer" value={data.team?.clientUsers ?? 0} />
            </dl>
            <div className="flex flex-col gap-2 mt-4">
              <Button
                variant="outline"
                className="rounded-xl font-bold"
                onClick={() => navigate('/portal/members')}
              >
                <Users className="w-4 h-4 mr-2" /> Zum Team
              </Button>
              <Button
                className="rounded-xl font-bold bg-slate-900"
                onClick={() => navigate('/portal/members?invite=1')}
              >
                <Plus className="w-4 h-4 mr-2" /> Mitarbeiter einladen
              </Button>
            </div>
          </Panel>

          <Panel title="E-Mail & M365 Integration">
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center border',
                  data.email?.healthy
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                    : 'bg-amber-50 text-amber-600 border-amber-100',
                )}
              >
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">
                  {data.email?.configured
                    ? data.email.healthy
                      ? 'Send-As verbunden'
                      : 'Kanal konfiguriert — Prüfung nötig'
                    : 'Noch nicht eingerichtet'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {data.email?.mailbox || 'Kein Postfach verknüpft'}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="rounded-xl font-bold w-full mt-4"
              onClick={() => navigate('/portal/email')}
            >
              Integration verwalten
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ClientSupporterDashboard({
  data,
  navigate,
}: {
  data: PortalDashboardResponse;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto pb-20">
      <WelcomeHeader
        data={data}
        ctaLabel="+ Neues Ticket"
        onCreate={() => navigate('/portal/tickets/new')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi
          label="Offene Firmen-Tickets"
          value={data.kpis.openCompanyTickets ?? 0}
          icon={<Inbox className="w-4 h-4" />}
          onClick={() => navigate('/portal/tickets?status=open')}
        />
        <Kpi
          label="Wartet auf Kunden-IT"
          value={data.kpis.waitingOnClientIt ?? 0}
          icon={<Clock className="w-4 h-4" />}
          onClick={() => navigate('/portal/tickets?status=in_progress')}
        />
        <Kpi
          label="Meine Beteiligungen"
          value={data.kpis.myParticipations ?? 0}
          icon={<Users className="w-4 h-4" />}
        />
      </div>

      <Panel title="Offene Firmen-Tickets">
        <TicketList tickets={data.tickets} navigate={navigate} showRequester />
      </Panel>
    </div>
  );
}

function ClientUserDashboard({
  data,
  navigate,
}: {
  data: PortalDashboardResponse;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-3xl mx-auto pb-20">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          {data.organization.logoUrl ? (
            <img
              src={data.organization.logoUrl}
              alt=""
              className="w-12 h-12 rounded-2xl object-contain border border-slate-100"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-sm font-black">
              {data.organization.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Willkommen, {data.user.name || 'Nutzer'}
            </h1>
            <p className="text-sm text-slate-500">
              {data.organization.portalTitle || `${data.organization.name} ServiceDesk`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/portal/tickets/new')}
          className="w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 transition-colors p-6 text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <p className="text-base font-black text-slate-900">
                + Neues Support-Ticket erstellen
              </p>
              <p className="text-sm text-slate-500 mt-0.5">
                Melden Sie ein Problem oder stellen Sie eine Anfrage an Ihr IT-Team.
              </p>
            </div>
          </div>
        </button>
      </div>

      <Panel title="Meine offenen Tickets">
        <TicketList
          tickets={data.myOpenTickets || data.tickets}
          navigate={navigate}
          empty="Sie haben derzeit keine offenen Tickets."
        />
      </Panel>

      <Panel title="Kürzlich gelöste Tickets">
        <TicketList
          tickets={data.recentlyResolved || []}
          navigate={navigate}
          empty="Noch keine kürzlich gelösten Tickets."
        />
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 mb-4">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  onClick,
  danger,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-2xl border bg-white p-4 text-left shadow-sm',
        onClick && 'hover:-translate-y-0.5 hover:shadow-md transition-all cursor-pointer',
        danger ? 'border-rose-200' : 'border-slate-200',
      )}
    >
      <div className="flex items-center justify-between">
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
        {onClick && <ArrowUpRight className="w-3.5 h-3.5 text-slate-300" />}
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mt-3">
        {label}
      </p>
      <p
        className={cn(
          'text-2xl font-black mt-1',
          danger ? 'text-rose-600' : 'text-slate-900',
        )}
      >
        {value}
      </p>
    </Comp>
  );
}

function Row({ label, value }: { label: string; value: number }) {
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
    return <p className="text-sm text-slate-500 py-6 text-center">{empty}</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
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
                {showRequester && ticket.requesterName && (
                  <>
                    <span>{ticket.requesterName}</span>
                    <span className="text-slate-300">·</span>
                  </>
                )}
                <span>{formatRelativeTime(ticket.updatedAt, 'de')}</span>
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
