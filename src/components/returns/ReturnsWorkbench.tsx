import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Mail,
  Package,
  Plus,
  Search,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';
import {
  ReturnCreateEditDrawer,
  type ReturnMemberOption,
} from './ReturnCreateEditDrawer';
import { formatDateDeOnly } from '../../lib/client-portal/hardware-returns-dates';

type WorkbenchMode = 'portal' | 'staff';

interface ReturnsWorkbenchProps {
  mode: WorkbenchMode;
  organizationId: string;
  canEditSettings?: boolean;
  canImportCsv?: boolean;
}

type ListItem = {
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

const VIEWS = [
  { id: 'open', label: 'Offene Rücklieferungen' },
  { id: 'overdue', label: 'Fällige / Überfällige' },
  { id: 'next_mail', label: 'Nächste Mail fällig' },
  { id: 'done', label: 'Erledigt' },
  { id: 'all', label: 'Alle' },
] as const;

const ROLE_LABELS: Record<string, string> = {
  employee: 'Mitarbeiter',
  project_manager: 'Projektmanager',
  manager: 'Vorgesetzter / Chef',
  ceo: 'Geschäftsführung / CEO',
};

/** Primary key for standalone returns API routes (`return.id`, never ticket id). */
function returnRowId(it: ListItem): string {
  return String(it.hardwareReturn?.id || '').trim();
}

function formatReturnNumber(hw: Record<string, any>): string {
  const n = String(hw.return_number || '').trim();
  if (n) return n.startsWith('#') ? n : `#${n}`;
  const id = String(hw.id || '').trim();
  return id ? `#${id.slice(0, 8).toUpperCase()}` : '#RL-—';
}

export function ReturnsWorkbench({
  mode,
  organizationId,
  canEditSettings = false,
  canImportCsv = false,
}: ReturnsWorkbenchProps) {
  const base = mode === 'portal' ? '/api/portal/returns' : '/api/returns';
  const orgQ = mode === 'staff' ? `organizationId=${encodeURIComponent(organizationId)}` : '';

  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('open');
  const [q, setQ] = useState('');
  const [mailStatus, setMailStatus] = useState('all');
  const [overdueBucket, setOverdueBucket] = useState('all');
  const [exportStatus, setExportStatus] = useState('all');
  const [sort, setSort] = useState('due_asc');
  const [items, setItems] = useState<ListItem[]>([]);
  const [kpis, setKpis] = useState({
    open: 0,
    overdue: 0,
    nextMailDue: 0,
    stage3: 0,
    returnedLast30: 0,
  });
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sendModal, setSendModal] = useState<{
    returnId: string;
    stage: 1 | 2 | 3;
    to: string[];
    cc: string[];
    subject: string;
    htmlPreview: string;
    saveOverride: boolean;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editItem, setEditItem] = useState<{
    returnId: string;
    subject?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    hardwareReturn: Record<string, unknown>;
  } | null>(null);
  const [members, setMembers] = useState<ReturnMemberOption[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    void (async () => {
      try {
        if (mode === 'portal') {
          const res = await axios.get('/api/portal/members', { withCredentials: true });
          const rows = (res.data?.members || res.data?.users || []) as Array<Record<string, any>>;
          if (!active) return;
          setMembers(
            rows.map((u) => ({
              id: String(u.id),
              name: String(u.name || u.email || ''),
              email: String(u.email || ''),
              phone_office: u.phone_office || u.phoneOffice || null,
              phone_mobile: u.phone_mobile || u.phoneMobile || null,
              project_manager_name: u.project_manager_name || null,
              project_manager_email: u.project_manager_email || null,
              manager_name: u.manager_name || null,
              manager_email: u.manager_email || null,
            })),
          );
        } else {
          const res = await axios.get(
            `/api/admin/organizations/${encodeURIComponent(organizationId)}/users`,
            { withCredentials: true },
          );
          const rows = (res.data?.users || []) as Array<Record<string, any>>;
          if (!active) return;
          setMembers(
            rows.map((u) => ({
              id: String(u.id),
              name: String(u.name || u.email || ''),
              email: String(u.email || ''),
              phone_office: u.phone_office || u.phoneOffice || null,
              phone_mobile: u.phone_mobile || u.phoneMobile || null,
              project_manager_name: u.project_manager_name || null,
              project_manager_email: u.project_manager_email || null,
              manager_name: u.manager_name || null,
              manager_email: u.manager_email || null,
            })),
          );
        }
      } catch {
        if (active) setMembers([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [organizationId, mode]);

  const openCreate = () => {
    setEditItem(null);
    setDrawerOpen(true);
  };

  const openEdit = (it: ListItem) => {
    const id = returnRowId(it);
    if (!id) {
      toast.error('Rücklieferung ohne ID — bitte neu laden.');
      return;
    }
    setEditItem({
      returnId: id,
      subject: it.hardwareReturn.subject || it.ticket.subject,
      customerName: it.hardwareReturn.employee_name || it.ticket.customerName,
      customerEmail: it.hardwareReturn.employee_email || it.ticket.customerEmail,
      hardwareReturn: it.hardwareReturn,
    });
    setDrawerOpen(true);
  };

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        view,
        q,
        mailStatus,
        overdueBucket,
        exportStatus,
        sort,
        limit: '200',
      });
      if (mode === 'staff') params.set('organizationId', organizationId);
      const res = await axios.get(`${base}?${params.toString()}`, { withCredentials: true });
      setItems(res.data?.items || []);
      setKpis(res.data?.kpis || kpis);
      setAutoSendEnabled(Boolean(res.data?.autoSendEnabled));
      setSettings(res.data?.settings || null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Laden fehlgeschlagen');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, view, q, mailStatus, overdueBucket, exportStatus, sort, base, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const openSend = async (returnId: string, stage: 1 | 2 | 3) => {
    try {
      const qs = mode === 'staff' ? `?${orgQ}&stage=${stage}` : `?stage=${stage}`;
      const res = await axios.get(`${base}/${encodeURIComponent(returnId)}/preview-reminder${qs}`, {
        withCredentials: true,
      });
      setSendModal({
        returnId,
        stage,
        to: res.data?.to || [],
        cc: res.data?.cc || [],
        subject: res.data?.subject || '',
        htmlPreview: res.data?.htmlPreview || '',
        saveOverride: false,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Vorschau fehlgeschlagen');
    }
  };

  const confirmSend = async () => {
    if (!sendModal) return;
    setSending(true);
    try {
      await axios.post(
        `${base}/${encodeURIComponent(sendModal.returnId)}/send-reminder`,
        {
          stage: sendModal.stage,
          to: sendModal.to,
          cc: sendModal.cc,
          saveAsTicketOverride: sendModal.saveOverride,
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      toast.success(`${sendModal.stage}. Mail versendet`);
      setSendModal(null);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Versand fehlgeschlagen');
    } finally {
      setSending(false);
    }
  };

  const bulk = async (action: 'mark_returned' | 'mark_exported' | 'csv_export') => {
    try {
      const res = await axios.post(
        `${base}/bulk`,
        {
          action,
          ticketIds: Array.from(selected),
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      if (action === 'csv_export' && res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruecklieferungen-${organizationId.slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exportiert');
      } else {
        toast.success(`${res.data?.updated || 0} Einträge aktualisiert`);
        setSelected(new Set());
        void load();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Aktion fehlgeschlagen');
    }
  };

  const onImportCsv = async (file: File | null) => {
    if (!file || !canImportCsv) return;
    const text = await file.text();
    try {
      const res = await axios.post(
        `${base}/import-csv`,
        { csv: text, ...(mode === 'staff' ? { organizationId } : {}) },
        { withCredentials: true },
      );
      toast.success(`Import: ${res.data?.imported || 0} · übersprungen ${res.data?.skipped || 0}`);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Import fehlgeschlagen');
    }
  };

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!canEditSettings) return;
    try {
      const res = await axios.patch(
        `${base}/settings${mode === 'staff' ? `?${orgQ}` : ''}`,
        {
          hardware_returns_config: patch,
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      setSettings(res.data?.hardware_returns_config || null);
      setAutoSendEnabled(Boolean(res.data?.hardware_returns_config?.auto_send_enabled));
      toast.success('Einstellungen gespeichert');
      setSettingsOpen(false);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    }
  };

  const kpiCards = useMemo(
    () => [
      { key: 'open', label: 'Offene Rücklieferungen', value: kpis.open, className: 'border-slate-200' },
      {
        key: 'overdue',
        label: 'Überfällig',
        value: kpis.overdue,
        className: 'border-rose-200 bg-rose-50/40',
        onClick: () => setView('overdue'),
      },
      {
        key: 'next',
        label: 'Nächste Mail fällig',
        value: kpis.nextMailDue,
        className: 'border-amber-200 bg-amber-50/40',
        onClick: () => setView('next_mail'),
      },
      {
        key: 's3',
        label: 'Stufe 3 eskaliert',
        value: kpis.stage3,
        className: 'border-slate-200',
      },
      {
        key: 'done',
        label: 'Zurückgeliefert (30 Tage)',
        value: kpis.returnedLast30,
        className: 'border-emerald-200 bg-emerald-50/40',
        onClick: () => setView('done'),
      },
    ],
    [kpis],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" />
            Rücklieferungen
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Hardware-Rückgaben, Mahnstufen und Empfängersteuerung
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold border',
              autoSendEnabled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                : 'bg-slate-100 text-slate-600 border-slate-200',
            )}
          >
            Auto-Versand: {autoSendEnabled ? 'Aktiv' : 'Manuell'}
          </span>
          {canEditSettings ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="w-4 h-4 mr-1.5" />
              Automatik &amp; Empfänger
            </Button>
          ) : null}
          {canImportCsv ? (
            <label className="inline-flex items-center h-9 px-3 rounded-md border border-slate-200 bg-white text-sm font-semibold cursor-pointer hover:bg-slate-50">
              <Upload className="w-4 h-4 mr-1.5" />
              CSV-Import
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void onImportCsv(e.target.files?.[0] || null)}
              />
            </label>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => void bulk('csv_export')}>
            <Download className="w-4 h-4 mr-1.5" />
            CSV-Export
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
            onClick={openCreate}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Neue Rücklieferung erstellen
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpiCards.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onClick}
            className={cn(
              'rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:shadow',
              c.className,
            )}
          >
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="text-2xl font-black mt-1 tabular-nums">{c.value}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-bold border transition',
              view === v.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Suche: RL-Nr., Legacy-ID, Mitarbeiter, PM, Gerät…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={mailStatus}
          onChange={(e) => setMailStatus(e.target.value)}
        >
          <option value="all">Mahnstufe: Alle</option>
          <option value="none">Keine Mail gesendet</option>
          <option value="mail1">1. Mail versendet</option>
          <option value="mail2">2. Mail versendet</option>
          <option value="mail3">3. Mail versendet</option>
          <option value="missing_recipients">Empfänger fehlt</option>
        </select>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={overdueBucket}
          onChange={(e) => setOverdueBucket(e.target.value)}
        >
          <option value="all">Überfälligkeit: Alle</option>
          <option value="not_due">Noch nicht fällig</option>
          <option value="1_7">1–7 Tage</option>
          <option value="8_21">8–21 Tage</option>
          <option value="gt_21">&gt; 21 Tage</option>
        </select>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={exportStatus}
          onChange={(e) => setExportStatus(e.target.value)}
        >
          <option value="all">Export: Alle</option>
          <option value="not_exported">Nicht exportiert</option>
          <option value="exported">Exportiert</option>
        </select>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="due_asc">Älteste Fälligkeit zuerst</option>
          <option value="newest">Neueste zuerst</option>
          <option value="employee">Mitarbeiter A–Z</option>
          <option value="ticket">Rückgabe-Nr.</option>
        </select>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-10 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Laden…
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">Keine Einträge.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === items.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(items.map((i) => returnRowId(i)).filter(Boolean)));
                        } else setSelected(new Set());
                      }}
                    />
                  </th>
                  <th className="p-3">ID</th>
                  <th className="p-3">Mitarbeiter &amp; Kontakte</th>
                  <th className="p-3">Gerätetyp / Seriennummern</th>
                  <th className="p-3">Lieferung &amp; Fälligkeit</th>
                  <th className="p-3">Mahnverlauf</th>
                  <th className="p-3">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => {
                  const hw = it.hardwareReturn;
                  const id = returnRowId(it);
                  const checked = selected.has(id);
                  const employeeName = hw.employee_name || it.ticket.customerName || '—';
                  const employeeEmail = hw.employee_email || it.ticket.customerEmail || '—';
                  return (
                    <tr
                      key={id}
                      className="align-top hover:bg-slate-50/60 cursor-pointer"
                      onClick={() => openEdit(it)}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(id);
                            else next.delete(id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {formatReturnNumber(hw)}
                        </span>
                        {hw.external_ref_id &&
                        String(hw.external_ref_id) !== String(hw.return_number || '') ? (
                          <span className="ml-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                            PA {hw.external_ref_id}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-900">
                          {employeeName}
                        </p>
                        <p className="text-xs text-slate-500">{employeeEmail}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {hw.project_manager_email ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">
                              PM: {hw.project_manager_email}
                            </span>
                          ) : null}
                          {hw.manager_email ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold">
                              Chef: {hw.manager_email}
                            </span>
                          ) : null}
                          {it.mailStatus === 'missing_recipients' || it.missingRoles.length ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 text-[10px] font-bold">
                              <AlertTriangle className="w-3 h-3" /> Empfänger fehlt
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-xs text-slate-700 whitespace-pre-wrap max-w-[220px]">
                        {hw.device_details || '—'}
                      </td>
                      <td className="p-3 text-xs">
                        <p>Lieferung: {formatDateDeOnly(hw.delivery_date)}</p>
                        <p>Fällig: {formatDateDeOnly(hw.return_due_date)}</p>
                        {it.overdueDays > 0 && !hw.returned ? (
                          <span className="inline-flex mt-1 rounded-full bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 text-[10px] font-bold">
                            +{it.overdueDays} Tage überfällig
                          </span>
                        ) : null}
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {([1, 2, 3] as const).map((stage) => {
                            const sentAt =
                              stage === 1
                                ? hw.mail1_sent_at
                                : stage === 2
                                  ? hw.mail2_sent_at
                                  : hw.mail3_sent_at;
                            const recipients =
                              stage === 1
                                ? hw.mail1_sent_recipients
                                : stage === 2
                                  ? hw.mail2_sent_recipients
                                  : hw.mail3_sent_recipients;
                            const tip = sentAt
                              ? `${new Date(sentAt).toLocaleString('de-DE')}\nAn: ${(recipients?.to || []).join(', ') || '—'}\nCC: ${(recipients?.cc || []).join(', ') || '—'}`
                              : 'Noch nicht gesendet — klicken zum Senden';
                            return (
                              <button
                                key={stage}
                                type="button"
                                title={tip}
                                disabled={Boolean(hw.returned)}
                                onClick={() => void openSend(id, stage)}
                                className={cn(
                                  'rounded-full px-2 py-1 text-[10px] font-bold border',
                                  sentAt
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                                )}
                              >
                                {stage}. Mail{sentAt ? ' ✓' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col gap-1.5 items-start">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(it)}
                          >
                            Details öffnen
                          </Button>
                          {!hw.returned ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  await axios.post(
                                    `${base}/${encodeURIComponent(id)}/mark-returned`,
                                    mode === 'staff' ? { organizationId } : {},
                                    { withCredentials: true },
                                  );
                                  toast.success('Als zurückgeliefert markiert');
                                  void load();
                                } catch (err: any) {
                                  toast.error(err?.response?.data?.error || 'Fehler');
                                }
                              }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Zurück
                            </Button>
                          ) : (
                            <span className="text-xs font-bold text-emerald-700">Erledigt</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3 flex flex-wrap items-center gap-2 justify-between">
          <p className="text-sm font-bold">{selected.size} ausgewählt</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void bulk('mark_returned')}>
              Als zurückgeliefert markieren
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void bulk('mark_exported')}>
              Als exportiert markieren
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void bulk('csv_export')}>
              CSV exportieren
            </Button>
          </div>
        </div>
      ) : null}

      {sendModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-black flex items-center gap-2">
                <Mail className="w-4 h-4" /> E-Mail senden — {sendModal.stage}. Mail
              </h3>
              <button type="button" onClick={() => setSendModal(null)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div>
                <Label>An (To)</Label>
                <EmailChips
                  value={sendModal.to}
                  onChange={(to) => setSendModal({ ...sendModal, to })}
                  quickAdd={[
                    {
                      label: 'Mitarbeiter',
                      email:
                        items.find((i) => returnRowId(i) === sendModal.returnId)?.hardwareReturn
                          .employee_email ||
                        items.find((i) => returnRowId(i) === sendModal.returnId)?.ticket
                          .customerEmail,
                    },
                    {
                      label: 'Projektmanager',
                      email: items.find((i) => returnRowId(i) === sendModal.returnId)
                        ?.hardwareReturn.project_manager_email,
                    },
                    {
                      label: 'Chef',
                      email: items.find((i) => returnRowId(i) === sendModal.returnId)
                        ?.hardwareReturn.manager_email,
                    },
                    { label: 'CEO', email: settings?.ceo_email },
                  ]}
                />
              </div>
              <div>
                <Label>CC</Label>
                <EmailChips
                  value={sendModal.cc}
                  onChange={(cc) => setSendModal({ ...sendModal, cc })}
                  quickAdd={[
                    {
                      label: 'Projektmanager',
                      email: items.find((i) => returnRowId(i) === sendModal.returnId)
                        ?.hardwareReturn.project_manager_email,
                    },
                    {
                      label: 'Chef',
                      email: items.find((i) => returnRowId(i) === sendModal.returnId)
                        ?.hardwareReturn.manager_email,
                    },
                    { label: 'CEO', email: settings?.ceo_email },
                  ]}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={sendModal.saveOverride}
                  onChange={(e) =>
                    setSendModal({ ...sendModal, saveOverride: e.target.checked })
                  }
                />
                Als Empfänger für diese Rücklieferung speichern
              </label>
              <div>
                <p className="text-xs font-bold text-slate-500 mb-1">Betreff</p>
                <p className="text-sm font-semibold">{sendModal.subject}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-48 overflow-auto text-xs">
                <div dangerouslySetInnerHTML={{ __html: sendModal.htmlPreview }} />
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSendModal(null)}>
                Abbrechen
              </Button>
              <Button type="button" onClick={() => void confirmSend()} disabled={sending || !sendModal.to.length}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Jetzt senden
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen && settings ? (
        <SettingsDrawer
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
        />
      ) : null}

      <ReturnCreateEditDrawer
        open={drawerOpen}
        mode={mode}
        organizationId={organizationId}
        editItem={editItem}
        members={members}
        orgCeoEmail={settings?.ceo_email || null}
        onClose={() => {
          setDrawerOpen(false);
          setEditItem(null);
        }}
        onSaved={() => void load()}
      />
    </div>
  );
}

function EmailChips(props: {
  value: string[];
  onChange: (next: string[]) => void;
  quickAdd?: Array<{ label: string; email?: string | null }>;
}) {
  const [draft, setDraft] = useState('');
  const add = (email?: string | null) => {
    const e = String(email || draft)
      .trim()
      .toLowerCase();
    if (!e.includes('@')) return;
    if (props.value.includes(e)) return;
    props.onChange([...props.value, e]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-md border border-slate-200 p-2">
        {props.value.map((e) => (
          <span
            key={e}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold"
          >
            {e}
            <button
              type="button"
              onClick={() => props.onChange(props.value.filter((x) => x !== e))}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] text-sm outline-none"
          value={draft}
          placeholder="E-Mail hinzufügen…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {(props.quickAdd || []).map((q) =>
          q.email ? (
            <button
              key={q.label}
              type="button"
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold hover:bg-slate-50"
              onClick={() => add(q.email)}
            >
              + {q.label}
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

function SettingsDrawer(props: {
  settings: Record<string, any>;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [auto, setAuto] = useState(Boolean(props.settings.auto_send_enabled));
  const [mail1, setMail1] = useState(Number(props.settings.mail1_days_after_delivery ?? 14));
  const [mail2, setMail2] = useState(Number(props.settings.mail2_days_after_mail1 ?? 7));
  const [mail3, setMail3] = useState(Number(props.settings.mail3_days_after_mail2 ?? 7));
  const [ceoEmail, setCeoEmail] = useState(String(props.settings.ceo_email || ''));
  const [fallback, setFallback] = useState(String(props.settings.fallback_manager_email || ''));
  const [stageRecipients, setStageRecipients] = useState(props.settings.stage_recipients);
  const [templates, setTemplates] = useState(props.settings.templates);
  const [saving, setSaving] = useState(false);

  const toggleRole = (
    stage: 'mail1' | 'mail2' | 'mail3',
    bucket: 'to_roles' | 'cc_roles',
    role: string,
  ) => {
    setStageRecipients((prev: any) => {
      const cur = { ...(prev || {}) };
      const stageCfg = { ...(cur[stage] || { to_roles: [], cc_roles: [], extra_to: [], extra_cc: [] }) };
      const list: string[] = [...(stageCfg[bucket] || [])];
      const idx = list.indexOf(role);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(role);
      stageCfg[bucket] = list;
      cur[stage] = stageCfg;
      return cur;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-lg bg-white shadow-xl border-l overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
          <h3 className="font-black flex items-center gap-2">
            <Settings2 className="w-4 h-4" /> Automatik &amp; Empfänger
          </h3>
          <button type="button" onClick={props.onClose}>
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          <label className="flex items-center justify-between gap-3 text-sm font-semibold">
            Automatischer Versand aktiv
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Mail 1 nach X Tagen</Label>
              <Input type="number" min={0} value={mail1} onChange={(e) => setMail1(Number(e.target.value))} />
            </div>
            <div>
              <Label>Mail 2 nach X Tagen</Label>
              <Input type="number" min={0} value={mail2} onChange={(e) => setMail2(Number(e.target.value))} />
            </div>
            <div>
              <Label>Mail 3 nach X Tagen</Label>
              <Input type="number" min={0} value={mail3} onChange={(e) => setMail3(Number(e.target.value))} />
            </div>
          </div>
          <div>
            <Label>Geschäftsführung / CEO E-Mail</Label>
            <Input value={ceoEmail} onChange={(e) => setCeoEmail(e.target.value)} />
          </div>
          <div>
            <Label>Fallback Vorgesetzter / IT-Leitung</Label>
            <Input value={fallback} onChange={(e) => setFallback(e.target.value)} />
          </div>

          {(['mail1', 'mail2', 'mail3'] as const).map((stage, idx) => (
            <div key={stage} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <p className="text-sm font-black">{idx + 1}. Mail — Empfänger-Matrix</p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-bold text-slate-500 mb-1">An (To)</p>
                  {Object.keys(ROLE_LABELS).map((role) => (
                    <label key={role} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={(stageRecipients?.[stage]?.to_roles || []).includes(role)}
                        onChange={() => toggleRole(stage, 'to_roles', role)}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
                <div>
                  <p className="font-bold text-slate-500 mb-1">CC</p>
                  {Object.keys(ROLE_LABELS).map((role) => (
                    <label key={role} className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={(stageRecipients?.[stage]?.cc_roles || []).includes(role)}
                        onChange={() => toggleRole(stage, 'cc_roles', role)}
                      />
                      {ROLE_LABELS[role]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Zusätzliche An-Adressen (Komma)</Label>
                <Input
                  value={(stageRecipients?.[stage]?.extra_to || []).join(', ')}
                  onChange={(e) => {
                    const emails = e.target.value
                      .split(/[,;\s]+/)
                      .map((x) => x.trim().toLowerCase())
                      .filter((x) => x.includes('@'));
                    setStageRecipients((prev: any) => ({
                      ...prev,
                      [stage]: { ...prev[stage], extra_to: emails },
                    }));
                  }}
                />
              </div>
              <div>
                <Label>Betreff</Label>
                <Input
                  value={templates?.[stage]?.subject || ''}
                  onChange={(e) =>
                    setTemplates((prev: any) => ({
                      ...prev,
                      [stage]: { ...prev[stage], subject: e.target.value },
                    }))
                  }
                />
              </div>
              <div>
                <Label>Text (Platzhalter: {'{{mitarbeiter}}'}, {'{{geraet}}'}, {'{{lieferdatum}}'}, {'{{tage_ueberfaellig}}'}, {'{{ticket_id}}'})</Label>
                <textarea
                  className="w-full min-h-[90px] rounded-md border border-slate-200 p-2 text-sm"
                  value={templates?.[stage]?.body || ''}
                  onChange={(e) =>
                    setTemplates((prev: any) => ({
                      ...prev,
                      [stage]: { ...prev[stage], body: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
          ))}

          <Button
            type="button"
            className="w-full"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await props.onSave({
                  auto_send_enabled: auto,
                  mail1_days_after_delivery: mail1,
                  mail2_days_after_mail1: mail2,
                  mail3_days_after_mail2: mail3,
                  ceo_email: ceoEmail.trim() || null,
                  fallback_manager_email: fallback.trim() || null,
                  stage_recipients: stageRecipients,
                  templates,
                });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Clock className="w-4 h-4 mr-1.5" />}
            Speichern
          </Button>
        </div>
      </div>
    </div>
  );
}
