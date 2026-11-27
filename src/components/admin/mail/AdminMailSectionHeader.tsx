import type { LucideIcon } from 'lucide-react';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';

interface AdminMailSectionHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** When provided, overrides live status pill. */
  statusActive?: boolean | null;
  statusLabel?: string | null;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  statusSlotId?: string;
  className?: string;
}

export function AdminMailSectionHeader({
  icon: Icon,
  title,
  subtitle,
  statusActive,
  statusLabel,
  primaryActionLabel,
  onPrimaryAction,
  statusSlotId,
  className,
}: AdminMailSectionHeaderProps) {
  const showStatus = statusActive !== undefined && statusActive !== null;
  const active = Boolean(statusActive);
  const label =
    statusLabel ||
    (showStatus ? (active ? 'Aktiv' : 'Inaktiv') : null);

  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 flex flex-wrap items-center gap-4 shadow-sm',
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-black tracking-tight text-slate-900 truncate">{title}</h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5 line-clamp-2">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap justify-end">
        <span
          id={statusSlotId}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
            !showStatus
              ? 'bg-slate-100 text-slate-500'
              : active
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600',
          )}
        >
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              !showStatus ? 'bg-slate-400' : active ? 'bg-emerald-500' : 'bg-slate-400',
            )}
          />
          {label || '—'}
        </span>
        <Button
          type="button"
          size="sm"
          className="h-9 rounded-xl font-bold text-xs gap-1.5"
          onClick={onPrimaryAction}
        >
          {primaryActionLabel}
        </Button>
      </div>
    </div>
  );
}
