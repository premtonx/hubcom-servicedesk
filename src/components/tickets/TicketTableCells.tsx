import React, { useState } from 'react';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Avatar, AvatarFallback } from '../ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { TicketPriority, TicketStatus } from '../../types';
import { useTranslation } from '../../lib/context/I18nContext';
import { getInitials, safeString } from '../../lib/utils';
import { TICKET_DISPATCH_AGENTS } from '../../lib/ticketDispatchAgents';
import { SELECTABLE_TICKET_STATUSES, isReadonlyTerminalStatus } from '../../lib/ticket-status';
import type { TicketCategory } from '../../lib/ticket-categories/types';

const DEFAULT_CATEGORY_COLOR = '#1B6CA8';

export function resolveTicketCategoryColor(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  categories: TicketCategory[],
): string {
  if (categoryId) {
    const byId = categories.find((c) => c.id === categoryId);
    if (byId?.color) return byId.color;
  }
  if (categoryName) {
    const byName = categories.find((c) => c.name === categoryName);
    if (byName?.color) return byName.color;
  }
  return DEFAULT_CATEGORY_COLOR;
}

const STATUS_STYLES: Record<string, { pill: string; dot: string }> = {
  open: { pill: 'bg-blue-50 text-blue-700 border-blue-100', dot: 'bg-blue-500' },
  pending: { pill: 'bg-violet-50 text-violet-700 border-violet-100', dot: 'bg-violet-500' },
  resolved: { pill: 'bg-emerald-50 text-emerald-700 border-emerald-100', dot: 'bg-emerald-500' },
  closed: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  merged: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  trash: { pill: 'bg-rose-50 text-rose-700 border-rose-100', dot: 'bg-rose-500' },
  deleted: { pill: 'bg-rose-50 text-rose-700 border-rose-100', dot: 'bg-rose-500' },
  'on-hold': { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  on_hold: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  paused: { pill: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
  qs: { pill: 'bg-purple-50 text-purple-700 border-purple-100', dot: 'bg-purple-500' },
  in_progress: { pill: 'bg-indigo-50 text-indigo-700 border-indigo-100', dot: 'bg-indigo-500' },
  waiting_customer: { pill: 'bg-amber-50 text-amber-800 border-amber-100', dot: 'bg-amber-500' },
  waiting_dev: { pill: 'bg-orange-50 text-orange-700 border-orange-100', dot: 'bg-orange-500' },
  waiting_vendor: { pill: 'bg-yellow-50 text-yellow-800 border-yellow-100', dot: 'bg-yellow-500' },
};

const STATUS_OPTIONS: TicketStatus[] = SELECTABLE_TICKET_STATUSES;

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-slate-400',
};

interface TicketStatusChipProps {
  status: string;
  onChange: (status: TicketStatus) => void;
}

export function TicketStatusChip({ status, onChange }: TicketStatusChipProps) {
  const { t } = useTranslation();
  const key = status?.toLowerCase() ?? 'open';
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.open;
  const label = t(`tickets.statusLabels.${key}`, t(`tickets.status.${key}`, key));

  if (isReadonlyTerminalStatus(key)) {
    return (
      <span
        title={t('tickets.merge.readonlyMerged', 'Zusammengeführt — nur lesbar')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold max-w-full',
          style.pill,
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dot)} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-90 max-w-full',
              style.pill,
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dot)} aria-hidden />
            <span className="truncate">+ {label}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-40 rounded-lg">
        {STATUS_OPTIONS.map((s) => (
          <DropdownMenuItem key={s} className="text-xs capitalize" onClick={() => onChange(s)}>
            {t(`tickets.statusLabels.${s}`, t(`tickets.status.${s}`, s))}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TicketPriorityChipProps {
  priority: string;
  onChange: (priority: TicketPriority) => void;
}

export function TicketPriorityChip({ priority, onChange }: TicketPriorityChipProps) {
  const { t } = useTranslation();
  const key = priority?.toLowerCase() ?? 'medium';
  const dot = PRIORITY_DOT[key] ?? PRIORITY_DOT.medium;
  const label = t(`tickets.priority.${key}`, key);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 transition-colors rounded-md px-1 py-0.5 max-w-full"
          >
            <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} aria-hidden />
            <span className="truncate">{label}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-36 rounded-lg">
        {(['low', 'medium', 'high', 'urgent'] as TicketPriority[]).map((p) => (
          <DropdownMenuItem key={p} className="text-xs capitalize" onClick={() => onChange(p)}>
            {t(`tickets.priority.${p}`, p)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TicketAssigneeChipProps {
  agentId?: string | null;
  agentName?: string | null;
  currentUserId?: string;
  currentUserLabel?: string;
  onChange: (agentId: string | null | undefined, agentName: string | null | undefined) => void;
}

const AGENT_OPTIONS = TICKET_DISPATCH_AGENTS;

export function TicketAssigneeChip({
  agentId,
  agentName,
  currentUserId,
  currentUserLabel,
  onChange,
}: TicketAssigneeChipProps) {
  const { t } = useTranslation();
  const display = safeString(agentName, t('tickets.unassigned', 'Unassigned'));
  const initial = getInitials(display);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 max-w-[130px] text-[11px] font-medium text-slate-700 hover:bg-slate-50 rounded-md px-1 py-0.5 transition-colors"
          >
            <Avatar className="h-5 w-5 border border-slate-200 shrink-0">
              <AvatarFallback className="text-[8px] font-bold bg-slate-100">{initial}</AvatarFallback>
            </Avatar>
            <span className="truncate">{display}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-44 rounded-lg">
        <DropdownMenuItem className="text-xs" onClick={() => onChange(null, null)}>
          {t('tickets.unassigned', 'Unassigned')}
        </DropdownMenuItem>
        {currentUserId ? (
          <DropdownMenuItem className="text-xs" onClick={() => onChange(currentUserId, currentUserLabel)}>
            {t('tickets.assigneeYourself', 'Yourself')}
          </DropdownMenuItem>
        ) : null}
        {AGENT_OPTIONS.map((a) => (
          <DropdownMenuItem key={a.id} className="text-xs" onClick={() => onChange(a.id, a.name)}>
            {a.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type TicketCategoryPatch = {
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
};

interface TicketCategoryChipProps {
  categoryId?: string | null;
  categoryName?: string | null;
  categories: TicketCategory[];
  disabled?: boolean;
  onChange: (patch: TicketCategoryPatch) => void | Promise<void>;
}

/** Compact colored category chip — same label/colour mapping as ticket detail. */
export function TicketCategoryChip({
  categoryId,
  categoryName,
  categories,
  disabled,
  onChange,
}: TicketCategoryChipProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label =
    (categoryName && String(categoryName).trim()) ||
    t('tickets.sidebar.noCategory', 'Keine Kategorie');
  const hasCategory = Boolean(categoryId || (categoryName && String(categoryName).trim()));
  const color = resolveTicketCategoryColor(categoryId, categoryName, categories);
  const ariaLabel = t('tickets.table.categoryAria', 'Kategorie: {{name}}').replace(
    '{{name}}',
    label,
  );

  const apply = async (patch: TicketCategoryPatch) => {
    if (saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onChange(patch);
    } catch (err: any) {
      setError(
        err?.message ||
          t('tickets.table.categoryUpdateFailed', 'Kategorie konnte nicht gespeichert werden.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-1 max-w-full min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={saving || disabled}
          render={
            <button
              type="button"
              aria-label={ariaLabel}
              aria-busy={saving || undefined}
              aria-invalid={error ? true : undefined}
              title={error || label}
              disabled={saving || disabled}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold max-w-full transition-opacity',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1',
                'disabled:opacity-60 disabled:cursor-not-allowed',
                hasCategory ? 'text-white' : 'text-slate-600 border border-slate-200 bg-slate-50',
              )}
              style={hasCategory ? { backgroundColor: color } : undefined}
            >
              {saving ? (
                <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden />
              ) : null}
              <span className="truncate">{label}</span>
              <ChevronDown
                className={cn('w-3 h-3 shrink-0', hasCategory ? 'opacity-80' : 'opacity-40')}
                aria-hidden
              />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-52 rounded-lg max-h-64 overflow-y-auto">
          <DropdownMenuItem
            className="text-xs"
            disabled={saving}
            onClick={() =>
              void apply({ categoryId: null, categoryName: null, categorySlug: null })
            }
          >
            {t('tickets.sidebar.noCategory', 'Keine Kategorie')}
          </DropdownMenuItem>
          {categories.map((cat) => (
            <DropdownMenuItem
              key={cat.id}
              className="text-xs"
              disabled={saving}
              onClick={() =>
                void apply({
                  categoryId: cat.id,
                  categoryName: cat.name,
                  categorySlug: cat.slug,
                })
              }
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0 mr-2"
                style={{ backgroundColor: cat.color || DEFAULT_CATEGORY_COLOR }}
                aria-hidden
              />
              {cat.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span className="inline-flex items-center text-rose-600" title={error} role="alert">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="sr-only">{error}</span>
        </span>
      ) : null}
    </div>
  );
}
