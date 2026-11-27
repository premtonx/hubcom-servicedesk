import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Download, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { ZeiterfassungForm } from '../time-tracking/ZeiterfassungForm';
import { timeEntryService } from '../../services/timeEntryService';
import type { TimeEntry } from '../../lib/time-tracking/types';
import { useTranslation } from '../../lib/context/I18nContext';
import axios from 'axios';

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatHours(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function TimeTrackingWorkspacePage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState({ totalHours: 0, totalAmount: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'with_ticket' | 'without_ticket'>('all');
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [orgTickets, setOrgTickets] = useState<Array<{ id: string; label: string }>>([]);
  const [formOrgId, setFormOrgId] = useState('');

  const title = isAdmin
    ? t('timeTracking.overviewTitle', 'Zeiterfassung Gesamt')
    : t('timeTracking.myTitle', 'Meine Zeiterfassung');

  const loadOrgs = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/organizations', { withCredentials: true });
      const rows = (res.data?.organizations || []) as Array<{ id: string; name?: string }>;
      setOrganizations(
        rows
          .map((o) => ({ id: o.id, name: String(o.name || o.id) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      );
    } catch {
      /* non-admin may lack access — form org select may stay empty */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const defaults = await timeEntryService.getDefaults();
      setIsAdmin(Boolean(defaults.isAdmin));
      const data = await timeEntryService.list({
        from: from || undefined,
        to: to || undefined,
        organizationId: orgFilter || undefined,
        userId: defaults.isAdmin && agentFilter ? agentFilter : undefined,
        type: typeFilter,
      });
      setEntries(data.entries);
      setSummary(data.summary);
      if (defaults.isAdmin) {
        const uniq = new Map<string, string>();
        for (const e of data.entries) {
          if (e.userId) uniq.set(e.userId, e.agentName || e.userId);
        }
        setAgents(Array.from(uniq.entries()).map(([id, name]) => ({ id, name })));
      }
    } catch (err: any) {
      toast.error(err?.message || 'Zeiteinträge konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [from, to, orgFilter, agentFilter, typeFilter]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!formOrgId) {
      setOrgTickets([]);
      return;
    }
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
          .filter((d: any) => {
            const oid = String(d.organizationId || d.organization_id || '');
            return oid === formOrgId;
          })
          .slice(0, 80)
          .map((d: any) => ({
            id: String(d.id),
            label: `${String(d.customId || d.id).replace(/^#/, '')} — ${String(d.subject || '').slice(0, 60)}`,
          }));
        if (!cancelled) setOrgTickets(opts);
      } catch {
        if (!cancelled) setOrgTickets([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formOrgId]);

  const handleCreate = async (values: {
    kuerzel: string;
    hours: number;
    minutes: number;
    date: string;
    sonderzahlung: boolean;
    description: string;
    ticketId?: string;
    organizationId?: string;
  }) => {
    if (!values.organizationId && !values.ticketId) {
      toast.error('Bitte ein Unternehmen wählen.');
      return;
    }
    setSaving(true);
    try {
      await timeEntryService.create({
        organizationId: values.organizationId || null,
        ticketId: values.ticketId || null,
        kuerzel: values.kuerzel,
        hours: values.hours,
        minutes: values.minutes,
        sonderzahlung: values.sonderzahlung,
        description: values.description,
        date: values.date,
        customerCompany:
          organizations.find((o) => o.id === values.organizationId)?.name || undefined,
      });
      toast.success(t('timeTracking.created', 'Zeit erfasst.'));
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    window.open(
      timeEntryService.downloadExportUrl({
        from: from || undefined,
        to: to || undefined,
        organizationId: orgFilter || undefined,
        userId: isAdmin && agentFilter ? agentFilter : undefined,
        type: typeFilter,
      }),
      '_blank',
    );
  };

  const typeLabel = useMemo(
    () => ({
      all: t('timeTracking.typeAll', 'Alle'),
      with_ticket: t('timeTracking.typeWithTicket', 'Mit Ticket'),
      without_ticket: t('timeTracking.typeWithoutTicket', 'Ohne Ticket'),
    }),
    [t],
  );

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#fafafa]">
      <div className="p-6 sm:p-8 max-w-6xl mx-auto space-y-6 pb-20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#0B1F3A] tracking-tight">{title}</h1>
              <p className="text-sm text-slate-500 mt-1">
                {isAdmin
                  ? t(
                      'timeTracking.overviewDesc',
                      'Alle erfassten Zeiten — inkl. Filter und Excel-Export.',
                    )
                  : t(
                      'timeTracking.myDesc',
                      'Ihre erfassten Zeiten mit und ohne Ticket — inkl. Excel-Export.',
                    )}
              </p>
            </div>
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

        <ZeiterfassungForm
          submitting={saving}
          showOrganizationSelect
          organizationRequired
          organizationOptions={organizations}
          showTicketSelect
          ticketOptions={orgTickets}
          onOrganizationChange={setFormOrgId}
          onSubmit={handleCreate}
        />

        <div className="flex flex-wrap gap-3 items-end bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Kunde / Unternehmen</label>
            <select
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold min-w-[12rem]"
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
            >
              <option value="">Alle</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          {isAdmin ? (
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">Mitarbeiter / Agent</label>
              <select
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold min-w-[12rem]"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">Alle</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Von</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-xl w-44" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Bis</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-xl w-44" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-500">Typ</label>
            <select
              className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            >
              <option value="all">{typeLabel.all}</option>
              <option value="with_ticket">{typeLabel.with_ticket}</option>
              <option value="without_ticket">{typeLabel.without_ticket}</option>
            </select>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Gesamtstunden · Gesamtbetrag
            </p>
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
            <p className="p-12 text-center text-sm text-slate-500">Keine Zeiteinträge im gewählten Filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
                  <tr>
                    <th className="text-left px-4 py-3">Datum</th>
                    {isAdmin ? <th className="text-left px-4 py-3">Mitarbeiter</th> : null}
                    <th className="text-left px-4 py-3">Unternehmen</th>
                    <th className="text-left px-4 py-3">Ticket / Ref.</th>
                    <th className="text-left px-4 py-3">Kürzel</th>
                    <th className="text-right px-4 py-3">Stunden</th>
                    <th className="text-right px-4 py-3">Betrag</th>
                    <th className="text-left px-4 py-3">Tätigkeit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-semibold text-slate-800">{entry.date}</td>
                      {isAdmin ? (
                        <td className="px-4 py-3 text-slate-700">{entry.agentName}</td>
                      ) : null}
                      <td className="px-4 py-3 text-slate-700">{entry.customerCompany || '—'}</td>
                      <td className="px-4 py-3">
                        {entry.ticketId ? (
                          <span className="font-semibold text-slate-800">
                            {entry.ticketNumber || entry.ticketId}
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-bold">
                            Ohne Ticket
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">{entry.kuerzel}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatHours(entry.hours)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatEur(entry.totalAmount)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[220px] truncate">
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
