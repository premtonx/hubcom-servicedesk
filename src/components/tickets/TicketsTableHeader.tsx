import React from 'react';
import { Checkbox } from '../ui/checkbox';
import { useTranslation } from '../../lib/context/I18nContext';
import { cn } from '../../lib/utils';
import {
  getTicketTableGridClass,
  TICKET_TABLE_HEADER_CELL,
} from './ticketTableLayout';

interface TicketsTableHeaderProps {
  headerCheckboxActive: boolean;
  onToggleSelectAll: () => void;
  className?: string;
  showSelection?: boolean;
}

function HeaderLabel({
  children,
  divider = false,
}: {
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div className={cn(TICKET_TABLE_HEADER_CELL, 'flex items-center gap-2 min-w-0')}>
      {divider ? (
        <span className="h-3.5 w-px bg-slate-200/80 shrink-0 self-center" aria-hidden />
      ) : null}
      <span className="truncate">{children}</span>
    </div>
  );
}

export function TicketsTableHeader({
  headerCheckboxActive,
  onToggleSelectAll,
  className,
  showSelection = true,
}: TicketsTableHeaderProps) {
  const { t } = useTranslation();
  const grid = getTicketTableGridClass();

  return (
    <div
      className={cn(
        grid,
        'px-4 h-10 bg-slate-50/95 border-b border-slate-200/80 sticky top-0 z-10 backdrop-blur-sm divide-x divide-slate-100/80',
        className,
      )}
    >
      <div className="justify-self-center">
        {showSelection ? (
        <Checkbox
          checked={headerCheckboxActive}
          onCheckedChange={onToggleSelectAll}
          className="bg-card border-border cursor-pointer"
          aria-label={t('tickets.table.selectAll', 'Alle auswählen')}
        />
        ) : null}
      </div>

      <HeaderLabel>{t('tickets.table.customer', 'Kunde')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.subject', 'Betreff')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.status', 'Status')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.priority', 'Priorität')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.category', 'Kategorie')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.assignee', 'Zuständiger')}</HeaderLabel>
      <HeaderLabel divider>{t('tickets.table.activity', 'Aktivität')}</HeaderLabel>
    </div>
  );
}
