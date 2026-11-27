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
        'px-4 h-10 bg-slate-50/95 border-b border-slate-200/80 sticky top-0 z-10 backdrop-blur-sm',
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

      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.customer', 'Kunde')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.subject', 'Betreff')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.status', 'Status')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.priority', 'Priorität')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.category', 'Kategorie')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.assignee', 'Zuständiger')}</div>
      <div className={TICKET_TABLE_HEADER_CELL}>{t('tickets.table.activity', 'Aktivität')}</div>
    </div>
  );
}
