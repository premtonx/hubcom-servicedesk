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
        'px-4 h-9 bg-muted/80 border-b border-border sticky top-0 z-10',
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
