/**
 * Compact 2-pill Lieferung & Fälligkeit cell:
 * 1) Versendet · DD.MM.YYYY  |  Eingegangen · DD.MM.YYYY
 * 2) Due / overdue / today / muted fällig
 */

import { AlertCircle, Calendar, CheckCircle2, Clock, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  formatDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';

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

function dateOnlyDe(raw: unknown): string | null {
  const iso = toIsoDateOnly(raw);
  if (iso) return formatDateDeOnly(iso);
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
}

export function DeliveryDuePills({
  returned,
  deliveryDate,
  returnedAt,
  returnDueDate,
  overdueDays = 0,
  className,
}: {
  returned?: boolean | null;
  deliveryDate?: unknown;
  returnedAt?: unknown;
  returnDueDate?: unknown;
  overdueDays?: number;
  className?: string;
}) {
  const isReturned = Boolean(returned);
  const deliveryDe = dateOnlyDe(deliveryDate);
  const returnedDe = dateOnlyDe(returnedAt);
  const dueDe = dateOnlyDe(returnDueDate);
  const remaining = daysUntilDue(returnDueDate, overdueDays);

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      {isReturned ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          {returnedDe ? `Eingegangen · ${returnedDe}` : 'Eingegangen'}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
          <Send className="w-3 h-3 shrink-0" />
          {deliveryDe ? `Versendet · ${deliveryDe}` : 'Versendet'}
        </span>
      )}

      {!isReturned && remaining != null && remaining < 0 && dueDe ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {dueDe} · +{Math.abs(remaining)} Tage überfällig
        </span>
      ) : null}
      {!isReturned && remaining === 0 && dueDe ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          <Clock className="w-3 h-3 shrink-0" />
          {dueDe} · Heute fällig
        </span>
      ) : null}
      {!isReturned && remaining != null && remaining > 0 && dueDe ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
          <Calendar className="w-3 h-3 shrink-0" />
          Fällig · {dueDe}
        </span>
      ) : null}
      {!isReturned && remaining == null && dueDe ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
          <Calendar className="w-3 h-3 shrink-0" />
          Fällig · {dueDe}
        </span>
      ) : null}
      {isReturned && dueDe ? (
        <span className="text-[10px] font-medium text-slate-400">Fällig: {dueDe}</span>
      ) : null}
    </div>
  );
}
