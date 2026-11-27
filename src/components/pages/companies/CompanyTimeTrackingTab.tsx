import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { ZeiterfassungForm } from '../../time-tracking/ZeiterfassungForm';
import { timeEntryService } from '../../../services/timeEntryService';
import type { TimeEntry } from '../../../lib/time-tracking/types';
import { useTranslation } from '../../../lib/context/I18nContext';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

interface CompanyTimeTrackingTabProps {
  organizationId: string;
  companyName: string;
}

export default function CompanyTimeTrackingTab({
  organizationId,
  companyName,
}: CompanyTimeTrackingTabProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState({ totalHours: 0, totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tickets, setTickets] = useState<Array<{ id: string; label: string }>>([]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const data = await timeEntryService.list({ organizationId });
      setEntries(data.entries);
      setSummary(data.summary);
    } catch (err: any) {
      toast.error(err?.message || 'Zeiteinträge konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await axios.get('/api/db', {
          params: { collection: 'tickets' },
          withCredentials: true,
        });
        const docs = Array.isArray(res.data?.documents)
          ? res.data.documents
          : Array.isArray(res.data)
            ? res.data
            : [];
        const opts = docs
          .filter((d: any) => String(d.organizationId || d.organization_id || '') === organizationId)
          .slice(0, 100)
          .map((d: any) => ({
            id: String(d.id),
            label: `${String(d.customId || d.id).replace(/^#/, '')} — ${String(d.subject || '').slice(0, 50)}`,
          }));
        if (!cancelled) setTickets(opts);
      } catch {
        if (!cancelled) setTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const handleCreate = async (values: {
    kuerzel: string;
    hours: number;
    minutes: number;
    date: string;
    sonderzahlung: boolean;
    description: string;
    ticketId?: string;
  }) => {
    setSaving(true);
    try {
      await timeEntryService.create({
        organizationId,
        ticketId: values.ticketId || null,
        customerCompany: companyName,
        kuerzel: values.kuerzel,
        hours: values.hours,
        minutes: values.minutes,
        sonderzahlung: values.sonderzahlung,
        description: values.description,
        date: values.date,
      });
      toast.success(t('timeTracking.created', 'Zeit erfasst.'));
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#0B1F3A]">
            {t('timeTracking.tabTitle', 'Zeiterfassung')}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Zeiten für {companyName} — optional mit Ticket-Verknüpfung.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-xl"
          onClick={() =>
            window.open(
              timeEntryService.downloadExportUrl({ organizationId }),
              '_blank',
            )
          }
        >
          <Download className="w-4 h-4 mr-2" />
          Als Excel (.xlsx) exportieren
        </Button>
      </div>

      <ZeiterfassungForm
        submitting={saving}
        showTicketSelect
        ticketOptions={tickets}
        initial={{ organizationId }}
        onSubmit={handleCreate}
      />

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            Erfasste Zeiten
          </p>
          <p className="text-sm font-black text-[#0B1F3A]">
            {formatHours(summary.totalHours)} Std. · {formatEur(summary.totalAmount)}
          </p>
        </div>
        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">Noch keine Zeiten für diesen Kunden.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-slate-500 font-bold bg-white">
                <tr>
                  <th className="text-left px-4 py-2">Datum</th>
                  <th className="text-left px-4 py-2">Mitarbeiter</th>
                  <th className="text-left px-4 py-2">Ticket</th>
                  <th className="text-left px-4 py-2">Kürzel</th>
                  <th className="text-right px-4 py-2">Stunden</th>
                  <th className="text-right px-4 py-2">Betrag</th>
                  <th className="text-left px-4 py-2">Notiz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-semibold">{e.date}</td>
                    <td className="px-4 py-2.5">{e.agentName}</td>
                    <td className="px-4 py-2.5">
                      {e.ticketId ? (
                        e.ticketNumber || e.ticketId
                      ) : (
                        <Badge variant="outline" className="text-[10px] font-bold">
                          Ohne Ticket
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-bold">{e.kuerzel}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatHours(e.hours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {formatEur(e.totalAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate">
                      {e.description || '—'}
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
