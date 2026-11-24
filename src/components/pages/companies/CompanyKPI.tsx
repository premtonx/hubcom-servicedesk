import { Users, Laptop, Ticket, Key, CheckCircle2, Coins } from 'lucide-react';
import { Card, CardContent } from '../../ui/card';
import { useTranslation } from '../../../lib/context/I18nContext';
import type { CompanyKpiMetrics } from '../../../lib/company-kpi-metrics';

interface CompanyKPIProps {
  metrics: CompanyKpiMetrics;
}

export default function CompanyKPI({ metrics }: CompanyKPIProps) {
  const { t } = useTranslation();

  const kpis: Array<{
    title: string;
    value: string | number;
    label: string;
    icon: typeof Users;
    iconColor: string;
    trend: string | null;
    trendMuted?: boolean;
  }> = [
    {
      title: 'Users',
      value: metrics.contactsCount,
      label: t('companies.contacts', 'Kontakte'),
      icon: Users,
      iconColor: 'text-indigo-500 bg-indigo-500/5',
      trend:
        metrics.contactsCount === 0
          ? t('companies.noDataYet', 'Noch keine Daten')
          : null,
      trendMuted: true,
    },
    {
      title: 'Assets',
      value: metrics.assetsCount ?? 0,
      label: t('companies.assetOverview', 'Assets'),
      icon: Laptop,
      iconColor: 'text-[#34A853] bg-[#34A853]/5',
      trend:
        (metrics.assetsCount ?? 0) === 0
          ? t('companies.noDataYet', 'Noch keine Daten')
          : null,
      trendMuted: true,
    },
    {
      title: 'Open Tickets',
      value: metrics.openTicketsCount,
      label: `${t('companies.open', 'Open')} ${t('nav.tickets', 'Tickets')}`,
      icon: Ticket,
      iconColor: 'text-rose-500 bg-rose-500/5',
      trend:
        metrics.slaRisksCount > 0
          ? `${t('companies.slaRiskFilter', 'SLA risk')}: ${metrics.slaRisksCount}`
          : t('companies.noImmediateRisks', 'No immediate risks'),
      trendMuted: metrics.slaRisksCount === 0,
    },
    {
      title: 'Vault Entries',
      value: metrics.vaultEntriesCount ?? 0,
      label: t('companies.geistVaultSummary', 'Vault Entries'),
      icon: Key,
      iconColor: 'text-amber-500 bg-amber-500/5',
      trend:
        (metrics.vaultEntriesCount ?? 0) === 0
          ? t('companies.noDataYet', 'Noch keine Daten')
          : null,
      trendMuted: true,
    },
    {
      title: 'SLA Performance',
      value: metrics.slaPerformance ?? '—',
      label: t('companies.slaPerf', 'SLA Performance'),
      icon: CheckCircle2,
      iconColor: 'text-emerald-500 bg-emerald-500/5',
      trend: metrics.slaPerformance
        ? null
        : t('companies.noSlaData', 'Keine SLA-Daten für dieses Unternehmen'),
      trendMuted: true,
    },
    {
      title: 'Monthly Spend',
      value: metrics.monthlySpend ?? '—',
      label: t('companies.monthlySpend', 'Monthly Spend'),
      icon: Coins,
      iconColor: 'text-purple-500 bg-purple-500/5',
      trend: metrics.monthlySpend
        ? null
        : t('companies.noSpendData', 'Kein Umsatz hinterlegt'),
      trendMuted: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3.5">
      {kpis.map((kpi) => {
        const Icon = kpi.icon;
        return (
          <Card
            key={kpi.title}
            className="border border-muted-foreground/10 hover:border-primary/25 cursor-default hover:shadow-md transition-all rounded-2xl bg-background overflow-hidden select-none"
          >
            <CardContent className="p-4 flex flex-col justify-between h-full gap-2.5">
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-xl shrink-0 ${kpi.iconColor}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>

              <div>
                <p className="text-xl font-black text-foreground tracking-tight leading-none">
                  {kpi.value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 font-extrabold uppercase tracking-wider">
                  {kpi.label}
                </p>
              </div>

              {kpi.trend ? (
                <div
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${
                    kpi.trendMuted
                      ? 'text-slate-500 bg-slate-50'
                      : 'text-amber-700 bg-amber-50'
                  }`}
                >
                  {kpi.trend}
                </div>
              ) : (
                <div className="h-5" />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
