import { cn } from '../../lib/utils';
import { toPortalStatusGroup, type PortalStatusFilter } from '../../lib/portal/status';

export function portalStatusBadgeClass(status: string | null | undefined): string {
  const group = toPortalStatusGroup(status);
  return cn(
    'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border',
    group === 'open' && 'bg-sky-50 text-sky-800 border-sky-100',
    group === 'in_progress' && 'bg-amber-50 text-amber-800 border-amber-100',
    group === 'waiting_customer' && 'bg-violet-50 text-violet-800 border-violet-100',
    group === 'resolved' && 'bg-emerald-50 text-emerald-800 border-emerald-100',
    group === 'closed' && 'bg-slate-100 text-slate-600 border-slate-200',
  );
}

export function portalPriorityBadgeClass(priority: string | null | undefined): string {
  const p = String(priority || 'medium').toLowerCase();
  return cn(
    'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border',
    p === 'low' && 'bg-slate-50 text-slate-600 border-slate-200',
    (p === 'medium') && 'bg-blue-50 text-blue-800 border-blue-100',
    (p === 'high' || p === 'urgent' || p === 'critical') && 'bg-rose-50 text-rose-800 border-rose-100',
  );
}

export function formatPortalDate(value: unknown): string {
  if (!value) return '—';
  const d =
    typeof value === 'object' && value && 'toDate' in (value as object)
      ? (value as { toDate: () => Date }).toDate()
      : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ticketNumberLabel(ticket: { id: string; customId?: string | null }): string {
  const custom = String(ticket.customId || '').replace(/^#/, '');
  if (custom) return `#${custom}`;
  return `#${ticket.id.slice(-6).toUpperCase()}`;
}

export type { PortalStatusFilter };
