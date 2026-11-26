import { useMemo, useState } from 'react';
import { cn } from '../../lib/utils';
import {
  buildReturnsLifecycleBuckets,
  RETURNS_LIFECYCLE_COLUMNS,
  resolveReturnsLifecycleColumn,
  type ReturnsLifecycleColumnId,
} from '../../lib/client-portal/hardware-returns-layout';
import type { ConfiguredReminderStage } from '../../lib/client-portal/hardware-returns-stages';
import {
  returnRowId,
  ReturnsItemCardBody,
  type ReturnsListItem,
} from './returns-layout-shared';

interface ReturnsKanbanBoardProps {
  items: ReturnsListItem[];
  /** When true, returned column shows all returned rows (Erledigt/Alle). Else last 30 days. */
  includeAllReturned?: boolean;
  configuredStages?: ConfiguredReminderStage[] | null;
  onOpenDetails: (item: ReturnsListItem) => void;
  onMarkReturned: (item: ReturnsListItem) => void;
  onUnreturn?: (item: ReturnsListItem) => void;
  onOpenSend?: (item: ReturnsListItem, stage: number) => void;
}

export function ReturnsKanbanBoard({
  items,
  includeAllReturned = false,
  configuredStages,
  onOpenDetails,
  onMarkReturned,
  onUnreturn,
  onOpenSend,
}: ReturnsKanbanBoardProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ReturnsLifecycleColumnId | null>(null);

  const buckets = useMemo(
    () =>
      buildReturnsLifecycleBuckets(items, {
        includeAllReturned,
      }),
    [items, includeAllReturned],
  );

  const handleDropOnColumn = (target: ReturnsLifecycleColumnId) => {
    if (!draggingId) return;
    const item = items.find((it) => returnRowId(it) === draggingId);
    setDraggingId(null);
    setDropTarget(null);
    if (!item) return;

    const from = resolveReturnsLifecycleColumn(item);
    if (!from || from === target) return;

    // Open → Zurückgeliefert: mark returned (PATCH returned=true).
    if (target === 'returned' && from !== 'returned') {
      onMarkReturned(item);
      return;
    }
    // Zurückgeliefert → Offen / Überfällig / Eskaliert: undo receipt.
    if (from === 'returned' && target !== 'returned') {
      onUnreturn?.(item);
      return;
    }
    // Moves among open/overdue/escalated are classifier-derived (due/reminders) — no-op.
  };

  return (
    <div className="flex gap-3 p-4 min-h-[400px] overflow-x-auto">
      {RETURNS_LIFECYCLE_COLUMNS.map((col) => {
        const colItems = buckets[col.id] || [];
        const isDropActive = dropTarget === col.id;
        return (
          <div
            key={col.id}
            data-lifecycle-column={col.id}
            className={cn(
              'flex-1 min-w-[240px] max-w-[320px] flex flex-col rounded-xl bg-slate-50/80 border border-slate-200/80 border-t-4 transition-colors',
              col.accentBorder,
              isDropActive && 'bg-white ring-2 ring-blue-200/60',
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(col.id);
            }}
            onDragLeave={() => {
              if (dropTarget === col.id) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDropOnColumn(col.id);
            }}
          >
            <div className="px-3 py-2 border-b border-slate-200/80 flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full shrink-0', col.accentDot)} />
              <span className="text-xs font-semibold text-slate-700 truncate" title={col.label}>
                {col.label}
              </span>
              <span
                className={cn(
                  'ml-auto inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                  col.accentBadge,
                )}
              >
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
                    data-return-id={id}
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
                      statuses={[]}
                      configuredStages={configuredStages}
                      compact
                      showStatusSelect={false}
                      onOpenDetails={() => onOpenDetails(item)}
                      onMarkReturned={() => onMarkReturned(item)}
                      onUnreturn={onUnreturn ? () => onUnreturn(item) : undefined}
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
