import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { timeEntryService } from '../../services/timeEntryService';

export type ZeiterfassungFormValues = {
  kuerzel: string;
  hoursPart: number;
  minutesPart: number;
  date: string;
  sonderzahlung: boolean;
  description: string;
  ticketId?: string;
  organizationId?: string;
};

export type ZeiterfassungTicketOption = {
  id: string;
  label: string;
};

interface ZeiterfassungFormProps {
  initial?: Partial<ZeiterfassungFormValues>;
  submitting?: boolean;
  submitLabel?: string;
  /** Optional ticket link (customer / workspace). */
  ticketOptions?: ZeiterfassungTicketOption[];
  showTicketSelect?: boolean;
  /** Optional org select (workspace). */
  organizationOptions?: Array<{ id: string; name: string }>;
  showOrganizationSelect?: boolean;
  organizationRequired?: boolean;
  onOrganizationChange?: (organizationId: string) => void;
  className?: string;
  onSubmit: (values: {
    kuerzel: string;
    hours: number;
    minutes: number;
    date: string;
    sonderzahlung: boolean;
    description: string;
    ticketId?: string;
    organizationId?: string;
  }) => Promise<void> | void;
  onCancel?: () => void;
}

function hoursFromParts(h: number, m: number): number {
  return Math.round((h + m / 60) * 4) / 4;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

export function ZeiterfassungForm({
  initial,
  submitting = false,
  submitLabel,
  ticketOptions = [],
  showTicketSelect = false,
  organizationOptions = [],
  showOrganizationSelect = false,
  organizationRequired = false,
  onOrganizationChange,
  className,
  onSubmit,
  onCancel,
}: ZeiterfassungFormProps) {
  const { t } = useTranslation();
  const [kuerzel, setKuerzel] = useState(initial?.kuerzel || '');
  const [hoursPart, setHoursPart] = useState(initial?.hoursPart ?? 1);
  const [minutesPart, setMinutesPart] = useState(initial?.minutesPart ?? 0);
  const [sonderzahlung, setSonderzahlung] = useState(initial?.sonderzahlung ?? false);
  const [description, setDescription] = useState(initial?.description || '');
  const [date, setDate] = useState(
    initial?.date || new Date().toISOString().slice(0, 10),
  );
  const [ticketId, setTicketId] = useState(initial?.ticketId || '');
  const [organizationId, setOrganizationId] = useState(initial?.organizationId || '');
  const [standardRate, setStandardRate] = useState(95);
  const [specialRate, setSpecialRate] = useState(140);
  const [loadingDefaults, setLoadingDefaults] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const defaults = await timeEntryService.getDefaults();
        if (cancelled) return;
        setStandardRate(defaults.rates.standardHourlyRate);
        setSpecialRate(defaults.rates.specialHourlyRate);
        setKuerzel((prev) => prev || defaults.kuerzel || '');
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoadingDefaults(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRate = sonderzahlung ? specialRate : standardRate;
  const previewHours = hoursFromParts(hoursPart, minutesPart);
  const previewAmount = Math.round(previewHours * activeRate * 100) / 100;

  const canSubmit = useMemo(() => {
    if (!kuerzel.trim() || previewHours <= 0) return false;
    if (organizationRequired && !organizationId) return false;
    return true;
  }, [kuerzel, previewHours, organizationRequired, organizationId]);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      kuerzel: kuerzel.trim().toUpperCase(),
      hours: previewHours,
      minutes: minutesPart,
      date,
      sonderzahlung,
      description: description.trim(),
      ticketId: ticketId || undefined,
      organizationId: organizationId || undefined,
    });
  };

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4', className)}>
      {loadingDefaults ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          {showOrganizationSelect ? (
            <div className="space-y-1.5">
              <Label>
                {t('timeTracking.company', 'Unternehmen')}
                {organizationRequired ? (
                  <span className="text-rose-600" aria-hidden>
                    {' '}
                    *
                  </span>
                ) : null}
              </Label>
              <select
                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"
                value={organizationId}
                onChange={(e) => {
                  setOrganizationId(e.target.value);
                  setTicketId('');
                  onOrganizationChange?.(e.target.value);
                }}
              >
                <option value="">
                  {t('timeTracking.selectCompany', 'Unternehmen wählen…')}
                </option>
                {organizationOptions.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {showTicketSelect ? (
            <div className="space-y-1.5">
              <Label>{t('timeTracking.linkTicket', 'Ticket verknüpfen (optional)')}</Label>
              <select
                className="w-full h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
              >
                <option value="">{t('timeTracking.noTicket', 'Kein Ticket')}</option>
                {ticketOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>{t('timeTracking.kuerzel', 'Kürzel')}</Label>
              <Input
                value={kuerzel}
                onChange={(e) => setKuerzel(e.target.value.toUpperCase())}
                placeholder="PX"
                className="rounded-xl font-mono font-bold"
                maxLength={12}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('timeTracking.hours', 'Stunden')}</Label>
              <Input
                type="number"
                min={0}
                max={24}
                value={hoursPart}
                onChange={(e) => setHoursPart(Math.max(0, Number(e.target.value) || 0))}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('timeTracking.minutes', 'Minuten')}</Label>
              <Input
                type="number"
                min={0}
                max={59}
                step={15}
                value={minutesPart}
                onChange={(e) =>
                  setMinutesPart(Math.max(0, Math.min(59, Number(e.target.value) || 0)))
                }
                className="rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('timeTracking.date', 'Datum')}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-3">
              <Switch checked={sonderzahlung} onCheckedChange={setSonderzahlung} />
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {sonderzahlung
                    ? t('timeTracking.specialRate', 'Sonder-Stundensatz')
                    : t('timeTracking.standardRate', 'Standard-Stundensatz')}
                </p>
                <p className="text-[11px] text-slate-500 font-medium">
                  {formatEur(activeRate)} / Std.
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                {t('timeTracking.liveTotal', 'Berechnet')}
              </p>
              <p className="text-lg font-black text-[#0B1F3A]">
                {previewHours.toFixed(2)} Std. · {formatEur(previewAmount)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('timeTracking.note', 'Tätigkeit / Notiz')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                'timeTracking.notePlaceholder',
                'Was wurde erledigt? Meeting, Support, …',
              )}
              className="min-h-[88px] rounded-xl"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {onCancel ? (
              <Button type="button" variant="ghost" className="rounded-xl" onClick={onCancel}>
                {t('common.cancel', 'Abbrechen')}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={!canSubmit || submitting}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => void handleSubmit()}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {submitLabel || t('timeTracking.saveEntry', 'Zeit erfassen')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
