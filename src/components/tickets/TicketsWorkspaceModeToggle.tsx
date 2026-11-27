/**
 * Segmented Klassisch | Outlook toggle for the ticket workspace.
 */

import { Columns2, LayoutList } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import type { TicketWorkspaceMode } from '../../lib/tickets/ticket-workspace-mode';

export type TicketsWorkspaceModeToggleProps = {
  value: TicketWorkspaceMode;
  onChange: (mode: TicketWorkspaceMode) => void;
  /** Compact icon-only for the Outlook rail header. */
  compact?: boolean;
  className?: string;
};

const MODES: Array<{
  id: TicketWorkspaceMode;
  labelKey: string;
  defaultLabel: string;
  icon: typeof LayoutList;
}> = [
  {
    id: 'classic',
    labelKey: 'tickets.workspace.classic',
    defaultLabel: 'Klassisch',
    icon: LayoutList,
  },
  {
    id: 'outlook',
    labelKey: 'tickets.workspace.outlook',
    defaultLabel: 'Outlook',
    icon: Columns2,
  },
];

export function TicketsWorkspaceModeToggle({
  value,
  onChange,
  compact = false,
  className,
}: TicketsWorkspaceModeToggleProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'inline-flex h-8 items-center rounded-md border border-slate-200/80 bg-slate-50/80 p-0.5 shrink-0',
        className,
      )}
      role="group"
      aria-label={t('tickets.workspace.mode', 'Arbeitsbereich')}
    >
      {MODES.map((mode) => {
        const active = value === mode.id;
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            title={t(mode.labelKey, mode.defaultLabel)}
            aria-pressed={active}
            onClick={() => onChange(mode.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              compact && 'px-1.5',
            )}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {!compact ? (
              <span className="hidden sm:inline">{t(mode.labelKey, mode.defaultLabel)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
