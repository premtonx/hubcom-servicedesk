import {
  returnRowId,
  ReturnsItemCardBody,
  type ReturnsListItem,
} from './returns-layout-shared';

interface ReturnsCardGridProps {
  items: ReturnsListItem[];
  catalogStatuses: string[];
  onOpenDetails: (item: ReturnsListItem) => void;
  onMarkReturned: (item: ReturnsListItem) => void;
  onUnreturn?: (item: ReturnsListItem) => void;
  onStatusChange: (item: ReturnsListItem, status: string) => void;
}

export function ReturnsCardGrid({
  items,
  catalogStatuses,
  onOpenDetails,
  onMarkReturned,
  onUnreturn,
  onStatusChange,
}: ReturnsCardGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-4">
      {items.map((item) => {
        const id = returnRowId(item);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onOpenDetails(item)}
            className="text-left rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm hover:border-blue-200 hover:shadow-md transition-all"
          >
            <ReturnsItemCardBody
              item={item}
              statuses={catalogStatuses}
              showStatusSelect
              onOpenDetails={() => onOpenDetails(item)}
              onMarkReturned={() => onMarkReturned(item)}
              onUnreturn={onUnreturn ? () => onUnreturn(item) : undefined}
              onStatusChange={(status) => onStatusChange(item, status)}
            />
          </button>
        );
      })}
    </div>
  );
}
