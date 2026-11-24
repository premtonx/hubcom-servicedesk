import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { MODULE_PAGE_PX } from '../ui/module-page/styles';

export interface TicketsHeaderStats {
  open: number;
  slaRisk?: number;
  pending?: number;
  urgent?: number;
  unassigned?: number;
  /** Total tickets in the current filtered view (for count pill). */
  total?: number;
}

interface TicketsPageHeaderProps {
  trailing?: ReactNode;
  className?: string;
  stats?: TicketsHeaderStats;
}

export function TicketsPageHeader({ trailing, className, stats }: TicketsPageHeaderProps) {
  const { t } = useTranslation();
  const total = stats?.total;

  return (
    <header
      className={cn(
        MODULE_PAGE_PX,
        'h-14 min-h-[3.5rem] max-h-14 flex items-center justify-between border-b border-slate-200/80 bg-white shrink-0',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <h1 className="text-base font-bold tracking-tight text-slate-900 shrink-0">
          {t('tickets.pageTitle', 'Tickets')}
        </h1>
        {typeof total === 'number' ? (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 tabular-nums shrink-0">
            {t('tickets.headerTotalCount', '{{count}} insgesamt').replace(
              '{{count}}',
              String(total),
            )}
          </span>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0 flex items-center gap-2">{trailing}</div> : null}
    </header>
  );
}
