/**
 * Custom Gerätetyp dropdown with lucide icons in trigger + every option row.
 * Used by ReturnEditorPage and ReturnsInlineEditors (DeviceSerialPopover).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Check,
  ChevronDown,
  Gauge,
  HardDrive,
  Keyboard,
  Laptop,
  Package,
  Plug,
  ScanBarcode,
  Search,
  Tablet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export const DEVICE_TYPE_EMPTY_LABEL = '— Keine Auswahl —';

export type DeviceTypeIconTone =
  | 'amber'
  | 'blue'
  | 'indigo'
  | 'cyan'
  | 'slate'
  | 'emerald'
  | 'violet'
  | 'muted';

const TONE_CLASS: Record<DeviceTypeIconTone, string> = {
  amber: 'text-amber-600',
  blue: 'text-sky-600',
  indigo: 'text-indigo-600',
  cyan: 'text-cyan-600',
  slate: 'text-slate-600',
  emerald: 'text-emerald-600',
  violet: 'text-violet-600',
  muted: 'text-slate-400',
};

export function resolveDeviceTypeVisual(deviceType: string): {
  Icon: LucideIcon;
  tone: DeviceTypeIconTone;
} {
  const t = String(deviceType || '').trim().toLowerCase();
  if (!t) return { Icon: Package, tone: 'muted' };
  if (/secutest|profitest|prüfgerät|pruefgeraet|messgerät|messgeraet|mxtra|gossen/.test(t)) {
    return { Icon: /profitest/.test(t) ? Gauge : Zap, tone: /profitest/.test(t) ? 'blue' : 'amber' };
  }
  if (/adapter|prcd|vl2e|\bbt\b/.test(t)) return { Icon: Plug, tone: 'indigo' };
  if (/tablet|getac|winmate/.test(t)) return { Icon: Tablet, tone: 'cyan' };
  if (/laptop|notebook|lenovo/.test(t) && !/dock|lade/.test(t)) {
    return { Icon: Laptop, tone: 'slate' };
  }
  if (/dockingstation|docking|ladestation|dock\b/.test(t)) {
    return { Icon: HardDrive, tone: 'emerald' };
  }
  if (/tastatur|keyboard/.test(t)) return { Icon: Keyboard, tone: 'slate' };
  if (/scanner|barcode/.test(t)) return { Icon: ScanBarcode, tone: 'violet' };
  return { Icon: Package, tone: 'muted' };
}

export function DeviceTypeSelect({
  value,
  onChange,
  options,
  placeholder = DEVICE_TYPE_EMPTY_LABEL,
  disabled = false,
  className,
  triggerClassName,
  size = 'md',
  id,
  'aria-label': ariaLabel = 'Gerätetyp',
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  size?: 'sm' | 'md';
  id?: string;
  'aria-label'?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const items = useMemo(() => {
    const uniq = Array.from(new Set(options.map((o) => String(o || '').trim()).filter(Boolean)));
    if (value && !uniq.includes(value)) uniq.unshift(value);
    return uniq;
  }, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((o) => o.toLowerCase().includes(q));
  }, [items, query]);

  const showSearch = items.length >= 8;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setHighlight(0);
  }, []);

  const selectValue = useCallback(
    (next: string) => {
      onChange(next);
      close();
    },
    [onChange, close],
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      filtered.findIndex((o) => o === value),
    );
    setHighlight(idx === -1 ? 0 : idx);
    const t = window.setTimeout(() => {
      if (showSearch) searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, filtered, value, showSearch]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const selectedVisual = resolveDeviceTypeVisual(value);
  const SelectedIcon = selectedVisual.Icon;
  const selectedLabel = value || placeholder;

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight === 0) selectValue('');
      else if (filtered[highlight - 1]) selectValue(filtered[highlight - 1]!);
    }
  };

  const sm = size === 'sm';

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white text-left transition',
          'hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          sm ? 'h-8 px-2 text-xs' : 'h-11 px-3 text-sm',
          triggerClassName,
        )}
      >
        <SelectedIcon
          className={cn(
            'shrink-0',
            sm ? 'w-3.5 h-3.5' : 'w-4 h-4',
            TONE_CLASS[selectedVisual.tone],
          )}
          aria-hidden
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate font-medium',
            value ? 'text-slate-900' : 'text-slate-400',
          )}
        >
          {selectedLabel}
        </span>
        <ChevronDown
          className={cn(
            'shrink-0 text-slate-400 transition',
            sm ? 'w-3.5 h-3.5' : 'w-4 h-4',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          onKeyDown={onListKeyDown}
          className={cn(
            'absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg',
            'ring-1 ring-black/5',
          )}
        >
          {showSearch ? (
            <div className="border-b border-slate-100 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlight(0);
                  }}
                  placeholder="Gerätetyp suchen…"
                  className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-100"
                />
              </div>
            </div>
          ) : null}

          <div className="max-h-64 overflow-y-auto py-1">
            <OptionRow
              dataIdx={0}
              highlighted={highlight === 0}
              selected={!value}
              label={placeholder}
              Icon={Package}
              tone="muted"
              size={size}
              onHover={() => setHighlight(0)}
              onSelect={() => selectValue('')}
            />
            {filtered.map((opt, i) => {
              const visual = resolveDeviceTypeVisual(opt);
              const idx = i + 1;
              return (
                <OptionRow
                  key={opt}
                  dataIdx={idx}
                  highlighted={highlight === idx}
                  selected={value === opt}
                  label={opt}
                  Icon={visual.Icon}
                  tone={visual.tone}
                  size={size}
                  onHover={() => setHighlight(idx)}
                  onSelect={() => selectValue(opt)}
                />
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs font-medium text-slate-400">
                Keine Treffer
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OptionRow({
  dataIdx,
  highlighted,
  selected,
  label,
  Icon,
  tone,
  size,
  onHover,
  onSelect,
}: {
  dataIdx: number;
  highlighted: boolean;
  selected: boolean;
  label: string;
  Icon: LucideIcon;
  tone: DeviceTypeIconTone;
  size: 'sm' | 'md';
  onHover: () => void;
  onSelect: () => void;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-idx={dataIdx}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 text-left transition',
        sm ? 'py-1.5 text-xs' : 'py-2 text-sm',
        highlighted ? 'bg-sky-50' : 'bg-white hover:bg-slate-50',
        selected && 'font-semibold text-slate-900',
      )}
    >
      <Icon
        className={cn('shrink-0', sm ? 'w-3.5 h-3.5' : 'w-4 h-4', TONE_CLASS[tone])}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-slate-800">{label}</span>
      {selected ? <Check className="w-3.5 h-3.5 shrink-0 text-sky-600" aria-hidden /> : null}
    </button>
  );
}
