import { type ReactNode } from 'react';
import { Columns3, LayoutGrid, List } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ReturnsLayoutMode = 'list' | 'kanban' | 'cards';

interface ReturnsViewModeSelectorProps {
  value: ReturnsLayoutMode;
  onChange: (mode: ReturnsLayoutMode) => void;
  className?: string;
}

const MODES: { id: ReturnsLayoutMode; icon: ReactNode; label: string }[] = [
  { id: 'list', icon: <List className="w-3.5 h-3.5" />, label: 'Liste' },
  { id: 'kanban', icon: <Columns3 className="w-3.5 h-3.5" />, label: 'Kanban' },
  { id: 'cards', icon: <LayoutGrid className="w-3.5 h-3.5" />, label: 'Karten' },
];

/** Segmented Liste | Kanban | Karten toggle — matches Tickets view switcher style. */
export function ReturnsViewModeSelector({
  value,
  onChange,
  className,
}: ReturnsViewModeSelectorProps) {
  return (
    <div
      className={cn(
        'inline-flex h-8 items-center rounded-md border border-slate-200/80 bg-slate-50/80 p-0.5 shrink-0',
        className,
      )}
      role="group"
      aria-label="Ansicht"
    >
      {MODES.map((mode) => {
        const active = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            title={mode.label}
            onClick={() => onChange(mode.id)}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors',
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {mode.icon}
            <span className="hidden md:inline">{mode.label}</span>
          </button>
        );
      })}
    </div>
  );
}
