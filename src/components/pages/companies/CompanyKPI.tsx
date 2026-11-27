import { Users, Laptop, Ticket, Package, CheckCircle2, FileText } from 'lucide-react';
import { useTranslation } from '../../../lib/context/I18nContext';
import type { CompanyKpiMetrics } from '../../../lib/company-kpi-metrics';
import { cn } from '../../../lib/utils';

interface CompanyKPIProps {
  metrics: CompanyKpiMetrics & {
    openReturnsCount?: number;
    contractStatusLabel?: string | null;
  };
  showReturns?: boolean;
}

export default function CompanyKPI({ metrics, showReturns = false }: CompanyKPIProps) {
  const { t } = useTranslation();

  const items: Array<{
    key: string;
    label: string;
    value: string | number;
    icon: typeof Users;
    tone: string;
  }> = [
    {
      key: 'contacts',
      label: t('companies.contacts', 'Kontakte'),
      value: metrics.contactsCount,
      icon: Users,
      tone: 'text-indigo-600 bg-indigo-500/10',
    },
    {
      key: 'tickets',
      label: t('companies.openTickets', 'Offene Tickets'),
      value: metrics.openTicketsCount,
      icon: Ticket,
      tone: 'text-rose-600 bg-rose-500/10',
    },
  ];

  if (showReturns) {
    items.push({
      key: 'returns',
      label: t('companies.returnsTab', 'Rücklieferungen'),
      value: metrics.openReturnsCount ?? 0,
      icon: Package,
      tone: 'text-amber-600 bg-amber-500/10',
    });
  }

  items.push(
    {
      key: 'assets',
      label: t('companies.assetOverview', 'Assets'),
      value: metrics.assetsCount ?? 0,
      icon: Laptop,
      tone: 'text-emerald-600 bg-emerald-500/10',
    },
    {
      key: 'sla',
      label: t('companies.slaPerf', 'SLA-Erfüllung'),
      value: metrics.slaPerformance || '—',
      icon: CheckCircle2,
      tone: 'text-sky-600 bg-sky-500/10',
    },
    {
      key: 'contract',
      label: t('companies.supportContract', 'Support-Vertrag'),
      value: metrics.contractStatusLabel || '—',
      icon: FileText,
      tone: 'text-violet-600 bg-violet-500/10',
    },
  );

  return (
    <div
      className={cn(
        'grid gap-2 rounded-2xl border border-muted-foreground/10 bg-background p-2',
        showReturns ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.key}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 min-w-0"
          >
            <div className={cn('p-1.5 rounded-lg shrink-0', item.tone)}>
              <Icon className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-foreground leading-none truncate">
                {item.value}
              </p>
              <p className="text-[10px] text-muted-foreground font-bold mt-0.5 truncate">
                {item.label}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
