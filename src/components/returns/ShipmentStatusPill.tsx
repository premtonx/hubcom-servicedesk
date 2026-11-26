/**
 * Color-coded Rücksendestatus pill — Versendet | Ausstehend | Eingegangen.
 */

import { CheckCircle2, Clock, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  resolveEffectiveShipmentStatus,
  shipmentStatusLabel,
  SHIPMENT_STATUS_OPTIONS,
  type ShipmentStatus,
} from '../../lib/client-portal/hardware-returns-shipment';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const PILL_STYLES: Record<ShipmentStatus, string> = {
  versendet: 'bg-blue-50 text-blue-600 border-blue-200',
  ausstehend: 'bg-amber-50 text-amber-600 border-amber-200',
  eingegangen: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function StatusIcon({ status, className }: { status: ShipmentStatus; className?: string }) {
  if (status === 'eingegangen') return <CheckCircle2 className={className} />;
  if (status === 'ausstehend') return <Clock className={className} />;
  return <Send className={className} />;
}

export function ShipmentStatusPill({
  returned,
  shipmentStatus,
  interactive = false,
  disabled = false,
  onChange,
}: {
  returned?: boolean | null;
  shipmentStatus?: string | null;
  interactive?: boolean;
  disabled?: boolean;
  onChange?: (next: ShipmentStatus) => void;
}) {
  const status = resolveEffectiveShipmentStatus({
    returned: Boolean(returned),
    shipment_status: shipmentStatus,
  });
  const label = shipmentStatusLabel(status);

  const chip = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold',
        PILL_STYLES[status],
        interactive && !disabled && 'cursor-pointer hover:opacity-90',
        disabled && 'opacity-60',
      )}
    >
      <StatusIcon status={status} className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );

  if (!interactive || !onChange) return chip;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        className="outline-none"
        title="Rücksendestatus ändern"
      >
        {chip}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[10rem]"
        onClick={(e) => e.stopPropagation()}
      >
        {SHIPMENT_STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.id}
            className="text-xs font-semibold gap-2"
            onClick={(e) => {
              e.stopPropagation();
              onChange(opt.id);
            }}
          >
            <StatusIcon status={opt.id} className="w-3.5 h-3.5" />
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
