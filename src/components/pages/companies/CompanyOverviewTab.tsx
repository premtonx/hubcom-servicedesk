import { useMemo } from 'react';
import {
  Sparkles,
  Activity,
  Laptop,
  Key,
  Clock,
  Server,
  Network,
  AppWindow,
  Cpu,
  Unlock,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import {
  HydratedCompany,
  buildCompanyActivityEvents,
  deriveTicketInsights,
  formatDateTimeDe,
} from './utils';
import { Ticket, VaultItem } from '../../../types';
import { useTranslation } from '../../../lib/context/I18nContext';

interface CompanyOverviewProps {
  company: HydratedCompany;
  ticketHistory: Ticket[];
  vaultItems?: VaultItem[];
  assetCounts?: {
    servers: number;
    workstations: number;
    network: number;
    applications: number;
    total: number;
  };
  onTabChange: (tab: string) => void;
  onOpenVaultClick: () => void;
  onViewAllTicketsClick: () => void;
}

export default function CompanyOverviewTab({
  company,
  ticketHistory,
  vaultItems = [],
  assetCounts,
  onTabChange,
  onOpenVaultClick,
  onViewAllTicketsClick,
}: CompanyOverviewProps) {
  const { t } = useTranslation();

  const formatTicketTime = (ticket: Ticket) => {
    if (!ticket.createdAt) return '—';
    if ((ticket.createdAt as any).toDate) {
      return formatDateTimeDe((ticket.createdAt as any).toDate());
    }
    return formatDateTimeDe(ticket.createdAt as any) || '—';
  };

  const displayTickets = useMemo(() => ticketHistory.slice(0, 5), [ticketHistory]);
  const insights = useMemo(() => deriveTicketInsights(ticketHistory), [ticketHistory]);
  const activity = useMemo(
    () =>
      buildCompanyActivityEvents({
        company,
        tickets: ticketHistory,
        vaultItems,
      }).slice(0, 5),
    [company, ticketHistory, vaultItems],
  );

  const assets = assetCounts || {
    servers: 0,
    workstations: 0,
    network: 0,
    applications: 0,
    total: 0,
  };
  const vaultByType = useMemo(() => {
    const counts = { credentials: 0, apiKeys: 0, certificates: 0, other: 0 };
    for (const item of vaultItems) {
      const st = String(item.metadata?.secretType || item.type || '').toLowerCase();
      if (st.includes('api')) counts.apiKeys += 1;
      else if (st.includes('cert') || st.includes('ssl') || st.includes('pem'))
        counts.certificates += 1;
      else if (st.includes('password') || st === 'secret') counts.credentials += 1;
      else counts.other += 1;
    }
    return counts;
  }, [vaultItems]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-6 lg:col-span-1">
        <Card className="border border-muted-foreground/10 shadow-xs rounded-2xl bg-background">
          <CardHeader className="pb-2">
            <h3 className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider">
              {t('companies.customerHealth', 'Kunden-Gesundheit')}
            </h3>
          </CardHeader>
          <CardContent className="space-y-4">
            {company.healthScore == null ? (
              <>
                <p className="text-2xl font-black text-foreground tracking-tight">—</p>
                <p className="text-xs text-muted-foreground font-semibold leading-relaxed">
                  {t(
                    'companies.healthNoData',
                    'Noch kein Health-Score für dieses Unternehmen — berechnet aus echten Ticket-/SLA-Daten, sobald vorhanden.',
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-foreground tracking-tight">
                    {company.healthScore}
                  </span>
                  <span className="text-muted-foreground/50 text-base font-bold">/ 100</span>
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-muted text-center">
              <div>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                  {t('companies.open', 'Offen')}
                </p>
                <p className="text-xs text-foreground font-extrabold mt-1">
                  {company.openTicketsCount}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                  {t('companies.escalations', 'Eskalationen')}
                </p>
                <p className="text-xs text-rose-500 font-extrabold mt-1">
                  {company.slaRisksCount}
                </p>
              </div>
            </div>

            <Button
              onClick={() => onTabChange('insights')}
              variant="outline"
              size="sm"
              className="w-full h-8 rounded-xl border-muted text-muted-foreground hover:text-foreground text-[10px] font-bold"
            >
              {t('companies.viewHealthReport', 'Vollständigen Bericht anzeigen')}
            </Button>
          </CardContent>
        </Card>

        <Card className="border border-indigo-500/20 bg-gradient-to-br from-indigo-500/[0.03] via-transparent to-transparent shadow-xs rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
              {t('companies.aiInsights', 'KI-Erkenntnisse')}
            </h3>
          </CardHeader>
          <CardContent className="space-y-4 text-xs font-semibold">
            {insights.topCategory || insights.automationHint ? (
              <div className="space-y-3 pt-1">
                {insights.topCategory ? (
                  <div className="flex items-center justify-between py-1 border-b border-muted">
                    <span className="text-muted-foreground">
                      {t('companies.topIssueCategory', 'Häufigste Kategorie')}
                    </span>
                    <span className="text-foreground font-extrabold text-right">
                      {insights.topCategory}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between py-1 border-b border-muted">
                  <span className="text-muted-foreground">
                    {t('companies.openTickets', 'Offene Tickets')}
                  </span>
                  <span className="text-foreground font-extrabold">{insights.openCount}</span>
                </div>
                {insights.automationHint ? (
                  <p className="text-indigo-600 font-extrabold text-[11px] leading-relaxed">
                    {insights.automationHint}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-muted-foreground leading-relaxed">
                {t(
                  'companies.aiEmpty',
                  'Noch keine KI-Erkenntnisse — benötigt aktive Tickets und konfigurierte KI.',
                )}
              </p>
            )}

            <Button
              onClick={() => onTabChange('insights')}
              variant="outline"
              size="sm"
              className="w-full h-8 rounded-xl border-indigo-200 bg-indigo-500/[0.02] hover:bg-indigo-500/[0.05] text-indigo-600 text-[10px] font-bold"
            >
              {t('companies.viewAllInsights', 'Alle Erkenntnisse anzeigen')}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <Card className="border border-muted-foreground/10 shadow-xs rounded-2xl bg-background">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-black text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              {t('companies.recentTickets', 'Kürzliche Tickets')}
            </CardTitle>
            <button
              onClick={onViewAllTicketsClick}
              className="text-xs font-bold text-primary hover:underline"
            >
              {t('companies.viewAllTickets', 'Alle Tickets anzeigen')}
            </button>
          </CardHeader>
          <CardContent className="p-0">
            {displayTickets.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-muted-foreground font-semibold">
                {t(
                  'companies.noTicketsForCompany',
                  'Noch keine Tickets für dieses Unternehmen.',
                )}
              </p>
            ) : (
              <div className="divide-y divide-muted">
                {displayTickets.map((tItem) => (
                  <div
                    key={tItem.id}
                    className="flex items-center justify-between px-5 py-3 hover:bg-muted/10 transition-colors select-none text-xs font-semibold"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-muted-foreground font-mono w-10">#{tItem.id}</span>
                      <span className="text-foreground font-black truncate max-w-[200px] md:max-w-xs">
                        {tItem.subject}
                      </span>
                      <Badge
                        className={`text-[8px] font-black uppercase px-2 h-4.5 border-none rounded ${
                          tItem.priority === 'urgent' || tItem.priority === 'high'
                            ? 'bg-rose-500/10 text-rose-500'
                            : tItem.priority === 'medium'
                              ? 'bg-amber-500/10 text-amber-500'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {tItem.priority}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-6 text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={`h-4.5 text-[8px] font-black uppercase border-none px-2 rounded ${
                          tItem.status === 'open'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : tItem.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-500'
                              : 'bg-slate-150 text-slate-500'
                        }`}
                      >
                        {tItem.status}
                      </Badge>
                      <span className="hidden md:inline text-right min-w-[100px] font-bold truncate">
                        {tItem.customerName || '—'}
                      </span>
                      <span className="text-right w-28 text-[10px]">
                        {formatTicketTime(tItem)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border border-muted-foreground/10 shadow-xs rounded-2xl bg-background">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-black text-foreground flex items-center gap-2">
                <Laptop className="w-4 h-4 text-emerald-500" />
                {t('companies.assetOverview', 'Asset-Übersicht')}
              </CardTitle>
              <button
                onClick={() => onTabChange('assets')}
                className="text-xs font-bold text-primary hover:underline"
              >
                {t('companies.viewAllAssets', 'Alle Assets anzeigen')}
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              {assets.total === 0 ? (
                <p className="text-xs text-muted-foreground font-semibold py-4 text-center">
                  {t('companies.noAssetsLinked', 'Noch keine Assets verknüpft.')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 pb-2">
                  {[
                    {
                      icon: Server,
                      color: 'text-indigo-500',
                      count: assets.servers,
                      label: t('companies.servers', 'Server'),
                    },
                    {
                      icon: Cpu,
                      color: 'text-emerald-500',
                      count: assets.workstations,
                      label: t('companies.workstations', 'Workstations'),
                    },
                    {
                      icon: Network,
                      color: 'text-amber-500',
                      count: assets.network,
                      label: t('companies.networkDevices', 'Netzwerkgeräte'),
                    },
                    {
                      icon: AppWindow,
                      color: 'text-purple-500',
                      count: assets.applications,
                      label: t('companies.applications', 'Anwendungen'),
                    },
                  ].map((row) => {
                    const Icon = row.icon;
                    return (
                      <div
                        key={row.label}
                        className="p-3 bg-muted/20 border border-muted rounded-xl text-center flex flex-col items-center"
                      >
                        <Icon className={`w-5 h-5 ${row.color}`} />
                        <span className="text-lg font-black mt-2 text-foreground">
                          {row.count}
                        </span>
                        <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider mt-0.5">
                          {row.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-muted-foreground/10 shadow-xs rounded-2xl bg-background">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-black text-foreground flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-500" />
                {t('companies.geistVaultSummary', 'Tresor-Übersicht')}
              </CardTitle>
              <button
                onClick={onOpenVaultClick}
                className="text-xs font-bold text-primary hover:underline flex items-center gap-1.5"
              >
                <Unlock className="w-3 h-3 text-primary" />
                {t('companies.openVault', 'Tresor öffnen')}
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              {vaultItems.length === 0 ? (
                <p className="text-xs text-muted-foreground font-semibold py-4 text-center">
                  {t(
                    'companies.noVaultEntries',
                    'Noch keine Tresor-Einträge für dieses Unternehmen.',
                  )}
                </p>
              ) : (
                <div className="space-y-2.5 text-xs font-semibold">
                  <div className="flex items-center justify-between py-1 border-b border-muted">
                    <span className="text-muted-foreground">
                      {t('companies.credentials', 'Zugangsdaten')}
                    </span>
                    <span className="text-foreground font-bold">{vaultByType.credentials}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-muted">
                    <span className="text-muted-foreground">
                      {t('companies.apiKeys', 'API-Schlüssel')}
                    </span>
                    <span className="text-foreground font-bold">{vaultByType.apiKeys}</span>
                  </div>
                  <div className="flex items-center justify-between py-1 border-b border-muted">
                    <span className="text-muted-foreground">
                      {t('companies.certificates', 'Zertifikate')}
                    </span>
                    <span className="text-foreground font-bold">{vaultByType.certificates}</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-muted-foreground">
                      {t('companies.otherEntries', 'Weitere Einträge')}
                    </span>
                    <span className="text-foreground font-bold">{vaultByType.other}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border border-muted-foreground/10 shadow-xs rounded-2xl bg-background">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-black text-foreground flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-500" />
              {t('companies.activityTimeline', 'Aktivitätschronik')}
            </CardTitle>
            <button
              onClick={() => onTabChange('activity')}
              className="text-xs font-bold text-primary hover:underline"
            >
              {t('companies.viewAllActivity', 'Alle Aktivitäten anzeigen')}
            </button>
          </CardHeader>
          <CardContent className="space-y-4">
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground font-semibold py-6 text-center">
                {t('companies.noActivity', 'Noch keine Aktivitäten protokolliert.')}
              </p>
            ) : (
              <div className="relative pl-5 border-l-2 border-muted space-y-4">
                {activity.map((ev, idx) => (
                  <div key={`${ev.title}-${idx}`} className="relative">
                    <div
                      className={`absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full border-4 border-background ${ev.color}`}
                    />
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground font-bold">
                        {ev.time}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-foreground mt-1">{ev.title}</p>
                    <p className="text-[11px] text-muted-foreground font-semibold">{ev.desc}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
