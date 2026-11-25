import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Mail,
  MailWarning,
  Package,
  PackageOpen,
  PanelRight,
  Plug,
  PlugZap,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Tablet,
  Upload,
  X,
  Zap,
  type LucideIcon,
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
import {
  formatDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';

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
  // Prefer short RL-style fallback over raw UUID when return_number is missing.
  if (/^[0-9a-f-]{36}$/i.test(id)) return `#RL-${id.slice(0, 4).toUpperCase()}`;
  return id ? `#${id.slice(0, 8).toUpperCase()}` : '#RL-—';
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

function DueCountdownPill({
  overdueDays,
  dueDate,
  returned,
}: {
  overdueDays: number;
  dueDate: unknown;
  returned: boolean;
}) {
  if (returned) return null;
  const remaining = daysUntilDue(dueDate, overdueDays);
  if (remaining == null) return null;
  if (remaining < 0) {
    return (
      <span className="inline-flex mt-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100 px-2 py-0.5 text-[10px] font-bold">
        +{Math.abs(remaining)} Tage überfällig
      </span>
    );
  }
  if (remaining === 0) {
    return (
      <span className="inline-flex mt-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 text-[10px] font-bold">
        Heute fällig
      </span>
    );
  }
  return (
    <span className="inline-flex mt-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold">
      Noch {remaining} Tage
    </span>
  );
}

type DeviceVisual = {
  Icon: LucideIcon;
  iconClass: string;
  wrapClass: string;
};

function resolveDeviceVisual(deviceDetails: string): DeviceVisual {
  const t = deviceDetails.toLowerCase();
  if (/secutest|prüfgerät|pruefgeraet|mxtra|gossen|messgerät|messgeraet/.test(t)) {
    return {
      Icon: Zap,
      iconClass: 'text-sky-700',
      wrapClass: 'bg-sky-50 border-sky-100',
    };
  }
  if (/adapter|prcd|vl2e|\bbt\b|kabel|leitung/.test(t)) {
    return {
      Icon: Plug,
      iconClass: 'text-indigo-700',
      wrapClass: 'bg-indigo-50 border-indigo-100',
    };
  }
  if (/tablet|dock|tastatur|laptop|getac|notebook/.test(t)) {
    return {
      Icon: Tablet,
      iconClass: 'text-slate-600',
      wrapClass: 'bg-slate-100 border-slate-200',
    };
  }
  return {
    Icon: Package,
    iconClass: 'text-slate-500',
    wrapClass: 'bg-slate-50 border-slate-200',
  };
}

function renderDeviceDetails(raw: string | null | undefined) {
  const text = String(raw || '').trim();
  if (!text) return <span className="text-slate-400">—</span>;
  const visual = resolveDeviceVisual(text);
  const Icon = visual.Icon;
  // Highlight ALT / NEU serial snippets as monospace badges.
  const parts = text.split(/(\b(?:ALT|NEU)\s*[:#]?\s*[A-Za-z0-9\-_/]+)/gi);
  return (
    <div className="flex items-start gap-2.5 max-w-[260px]">
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
          visual.wrapClass,
        )}
      >
        <Icon className={cn('w-4 h-4', visual.iconClass)} />
      </span>
      <div className="min-w-0 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
        {parts.map((part, idx) => {
          if (/^\s*(ALT|NEU)\b/i.test(part)) {
            return (
              <span
                key={idx}
                className="inline-flex mx-0.5 rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 align-middle"
              >
                {part.trim()}
              </span>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </div>
    </div>
  );
}

function MailStageStepper({
  hw,
  returnId,
  nextDueStage,
  onOpenSend,
}: {
  hw: Record<string, any>;
  returnId: string;
  nextDueStage: 1 | 2 | 3 | null;
  onOpenSend: (returnId: string, stage: 1 | 2 | 3) => void;
}) {
  const stamps = [hw.mail1_sent_at, hw.mail2_sent_at, hw.mail3_sent_at] as const;
  const recipientStamps = [
    hw.mail1_sent_recipients,
    hw.mail2_sent_recipients,
    hw.mail3_sent_recipients,
  ] as const;

  return (
    <div className="flex items-center gap-0 min-w-[168px]">
      {([1, 2, 3] as const).map((stage, idx) => {
        const sentAt = stamps[idx];
        const recipients = recipientStamps[idx];
        const done = Boolean(sentAt);
        const prevDone = idx === 0 ? false : Boolean(stamps[idx - 1]);
        const isNext = !done && nextDueStage === stage && !hw.returned;
        const tip = sentAt
          ? `${new Date(sentAt).toLocaleString('de-DE')}\nAn: ${(recipients?.to || []).join(', ') || '—'}\nCC: ${(recipients?.cc || []).join(', ') || '—'}`
          : isNext
            ? 'Nächste fällige Stufe — klicken zum Senden'
            : 'Noch nicht gesendet — klicken zum Senden';
        return (
          <div key={stage} className="flex items-center">
            {idx > 0 ? (
              <div
                className={cn('h-0.5 w-3 sm:w-4', prevDone ? 'bg-emerald-300' : 'bg-slate-200')}
              />
            ) : null}
            <button
              type="button"
              title={tip}
              disabled={Boolean(hw.returned)}
              onClick={() => onOpenSend(returnId, stage)}
              className={cn(
                'relative flex h-8 min-w-[2.75rem] items-center justify-center gap-0.5 rounded-full border px-2 text-[10px] font-bold transition',
                done
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isNext
                    ? 'bg-amber-50 text-amber-800 border-amber-300 ring-2 ring-amber-100'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400',
                hw.returned && 'opacity-60 cursor-not-allowed',
              )}
            >
              {done ? <Check className="w-3 h-3 shrink-0" /> : null}
              <span>{stage}.</span>
            </button>
          </div>
        );
      })}
    </div>
  );
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
      {
        key: 'open',
        label: 'Offene Rücklieferungen',
        value: kpis.open,
        accent: 'border-t-sky-500',
        Icon: PackageOpen,
        iconWrap: 'bg-sky-50 text-sky-700 border-sky-100',
        onClick: () => setView('open'),
      },
      {
        key: 'overdue',
        label: 'Überfällig',
        value: kpis.overdue,
        accent: 'border-t-rose-500',
        Icon: AlertTriangle,
        iconWrap: 'bg-rose-50 text-rose-700 border-rose-100',
        onClick: () => setView('overdue'),
      },
      {
        key: 'next',
        label: 'Nächste Mail fällig',
        value: kpis.nextMailDue,
        accent: 'border-t-amber-500',
        Icon: MailWarning,
        iconWrap: 'bg-amber-50 text-amber-800 border-amber-100',
        onClick: () => setView('next_mail'),
      },
      {
        key: 's3',
        label: 'Stufe 3 eskaliert',
        value: kpis.stage3,
        accent: 'border-t-violet-500',
        Icon: ShieldAlert,
        iconWrap: 'bg-violet-50 text-violet-700 border-violet-100',
        onClick: () => {
          setView('open');
          setMailStatus('mail3');
        },
      },
      {
        key: 'done',
        label: 'Zurückgeliefert (30 Tage)',
        value: kpis.returnedLast30,
        accent: 'border-t-emerald-500',
        Icon: CheckCircle2,
        iconWrap: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        onClick: () => setView('done'),
      },
    ],
    [kpis],
  );

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50 to-slate-50 text-sky-700 shadow-sm">
            <PlugZap className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-slate-900">
              Rücklieferungen
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Hardware-Rückgaben, Mahnstufen und Empfängersteuerung
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
        {kpiCards.map((c) => {
          const Icon = c.Icon;
          return (
            <button
              key={c.key}
              type="button"
              onClick={c.onClick}
              className={cn(
                'rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:shadow border-t-2',
                c.accent,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 leading-snug">
                  {c.label}
                </p>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                    c.iconWrap,
                  )}
                >
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <p className="text-2xl font-black mt-2 tabular-nums text-slate-900">{c.value}</p>
            </button>
          );
        })}
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
                        <div className="flex flex-col items-start gap-1">
                          <span className="font-mono text-xs font-bold text-slate-800">
                            {formatReturnNumber(hw)}
                          </span>
                          {hw.external_ref_id &&
                          String(hw.external_ref_id) !== String(hw.return_number || '') ? (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 border border-slate-200">
                              PA {hw.external_ref_id}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3">
                        <p className="font-semibold text-slate-900">{employeeName}</p>
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
                      <td className="p-3">{renderDeviceDetails(hw.device_details)}</td>
                      <td className="p-3 text-xs">
                        <p className="text-slate-700">
                          <span className="text-slate-400 font-medium">Lieferung:</span>{' '}
                          {formatDateDeOnly(hw.delivery_date)}
                        </p>
                        <p className="text-slate-800 font-semibold mt-0.5">
                          Fällig: {formatDateDeOnly(hw.return_due_date)}
                        </p>
                        <DueCountdownPill
                          overdueDays={it.overdueDays}
                          dueDate={hw.return_due_date || hw.delivery_date}
                          returned={Boolean(hw.returned)}
                        />
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <MailStageStepper
                          hw={hw}
                          returnId={id}
                          nextDueStage={it.nextDueStage}
                          onOpenSend={(rid, stage) => void openSend(rid, stage)}
                        />
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-row flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => openEdit(it)}
                            title="Details öffnen"
                          >
                            <PanelRight className="w-3.5 h-3.5 mr-1" />
                            Details
                          </Button>
                          {!hw.returned ? (
                            <>
                              {it.nextDueStage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-amber-200 text-amber-800 hover:bg-amber-50"
                                  onClick={() => void openSend(id, it.nextDueStage!)}
                                  title={`${it.nextDueStage}. Mail senden`}
                                >
                                  <Mail className="w-3.5 h-3.5 mr-1" />
                                  {it.nextDueStage}. Mail
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
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
                            </>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 px-2">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Erledigt
                            </span>
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
          organizationId={organizationId}
          apiBase={base}
          mode={mode}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onSettingsRefresh={(next) => {
            setSettings(next);
            setAutoSendEnabled(Boolean(next?.auto_send_enabled));
          }}
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
  organizationId: string;
  apiBase: string;
  mode: WorkbenchMode;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onSettingsRefresh?: (next: Record<string, any>) => void;
}) {
  const syncCfg = props.settings.m365_directory_sync || {};
  const [auto, setAuto] = useState(Boolean(props.settings.auto_send_enabled));
  const [mail1, setMail1] = useState(Number(props.settings.mail1_days_after_delivery ?? 14));
  const [mail2, setMail2] = useState(Number(props.settings.mail2_days_after_mail1 ?? 7));
  const [mail3, setMail3] = useState(Number(props.settings.mail3_days_after_mail2 ?? 7));
  const [ceoEmail, setCeoEmail] = useState(String(props.settings.ceo_email || ''));
  const [fallback, setFallback] = useState(String(props.settings.fallback_manager_email || ''));
  const [stageRecipients, setStageRecipients] = useState(props.settings.stage_recipients);
  const [templates, setTemplates] = useState(props.settings.templates);
  const [dirSyncEnabled, setDirSyncEnabled] = useState(Boolean(syncCfg.enabled));
  const [entraGroupId, setEntraGroupId] = useState(String(syncCfg.entra_group_id || ''));
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(syncCfg.last_synced_at || null);
  const [lastSyncCount, setLastSyncCount] = useState(Number(syncCfg.last_sync_count || 0));
  const [lastSyncError, setLastSyncError] = useState<string | null>(syncCfg.last_sync_error || null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const runDirectorySync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(
        `${props.apiBase}/directory-sync`,
        props.mode === 'staff' ? { organizationId: props.organizationId } : {},
        {
          withCredentials: true,
          params: props.mode === 'staff' ? { organizationId: props.organizationId } : undefined,
        },
      );
      setLastSyncedAt(res.data?.lastSyncedAt || new Date().toISOString());
      setLastSyncCount(Number(res.data?.syncedCount || 0));
      setLastSyncError(null);
      toast.success(`${res.data?.syncedCount || 0} Mitarbeiter synchronisiert`);
      try {
        const settingsRes = await axios.get(
          `${props.apiBase}/settings${
            props.mode === 'staff' ? `?organizationId=${encodeURIComponent(props.organizationId)}` : ''
          }`,
          { withCredentials: true },
        );
        if (settingsRes.data?.hardware_returns_config) {
          props.onSettingsRefresh?.(settingsRes.data.hardware_returns_config);
        }
      } catch {
        /* ignore refresh failure */
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Synchronisation fehlgeschlagen';
      setLastSyncError(msg);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

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
          <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Plug className="w-4 h-4 text-sky-700" />
                  M365 Mitarbeiter-Sync (Entra ID)
                </p>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Synchronisiert Mitarbeitende aus Microsoft Entra für die Autovervollständigung.
                  Nutzt die vorhandenen M365 Tenant &amp; Send-As Zugangsdaten (Application Permissions{' '}
                  <code className="text-[10px]">User.Read.All</code>
                  {entraGroupId ? (
                    <>
                      {' '}
                      / <code className="text-[10px]">GroupMember.Read.All</code>
                    </>
                  ) : null}
                  ).
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
                Aktiv
                <input
                  type="checkbox"
                  checked={dirSyncEnabled}
                  onChange={(e) => setDirSyncEnabled(e.target.checked)}
                />
              </label>
            </div>
            <div>
              <Label>Entra ID Gruppen-ID (optional)</Label>
              <Input
                value={entraGroupId}
                onChange={(e) => setEntraGroupId(e.target.value)}
                placeholder="Leer = alle aktiven Member-Benutzer"
              />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-slate-600">
              <span>
                {lastSyncedAt
                  ? `Zuletzt synchronisiert: ${new Date(lastSyncedAt).toLocaleString('de-DE', {
                      timeZone: 'Europe/Berlin',
                    })} (${lastSyncCount} Mitarbeiter)`
                  : 'Noch nicht synchronisiert'}
              </span>
              <Button
                type="button"
                variant="outline"
                className="h-8 text-xs font-bold"
                disabled={syncing}
                onClick={() => void runDirectorySync()}
              >
                {syncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : (
                  <Zap className="w-3.5 h-3.5 mr-1.5" />
                )}
                Jetzt synchronisieren
              </Button>
            </div>
            {lastSyncError ? (
              <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">
                {lastSyncError}
              </p>
            ) : null}
          </div>

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
                  m365_directory_sync: {
                    ...(props.settings.m365_directory_sync || {}),
                    enabled: dirSyncEnabled,
                    entra_group_id: entraGroupId.trim() || null,
                  },
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
