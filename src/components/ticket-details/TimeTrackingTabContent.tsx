import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Ticket as TicketType } from '../../types';
import type { TimeEntry } from '../../lib/time-tracking/types';
import { timeEntryService } from '../../services/timeEntryService';
import { useTranslation } from '../../lib/context/I18nContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

interface TimeTrackingTabContentProps {
  ticket: TicketType;
  portalMode?: boolean;
  portalTimeEntries?: Array<Record<string, unknown>>;
  onAddPortalTimeEntry?: (payload: {
    hours: number;
    description?: string;
    date?: string;
    kuerzel?: string;
    sonderzahlung?: boolean;
  }) => Promise<unknown>;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function hoursFromParts(h: number, m: number): number {
  return Math.round((h + m / 60) * 4) / 4;
}

export function TimeTrackingTabContent({
  ticket,
  portalMode = false,
  portalTimeEntries,
  onAddPortalTimeEntry,
}: TimeTrackingTabContentProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState({ totalHours: 0, totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [kuerzel, setKuerzel] = useState('');
  const [hoursPart, setHoursPart] = useState(1);
  const [minutesPart, setMinutesPart] = useState(0);
  const [sonderzahlung, setSonderzahlung] = useState(false);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [standardRate, setStandardRate] = useState(95);
  const [specialRate, setSpecialRate] = useState(140);

  const activeRate = sonderzahlung ? specialRate : standardRate;
  const previewHours = hoursFromParts(hoursPart, minutesPart);
  const previewAmount = Math.round(previewHours * activeRate * 100) / 100;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (portalMode) {
        const mapped = (portalTimeEntries || []).map((e, i) => ({
          id: String((e as any).id || `te-${i}`),
          ticketId: ticket.id,
          ticketNumber: String(ticket.customId || ticket.id),
          ticketSubject: String(ticket.subject || ''),
          customerCompany: String(ticket.company || ''),
          userId: String((e as any).userId || ''),
          hours: Number((e as any).hours || 0),
          description: String((e as any).description || ''),
          date: String((e as any).date || ''),
          kuerzel: String((e as any).kuerzel || ''),
          amount: Number((e as any).amount || 0),
          sonderzahlung: Boolean((e as any).sonderzahlung),
          hourlyRate: Number((e as any).hourlyRate || 0),
          createdAt: String((e as any).createdAt || ''),
          updatedAt: String((e as any).updatedAt || ''),
        })) as unknown as TimeEntry[];
        setEntries(mapped);
        const totalHours = mapped.reduce((s, e) => s + Number(e.hours || 0), 0);
        const totalAmount = mapped.reduce((s, e) => s + Number((e as any).amount || 0), 0);
        setSummary({ totalHours, totalAmount, count: mapped.length });
        return;
      }
      const [list, defaults] = await Promise.all([
        timeEntryService.list({ ticketId: ticket.id }),
        timeEntryService.getDefaults(),
      ]);
      setEntries(list.entries);
      setSummary(list.summary);
      setStandardRate(defaults.rates.standardHourlyRate);
      setSpecialRate(defaults.rates.specialHourlyRate);
      if (!editingId) {
        setKuerzel((prev) => prev || defaults.kuerzel || '');
      }
    } catch (err: any) {
      toast.error(err?.message || t('timeTracking.loadFailed', 'Zeiteinträge konnten nicht geladen werden.'));
    } finally {
      setLoading(false);
    }
  }, [ticket.id, editingId, t, portalMode, portalTimeEntries]);

  useEffect(() => {
    void load();
  }, [load]);

  const ticketNumber = useMemo(() => {
    const custom = String(ticket.customId || '').replace(/^#/, '');
    return custom || ticket.id;
  }, [ticket]);

  const resetForm = () => {
    setEditingId(null);
    setHoursPart(1);
    setMinutesPart(0);
    setSonderzahlung(false);
    setDescription('');
    setDate(new Date().toISOString().slice(0, 10));
  };

  const startEdit = (entry: TimeEntry) => {
    setEditingId(entry.id);
    setKuerzel(entry.kuerzel);
    const whole = Math.floor(entry.hours);
    const minutes = Math.round((entry.hours - whole) * 60);
    setHoursPart(whole);
    setMinutesPart(minutes);
    setSonderzahlung(entry.sonderzahlung);
    setDescription(entry.description);
    setDate(entry.date);
  };

  const handleSubmit = async () => {
    if (!kuerzel.trim()) {
      toast.error(t('timeTracking.kuerzelRequired', 'Bitte ein Kürzel eingeben.'));
      return;
    }
    if (previewHours <= 0) {
      toast.error(t('timeTracking.hoursRequired', 'Bitte eine Zeit größer als 0 eingeben.'));
      return;
    }
    setSaving(true);
    try {
      if (portalMode) {
        if (editingId) {
          toast.error(t('timeTracking.portalEditDenied', 'Bearbeiten ist im Portal nicht verfügbar.'));
          return;
        }
        if (!onAddPortalTimeEntry) {
          toast.error(t('timeTracking.saveFailed', 'Speichern fehlgeschlagen.'));
          return;
        }
        await onAddPortalTimeEntry({
          hours: previewHours,
          description: description.trim(),
          date,
          kuerzel: kuerzel.trim().toUpperCase(),
          sonderzahlung,
        });
        toast.success(t('timeTracking.created', 'Zeit erfasst.'));
      } else if (editingId) {
        await timeEntryService.update(editingId, {
          kuerzel: kuerzel.trim().toUpperCase(),
          hours: previewHours,
          sonderzahlung,
          description: description.trim(),
          date,
        });
        toast.success(t('timeTracking.updated', 'Zeiteintrag aktualisiert.'));
      } else {
        await timeEntryService.create({
          ticketId: ticket.id,
          ticketNumber,
          ticketSubject: ticket.subject || '',
          customerCompany: ticket.company || '',
          kuerzel: kuerzel.trim().toUpperCase(),
          hours: previewHours,
          sonderzahlung,
          description: description.trim(),
          date,
        });
        toast.success(t('timeTracking.created', 'Zeit erfasst.'));
      }
      resetForm();
      await load();
    } catch (err: any) {
      toast.error(err?.message || t('timeTracking.saveFailed', 'Speichern fehlgeschlagen.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (portalMode) {
      toast.error(t('timeTracking.portalDeleteDenied', 'Löschen ist im Portal nicht verfügbar.'));
      return;
    }
    if (!window.confirm(t('timeTracking.confirmDelete', 'Diesen Zeiteintrag wirklich löschen?'))) return;
    try {
      await timeEntryService.remove(id);
      toast.success(t('timeTracking.deleted', 'Zeiteintrag gelöscht.'));
      if (editingId === id) resetForm();
      await load();
    } catch (err: any) {
      toast.error(err?.message || t('timeTracking.deleteFailed', 'Löschen fehlgeschlagen.'));
    }
  };

  const handleExport = () => {
    if (portalMode) return;
    window.open(timeEntryService.downloadExportUrl({ ticketId: ticket.id }), '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-[#0B1F3A]">
            {t('timeTracking.tabTitle', 'Zeiterfassung')}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {t(
              'timeTracking.tabDesc',
              'Erfassen Sie Arbeitszeiten zu diesem Ticket. Stundensätze kommen aus den Admin-Einstellungen.',
            )}
          </p>
        </div>
        <Button type="button" variant="outline" className="rounded-xl" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          {t('timeTracking.exportExcel', 'Als Excel (.xlsx) exportieren')}
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label>{t('timeTracking.kuerzel', 'Kürzel')}</Label>
            <Input
              value={kuerzel}
              onChange={(e) => setKuerzel(e.target.value.toUpperCase())}
              placeholder="PX"
              maxLength={12}
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('timeTracking.hours', 'Stunden')}</Label>
            <Input
              type="number"
              min={0}
              max={24}
              step={1}
              value={hoursPart}
              onChange={(e) => setHoursPart(Math.max(0, Number(e.target.value) || 0))}
              className="rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('timeTracking.minutes', 'Minuten')}</Label>
            <select
              className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
              value={minutesPart}
              onChange={(e) => setMinutesPart(Number(e.target.value))}
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
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

        <div className="flex items-center justify-between gap-4 rounded-xl bg-[#E8F1F8]/70 border border-[#1B6CA8]/15 px-4 py-3">
          <div className="flex items-center gap-3">
            <Switch checked={sonderzahlung} onCheckedChange={setSonderzahlung} />
            <div>
              <p className="text-sm font-semibold text-[#0B1F3A]">
                {sonderzahlung
                  ? t('timeTracking.specialRateLabel', 'Sonderzahlung ({{rate}}/Std.)').replace(
                      '{{rate}}',
                      formatEur(specialRate),
                    )
                  : t('timeTracking.standardRateLabel', 'Standard-Stundensatz ({{rate}}/Std.)').replace(
                      '{{rate}}',
                      formatEur(standardRate),
                    )}
              </p>
              <p className="text-[11px] text-slate-500">
                {formatHours(previewHours)} Std. · {formatEur(previewAmount)}
              </p>
            </div>
          </div>
          <Badge className="bg-[#0B1F3A] text-white border-none">
            {formatEur(activeRate)}/Std.
          </Badge>
        </div>

        <div className="space-y-1.5">
          <Label>{t('timeTracking.description', 'Tätigkeit / Notiz')}</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('timeTracking.descriptionPlaceholder', 'Was wurde erledigt?')}
            className="rounded-xl min-h-[80px]"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : editingId ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {editingId
              ? t('timeTracking.updateBtn', 'Eintrag speichern')
              : t('timeTracking.createBtn', 'Zeit erfassen')}
          </Button>
          {editingId && (
            <Button type="button" variant="outline" className="rounded-xl" onClick={resetForm}>
              {t('common.cancel', 'Abbrechen')}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t('timeTracking.listTitle', 'Erfasste Zeiten')}
          </p>
          <p className="text-sm font-semibold text-[#0B1F3A]">
            {formatHours(summary.totalHours)} Std. · {formatEur(summary.totalAmount)}
          </p>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="p-8 text-sm text-slate-500 text-center">
            {t('timeTracking.empty', 'Noch keine Zeiten für dieses Ticket erfasst.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b">
                  <th className="px-4 py-3">Datum</th>
                  <th className="px-4 py-3">Kürzel</th>
                  <th className="px-4 py-3">Mitarbeiter</th>
                  <th className="px-4 py-3">Stunden</th>
                  <th className="px-4 py-3">Satz</th>
                  <th className="px-4 py-3">Betrag</th>
                  <th className="px-4 py-3">Tätigkeit</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(
                      'border-b border-slate-50 hover:bg-slate-50/60',
                      editingId === entry.id && 'bg-[#E8F1F8]/50',
                    )}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">{entry.date}</td>
                    <td className="px-4 py-3 font-semibold">{entry.kuerzel}</td>
                    <td className="px-4 py-3">{entry.agentName}</td>
                    <td className="px-4 py-3">{formatHours(entry.hours)}</td>
                    <td className="px-4 py-3">
                      {formatEur(entry.hourlyRate)}
                      {entry.sonderzahlung && (
                        <Badge className="ml-2 bg-amber-100 text-amber-800 border-none text-[9px]">
                          Sonder
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">{formatEur(entry.totalAmount)}</td>
                    <td className="px-4 py-3 max-w-[220px] truncate" title={entry.description}>
                      {entry.description || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => startEdit(entry)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-600"
                          onClick={() => void handleDelete(entry.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
