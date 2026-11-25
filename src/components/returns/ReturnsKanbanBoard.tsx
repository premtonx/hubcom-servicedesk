import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import {
  buildReturnsStatusColumns,
  resolveReturnsStatusColumn,
} from '../../lib/client-portal/hardware-returns-layout';
import type { ConfiguredReminderStage } from '../../lib/client-portal/hardware-returns-stages';
import {
  returnRowId,
  ReturnsItemCardBody,
  statusDotClass,
  type ReturnsListItem,
} from './returns-layout-shared';

interface ReturnsKanbanBoardProps {
  items: ReturnsListItem[];
  catalogStatuses: string[];
  configuredStages?: ConfiguredReminderStage[] | null;
  onOpenDetails: (item: ReturnsListItem) => void;
  onMarkReturned: (item: ReturnsListItem) => void;
  onUnreturn?: (item: ReturnsListItem) => void;
  onStatusChange: (item: ReturnsListItem, status: string) => void;
  onOpenSend?: (item: ReturnsListItem, stage: number) => void;
}

export function ReturnsKanbanBoard({
  items,
  catalogStatuses,
  configuredStages,
  onOpenDetails,
  onMarkReturned,
  onUnreturn,
  onStatusChange,
  onOpenSend,
}: ReturnsKanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const columns = useMemo(
    () => buildReturnsStatusColumns(catalogStatuses, items),
    [catalogStatuses, items],
  );

  const itemsByStatus = useMemo(() => {
    const buckets: Record<string, ReturnsListItem[]> = {};
    for (const col of columns) buckets[col] = [];
    for (const it of items) {
      const match = resolveReturnsStatusColumn(it.hardwareReturn.status, columns);
      if (!buckets[match]) buckets[match] = [];
      buckets[match].push(it);
    }
    return buckets;
  }, [columns, items]);

  const handleDropOnColumn = (status: string) => {
    if (!draggingId) return;
    const item = items.find((it) => returnRowId(it) === draggingId);
    const current = String(item?.hardwareReturn.status || 'Neu').trim() || 'Neu';
    if (!item || current.toLowerCase() === status.toLowerCase()) {
      setDraggingId(null);
      setDropTarget(null);
      return;
    }
    onStatusChange(item, status);
    setDraggingId(null);
    setDropTarget(null);
  };

  return (
    <div className="flex gap-3 p-4 min-h-[400px] overflow-x-auto">
      {columns.map((col) => {
        const colItems = itemsByStatus[col] || [];
        const isDropActive = dropTarget === col;
        return (
          <div
            key={col}
            className={cn(
              'flex-1 min-w-[240px] max-w-[320px] flex flex-col rounded-xl bg-slate-50/80 border border-slate-200/80 transition-colors',
              isDropActive && 'border-blue-400 bg-blue-50/40 ring-2 ring-blue-200/60',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(col);
            }}
            onDragLeave={() => {
              if (dropTarget === col) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDropOnColumn(col);
            }}
          >
            <div className="px-3 py-2 border-b border-slate-200/80 flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full shrink-0', statusDotClass(col))} />
              <span className="text-xs font-semibold text-slate-700 truncate">{col}</span>
              <span className="ml-auto inline-flex items-center rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 tabular-nums">
                {colItems.length}
              </span>
            </div>
            <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
              {colItems.length === 0 ? (
                <p className="text-[10px] text-slate-400 font-medium px-1 py-6 text-center">
                  Keine Rücklieferungen
                </p>
              ) : null}
              {colItems.map((item) => {
                const id = returnRowId(item);
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggingId(id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                    }}
                    onClick={() => onOpenDetails(item)}
                    className={cn(
                      'w-full rounded-lg border border-slate-200/80 bg-white p-3 shadow-sm hover:border-blue-200 hover:shadow transition-all cursor-grab active:cursor-grabbing',
                      draggingId === id && 'opacity-50',
                    )}
                  >
                    <ReturnsItemCardBody
                      item={item}
                      statuses={columns}
                      configuredStages={configuredStages}
                      compact
                      showStatusSelect
                      onOpenDetails={() => onOpenDetails(item)}
                      onMarkReturned={() => onMarkReturned(item)}
                      onUnreturn={onUnreturn ? () => onUnreturn(item) : undefined}
                      onStatusChange={(status) => onStatusChange(item, status)}
                      onOpenSend={
                        onOpenSend ? (stage) => onOpenSend(item, stage) : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
