import {
  Check,
  Package,
  PackageCheck,
  PanelRight,
  Plug,
  Tablet,
  Undo2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import {
  formatDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';
import {
  buildReturnsStatusColumns,
  DEFAULT_RETURN_STATUSES,
} from '../../lib/client-portal/hardware-returns-layout';

export { buildReturnsStatusColumns, DEFAULT_RETURN_STATUSES };

export type ReturnsListItem = {
  hardwareReturn: Record<string, any>;
  ticket: {
    id: string;
    subject: string | null;
    customerName: string | null;
    customerEmail: string | null;
  };
  overdueDays: number;
  mailStatus: string;
  missingRoles: string[];
  nextDueStage: 1 | 2 | 3 | null;
};

export function returnRowId(it: ReturnsListItem): string {
  return String(it.hardwareReturn?.id || '').trim();
}

function isLegacyOrUuidReturnNumber(returnNumber: string | null | undefined): boolean {
  const raw = String(returnNumber || '').trim();
  if (!raw) return true;
  if (/^RL-LEGACY-/i.test(raw)) return true;
  if (/^[0-9a-f]{6,12}$/i.test(raw)) return true;
  return false;
}

export function formatReturnNumber(hw: Record<string, any>): string {
  const n = String(hw.return_number || '').trim();
  if (n && !isLegacyOrUuidReturnNumber(n)) {
    return n.startsWith('#') ? n : `#${n}`;
  }
  return '#—';
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('geschlossen') || s === 'closed' || s === 'returned') {
    return 'bg-emerald-50 text-emerald-800 border-emerald-100';
  }
  if (s.includes('bearbeitung') || s.includes('progress')) {
    return 'bg-sky-50 text-sky-800 border-sky-100';
  }
  if (s.includes('warten') || s.includes('wait') || s.includes('third')) {
    return 'bg-amber-50 text-amber-900 border-amber-100';
  }
  if (s === 'neu' || s === 'open' || s === 'new') {
    return 'bg-indigo-50 text-indigo-800 border-indigo-100';
  }
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('geschlossen') || s === 'closed' || s === 'returned') return 'bg-emerald-500';
  if (s.includes('bearbeitung') || s.includes('progress')) return 'bg-sky-500';
  if (s.includes('warten') || s.includes('wait') || s.includes('third')) return 'bg-amber-500';
  if (s === 'neu' || s === 'open' || s === 'new') return 'bg-indigo-500';
  return 'bg-slate-400';
}

function daysUntilDue(dueRaw: unknown, overdueDays: number): number | null {
  if (overdueDays > 0) return -overdueDays;
  const iso = toIsoDateOnly(dueRaw);
  if (!iso) return null;
  const due = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueUtc - today) / (24 * 60 * 60 * 1000));
}

export function DueCountdownPill({
  overdueDays,
  dueDate,
  returned,
  className,
}: {
  overdueDays: number;
  dueDate: unknown;
  returned: boolean;
  className?: string;
}) {
  if (returned) return null;
  const remaining = daysUntilDue(dueDate, overdueDays);
  if (remaining == null) return null;
  if (remaining < 0) {
    return (
      <span
        className={cn(
          'inline-flex rounded-full bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 text-[10px] font-bold',
          className,
        )}
      >
        +{Math.abs(remaining)} Tage überfällig
      </span>
    );
  }
  if (remaining === 0) {
    return (
      <span
        className={cn(
          'inline-flex rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 text-[10px] font-bold',
          className,
        )}
      >
        Heute fällig
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold',
        className,
      )}
    >
      Noch {remaining} Tage
    </span>
  );
}

type DeviceVisual = { Icon: LucideIcon; iconClass: string; wrapClass: string };

function resolveDeviceVisual(deviceDetails: string): DeviceVisual {
  const t = deviceDetails.toLowerCase();
  if (/secutest|prüfgerät|pruefgeraet|mxtra|gossen|messgerät|messgeraet/.test(t)) {
    return { Icon: Zap, iconClass: 'text-sky-700', wrapClass: 'bg-sky-50 border-sky-100' };
  }
  if (/adapter|prcd|vl2e|\bbt\b|kabel|leitung/.test(t)) {
    return { Icon: Plug, iconClass: 'text-indigo-700', wrapClass: 'bg-indigo-50 border-indigo-100' };
  }
  if (/tablet|dock|tastatur|laptop|getac|notebook/.test(t)) {
    return { Icon: Tablet, iconClass: 'text-slate-600', wrapClass: 'bg-slate-100 border-slate-200' };
  }
  return { Icon: Package, iconClass: 'text-slate-500', wrapClass: 'bg-slate-50 border-slate-200' };
}

export function CompactDevicePills({ hw }: { hw: Record<string, any> }) {
  const pills: { kind: 'alt' | 'neu'; type: string; serial: string }[] = [];
  const oldType = String(hw.device_old_type || '').trim();
  const oldSerial = String(hw.device_old_serial || '').trim();
  const newType = String(hw.device_new_type || '').trim();
  const newSerial = String(hw.device_new_serial || '').trim();
  if (oldType || oldSerial) pills.push({ kind: 'alt', type: oldType, serial: oldSerial });
  if (newType || newSerial) pills.push({ kind: 'neu', type: newType, serial: newSerial });
  if (!pills.length) {
    const text = String(hw.device_details || '').trim();
    if (!text) return <span className="text-[10px] text-slate-400">—</span>;
    return <p className="text-[10px] text-slate-600 line-clamp-2">{text}</p>;
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      {pills.map((p) => {
        const visual = resolveDeviceVisual(`${p.type} ${p.serial}`);
        const Icon = visual.Icon;
        return (
          <div key={`${p.kind}-${p.type}-${p.serial}`} className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                'inline-flex rounded px-1 py-0.5 text-[8px] font-black tracking-wide border shrink-0',
                p.kind === 'alt'
                  ? 'bg-amber-50 text-amber-800 border-amber-100'
                  : 'bg-sky-50 text-sky-800 border-sky-100',
              )}
            >
              {p.kind === 'alt' ? 'ALT' : 'NEU'}
            </span>
            <Icon className={cn('w-3 h-3 shrink-0', visual.iconClass)} />
            <span className="text-[10px] font-semibold text-slate-800 truncate">
              {p.type || '—'}
              {p.serial ? (
                <span className="font-mono font-medium text-slate-500"> · {p.serial}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact 1. / 2. / 3. Erinnerung progress (read-only for card surfaces). */
export function ReminderProgress({ hw }: { hw: Record<string, any> }) {
  const stamps = [hw.mail1_sent_at, hw.mail2_sent_at, hw.mail3_sent_at] as const;
  return (
    <div className="flex items-center gap-0.5" title="Erinnerungsverlauf">
      {([1, 2, 3] as const).map((stage, idx) => {
        const done = Boolean(stamps[idx]);
        return (
          <span
            key={stage}
            className={cn(
              'inline-flex h-6 min-w-[1.75rem] items-center justify-center gap-0.5 rounded-full border px-1.5 text-[9px] font-bold',
              done
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-slate-400 border-slate-200',
            )}
          >
            {done ? <Check className="w-2.5 h-2.5" /> : null}
            {stage}.
          </span>
        );
      })}
    </div>
  );
}

export function ReturnsItemCardBody({
  item,
  statuses,
  onOpenDetails,
  onMarkReturned,
  onUnreturn,
  onStatusChange,
  showStatusSelect,
  compact,
}: {
  item: ReturnsListItem;
  statuses: string[];
  onOpenDetails: () => void;
  onMarkReturned: () => void;
  onUnreturn?: () => void;
  onStatusChange?: (status: string) => void;
  showStatusSelect?: boolean;
  compact?: boolean;
}) {
  const hw = item.hardwareReturn;
  const statusLabel = String(hw.status || 'Neu').trim() || 'Neu';
  const employeeName = hw.employee_name || item.ticket.customerName || '—';
  const assigneeName = String(hw.assignee_name || '').trim() || 'Support';

  return (
    <div className={cn('flex flex-col gap-2', compact ? 'text-left' : '')}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-black text-blue-800 tracking-tight">
          {formatReturnNumber(hw)}
        </span>
        <span
          className={cn(
            'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0',
            statusBadgeClass(statusLabel),
          )}
        >
          {statusLabel}
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-900 truncate">{employeeName}</p>
        <p className="text-[10px] text-slate-500 truncate">Bearbeiter: {assigneeName}</p>
      </div>
      <CompactDevicePills hw={hw} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-slate-600 font-medium">
          Fällig: {formatDateDeOnly(hw.return_due_date)}
        </span>
        <DueCountdownPill
          overdueDays={item.overdueDays}
          dueDate={hw.return_due_date || hw.delivery_date}
          returned={Boolean(hw.returned)}
          className="mt-0"
        />
      </div>
      <ReminderProgress hw={hw} />
      {showStatusSelect && onStatusChange ? (
        <select
          className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-semibold"
          value={statusLabel}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            onStatusChange(e.target.value);
          }}
        >
          {statuses.includes(statusLabel) ? null : (
            <option value={statusLabel}>{statusLabel}</option>
          )}
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-1.5 pt-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" onClick={onOpenDetails}>
          <PanelRight className="w-3 h-3 mr-1" />
          Details
        </Button>
        {!hw.returned ? (
          <Button
            type="button"
            size="sm"
            className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
            title="Eingang bestätigen"
            onClick={onMarkReturned}
          >
            <PackageCheck className="w-3 h-3 mr-1" />
            Eingang bestätigen
          </Button>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 px-1">
              <PackageCheck className="w-3 h-3" />
              Eingegangen
            </span>
            {onUnreturn ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-1.5 text-[10px] text-slate-500"
                title="Eingang rückgängig machen"
                onClick={onUnreturn}
              >
                <Undo2 className="w-3 h-3 mr-0.5" />
                Rückgängig
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
