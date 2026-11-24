import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { timeEntryService } from '../../services/timeEntryService';
import type { TimeEntry } from '../../lib/time-tracking/types';
import { useTranslation } from '../../lib/context/I18nContext';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function TimeTrackingOverviewPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState({ totalHours: 0, totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await timeEntryService.list({
        from: from || undefined,
        to: to || undefined,
      });
      setEntries(data.entries);
      setSummary(data.summary);
    } catch (err: any) {
      toast.error(err?.message || 'Übersicht konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = () => {
    window.open(
      timeEntryService.downloadExportUrl({
        from: from || undefined,
        to: to || undefined,
      }),
      '_blank',
    );
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#fafafa]">
      <div className="p-8 max-w-6xl mx-auto space-y-6 pb-20">
<div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[#0B1F3A] tracking-tight">
              {t('timeTracking.overviewTitle', 'Zeiterfassung Gesamt')}
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {t(
                'timeTracking.overviewDesc',
                'Alle erfassten Zeiten über Tickets hinweg — inkl. Excel-Export.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => void load()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Aktualisieren
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Als Excel (.xlsx) exportieren
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-end bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Von</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl w-44" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Bis</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl w-44" />
          </div>
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => void load()}>
            Filtern
          </Button>
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Summe</p>
            <p className="text-lg font-black text-[#0B1F3A]">
              {formatHours(summary.totalHours)} Std. · {formatEur(summary.totalAmount)}
            </p>
            <p className="text-xs text-slate-500">{summary.count} Einträge</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          {loading ? (
            <div className="p-16 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : entries.length === 0 ? (
            <p className="p-12 text-center text-sm text-slate-500">Keine Zeiteinträge im gewählten Zeitraum.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b bg-slate-50/80">
                    <th className="px-4 py-3">Ticket-Nr.</th>
                    <th className="px-4 py-3">Betreff</th>
                    <th className="px-4 py-3">Kunde</th>
                    <th className="px-4 py-3">Datum</th>
                    <th className="px-4 py-3">Mitarbeiter</th>
                    <th className="px-4 py-3">Kürzel</th>
                    <th className="px-4 py-3">Stunden</th>
                    <th className="px-4 py-3">Sonderzahlung</th>
                    <th className="px-4 py-3">Stundensatz</th>
                    <th className="px-4 py-3">Gesamtbetrag</th>
                    <th className="px-4 py-3">Beschreibung</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">{entry.ticketNumber}</td>
                      <td className="px-4 py-3 max-w-[180px] truncate" title={entry.ticketSubject}>
                        {entry.ticketSubject || '—'}
                      </td>
                      <td className="px-4 py-3">{entry.customerCompany || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{entry.date}</td>
                      <td className="px-4 py-3">{entry.agentName}</td>
                      <td className="px-4 py-3 font-semibold">{entry.kuerzel}</td>
                      <td className="px-4 py-3">{formatHours(entry.hours)}</td>
                      <td className="px-4 py-3">
                        {entry.sonderzahlung ? (
                          <Badge className="bg-amber-100 text-amber-800 border-none">Ja</Badge>
                        ) : (
                          'Nein'
                        )}
                      </td>
                      <td className="px-4 py-3">{formatEur(entry.hourlyRate)}</td>
                      <td className="px-4 py-3 font-semibold">{formatEur(entry.totalAmount)}</td>
                      <td className="px-4 py-3 max-w-[220px] truncate" title={entry.description}>
                        {entry.description || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
