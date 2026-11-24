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
import { isReadonlyTerminalStatus } from '../../lib/ticket-status';
import type { TicketCategory } from '../../lib/ticket-categories/types';
import type { TicketPriorityConfig, TicketStatusConfig } from '../../lib/ticket-config/types';
import {
  resolvePriorityConfig,
  resolveStatusConfig,
  selectablePrioritiesForValue,
  selectableStatusesForValue,
  softTintStyles,
} from '../../lib/ticket-config/display';
import { useTicketStatuses } from '../../hooks/useTicketStatuses';
import { useTicketPriorities } from '../../hooks/useTicketPriorities';

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

interface TicketStatusChipProps {
  status: string;
  onChange: (status: TicketStatus) => void;
  /** Optional override; defaults to admin-configured statuses from Ticket Configuration. */
  statuses?: TicketStatusConfig[];
}

export function TicketStatusChip({ status, onChange, statuses: statusesProp }: TicketStatusChipProps) {
  const { t } = useTranslation();
  const { statuses: loadedStatuses } = useTicketStatuses();
  const statuses = statusesProp ?? loadedStatuses;
  const resolved = resolveStatusConfig(status, statuses);
  const options = selectableStatusesForValue(status, statuses);
  const tint = softTintStyles(resolved.color);
  const label = resolved.name;

  if (isReadonlyTerminalStatus(resolved.key)) {
    return (
      <span
        title={t('tickets.merge.readonlyMerged', 'Zusammengeführt — nur lesbar')}
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold max-w-full"
        style={tint}
      >
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: resolved.color }}
          aria-hidden
        />
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
            title={
              resolved.isActive
                ? label
                : t('tickets.statusInactiveHint', '{{label}} (inaktiv — noch auf Tickets vorhanden)').replace(
                    '{{label}}',
                    label,
                  )
            }
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors hover:opacity-90 max-w-full"
            style={tint}
          >
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: resolved.color }}
              aria-hidden
            />
            <span className="truncate">{label}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-48 rounded-lg">
        {options.map((s) => (
          <DropdownMenuItem
            key={s.id || s.key}
            className="text-xs gap-2"
            onClick={() => onChange(s.key as TicketStatus)}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="truncate">{s.name}</span>
            {!s.isActive ? (
              <span className="text-[9px] uppercase text-slate-400 font-bold ml-auto">inaktiv</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TicketPriorityChipProps {
  priority: string;
  onChange: (priority: TicketPriority) => void;
  priorities?: TicketPriorityConfig[];
}

export function TicketPriorityChip({
  priority,
  onChange,
  priorities: prioritiesProp,
}: TicketPriorityChipProps) {
  const { t } = useTranslation();
  const { priorities: loadedPriorities } = useTicketPriorities();
  const priorities = prioritiesProp ?? loadedPriorities;
  const resolved = resolvePriorityConfig(priority, priorities);
  const options = selectablePrioritiesForValue(priority, priorities);
  const label = resolved.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={label}
            title={
              resolved.isActive
                ? label
                : t(
                    'tickets.priorityInactiveHint',
                    '{{label}} (inaktiv — noch auf Tickets vorhanden)',
                  ).replace('{{label}}', label)
            }
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900 transition-colors rounded-md px-1 py-0.5 max-w-full"
          >
            <span
              className="h-2 w-2 rounded-full shrink-0 border border-black/5"
              style={{ backgroundColor: resolved.color }}
              aria-hidden
            />
            <span className="truncate">{label}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-44 rounded-lg">
        {options.map((p) => (
          <DropdownMenuItem
            key={p.id || p.key}
            className="text-xs gap-2"
            onClick={() => onChange(p.key as TicketPriority)}
          >
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: p.color }}
              aria-hidden
            />
            <span className="truncate">{p.name}</span>
            {!p.isActive ? (
              <span className="text-[9px] uppercase text-slate-400 font-bold ml-auto">inaktiv</span>
            ) : null}
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
  const unassignedLabel = t('tickets.unassigned', 'Unassigned');
  const isUnassigned = !agentId && !safeString(agentName).trim();
  const display = isUnassigned ? unassignedLabel : safeString(agentName, unassignedLabel);
  const initial = isUnassigned ? '—' : getInitials(display);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1.5 max-w-[130px] text-[11px] font-medium hover:bg-slate-50 rounded-md px-1 py-0.5 transition-colors',
              isUnassigned ? 'text-slate-400' : 'text-slate-700',
            )}
          >
            <Avatar
              className={cn(
                'h-5 w-5 shrink-0',
                isUnassigned ? 'border border-dashed border-slate-300' : 'border border-slate-200',
              )}
            >
              <AvatarFallback
                className={cn(
                  'text-[8px] font-bold',
                  isUnassigned ? 'bg-slate-50 text-slate-400' : 'bg-slate-100 text-slate-700',
                )}
              >
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className={cn('truncate', isUnassigned && 'italic font-normal')}>{display}</span>
            <ChevronDown className="w-3 h-3 opacity-40 shrink-0" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-44 rounded-lg">
        <DropdownMenuItem className="text-xs" onClick={() => onChange(null, null)}>
          {unassignedLabel}
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
