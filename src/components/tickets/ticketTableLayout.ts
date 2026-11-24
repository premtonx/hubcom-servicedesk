import { cn } from '../../lib/utils';

/**
 * Streamlined columns: Checkbox | Kunde | Betreff | Status | Priorität | Kategorie | Zuständiger | Aktivität
 * Wider fixed tracks so status/assignee/activity labels are not truncated mid-word.
 */
export const TICKET_TABLE_GRID_SUPPORT =
  'grid items-center gap-x-3 grid-cols-[36px_minmax(140px,180px)_minmax(220px,1.4fr)_minmax(130px,150px)_minmax(100px,120px)_minmax(120px,140px)_minmax(140px,160px)_minmax(100px,120px)]';

export function getTicketTableGridClass(): string {
  return TICKET_TABLE_GRID_SUPPORT;
}

export function getTicketTableMinWidth(): string {
  return 'min-w-[1100px]';
}

export const TICKET_TABLE_HEADER_CELL =
  'font-semibold text-[10px] text-slate-500 uppercase tracking-wider text-left truncate';

export const TICKET_TABLE_ROW_BASE =
  'hover:bg-slate-50/80 cursor-pointer group transition-colors duration-150 border-l-2 border-transparent py-2 min-h-[44px]';

export function ticketTableRowClass(selected: boolean): string {
  return cn(
    TICKET_TABLE_ROW_BASE,
    selected && 'bg-blue-50/50 hover:bg-blue-50/70 border-l-blue-500',
  );
}
