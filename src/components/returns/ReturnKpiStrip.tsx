/**
 * Shared 3-zone interactive Rücklieferungen KPI strip.
 * Used on /portal/dashboard, /portal/returns, and staff /returns.
 */

import {
  AlertTriangle,
  ArrowRight,
  Package,
  PackageCheck,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  emptyHardwareReturnsKpis,
  formatReturnKpiDelta,
  type HardwareReturnsKpiCounts,
} from '../../lib/client-portal/hardware-returns-kpis';

export type ReturnKpiFilterId = 'open' | 'overdue' | 'escalated' | 'returned';

export interface ReturnKpiStripProps {
  kpis: Partial<HardwareReturnsKpiCounts> | null | undefined;
  /** Currently active filter (workbench); ignored on dashboard. */
  activeFilter?: ReturnKpiFilterId | null;
  onSelect: (filter: ReturnKpiFilterId) => void;
  loading?: boolean;
  className?: string;
}

const DELTA_TONE: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-700 border-sky-100',
  rose: 'bg-rose-50 text-rose-700 border-rose-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  slate: 'bg-slate-50 text-slate-500 border-slate-100',
};

const ACTIVE_RING: Record<ReturnKpiFilterId, string> = {
  open: 'ring-2 ring-sky-400 border-sky-300',
  overdue: 'ring-2 ring-rose-400 border-rose-300',
  escalated: 'ring-2 ring-violet-400 border-violet-300',
  returned: 'ring-2 ring-emerald-400 border-emerald-300',
};

const ICON_WRAP: Record<ReturnKpiFilterId, string> = {
  open: 'bg-sky-50 text-sky-700 border-sky-100',
  overdue: 'bg-rose-50 text-rose-700 border-rose-100',
  escalated: 'bg-violet-50 text-violet-700 border-violet-100',
  returned: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

const ARROW_WRAP: Record<ReturnKpiFilterId, string> = {
  open: 'bg-sky-50 text-sky-600',
  overdue: 'bg-rose-50 text-rose-600',
  escalated: 'bg-violet-50 text-violet-600',
  returned: 'bg-emerald-50 text-emerald-600',
};

function normalizeKpis(
  raw: Partial<HardwareReturnsKpiCounts> | null | undefined,
): HardwareReturnsKpiCounts {
  const z = emptyHardwareReturnsKpis();
  if (!raw) return z;
  return {
    open: Number(raw.open) || 0,
    overdue: Number(raw.overdue) || 0,
    stage3: Number(raw.stage3) || 0,
    returnedLast30: Number(raw.returnedLast30) || 0,
    openAddedLast7d: Number(raw.openAddedLast7d) || 0,
    overdueAddedToday: Number(raw.overdueAddedToday) || 0,
    overdueAddedLast7d: Number(raw.overdueAddedLast7d) || 0,
    escalatedLast7d: Number(raw.escalatedLast7d) || 0,
    returnedLast7d: Number(raw.returnedLast7d) || 0,
  };
}

export function ReturnKpiStrip({
  kpis: rawKpis,
  activeFilter = null,
  onSelect,
  loading = false,
  className,
}: ReturnKpiStripProps) {
  const kpis = normalizeKpis(rawKpis);
  const cards: Array<{
    id: ReturnKpiFilterId;
    label: string;
    value: number;
    Icon: typeof Package;
    deltaKind: 'open' | 'overdue' | 'escalated' | 'returned';
  }> = [
    {
      id: 'open',
      label: 'Offene Rücklieferungen',
      value: kpis.open,
      Icon: Package,
      deltaKind: 'open',
    },
    {
      id: 'overdue',
      label: 'Überfällig',
      value: kpis.overdue,
      Icon: AlertTriangle,
      deltaKind: 'overdue',
    },
    {
      id: 'escalated',
      label: 'Letzte Stufe / Eskaliert (4.+ Erinnerung)',
      value: kpis.stage3,
      Icon: ShieldAlert,
      deltaKind: 'escalated',
    },
    {
      id: 'returned',
      label: 'Zurückgeliefert (30 Tage)',
      value: kpis.returnedLast30,
      Icon: PackageCheck,
      deltaKind: 'returned',
    },
  ];

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3', className)}>
      {cards.map((card) => {
        const Icon = card.Icon;
        const delta = formatReturnKpiDelta(card.deltaKind, kpis);
        const active = activeFilter === card.id;
        return (
          <button
            key={card.id}
            type="button"
            title={card.label}
            onClick={() => onSelect(card.id)}
            className={cn(
              'group cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md',
              'rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm',
              'flex items-center gap-3 w-full',
              active && ACTIVE_RING[card.id],
            )}
          >
            <span
              className={cn(
                'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border',
                ICON_WRAP[card.id],
              )}
            >
              <Icon className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className="text-xs font-semibold text-slate-600 truncate"
                title={card.label}
              >
                {card.label}
              </p>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span
                  className={cn(
                    'text-2xl font-bold text-slate-900 tabular-nums leading-none',
                    loading && 'animate-pulse',
                  )}
                >
                  {card.value}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
                    DELTA_TONE[delta.tone],
                    loading && 'animate-pulse',
                  )}
                >
                  {delta.label}
                </span>
              </div>
            </div>
            <span
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5',
                ARROW_WRAP[card.id],
              )}
              aria-hidden
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Map dashboard/workbench URL filter token → ReturnKpiFilterId. */
export function parseReturnKpiFilterParam(
  raw: string | null | undefined,
): ReturnKpiFilterId | null {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'open' || v === 'overdue' || v === 'escalated' || v === 'returned') {
    return v;
  }
  if (v === 'done') return 'returned';
  return null;
}

/** Build portal returns deep-link for a KPI card. */
export function returnKpiFilterHref(filter: ReturnKpiFilterId): string {
  return `/portal/returns?filter=${encodeURIComponent(filter)}`;
}
