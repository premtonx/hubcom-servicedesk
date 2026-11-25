import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Mail,
  Package,
  PackageCheck,
  PackageOpen,
  PanelRight,
  Plug,
  PlugZap,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Tablet,
  Undo2,
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
  formatDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';
import { ReturnsCsvImportModal } from './ReturnsCsvImportModal';
import {
  ReturnsViewModeSelector,
  type ReturnsLayoutMode,
} from './ReturnsViewModeSelector';
import { ReturnsKanbanBoard } from './ReturnsKanbanBoard';
import { ReturnsCardGrid } from './ReturnsCardGrid';
import { DEFAULT_RETURN_STATUSES } from '../../lib/client-portal/hardware-returns-layout';
import {
  DeviceSerialPopover,
  InlineStatusSelect,
  type DeviceFieldsPatch,
} from './ReturnsInlineEditors';

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
  { id: 'done', label: 'Erledigt' },
  { id: 'all', label: 'Alle' },
] as const;

const PAGE_SIZE_OPTIONS = [20, 50, 100, 'all'] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

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

/** True when return_number is missing, UUID-slice, or RL-LEGACY placeholder. */
function isLegacyOrUuidReturnNumber(returnNumber: string | null | undefined): boolean {
  const raw = String(returnNumber || '').trim();
  if (!raw) return true;
  if (/^RL-LEGACY-/i.test(raw)) return true;
  if (/^[0-9a-f]{6,12}$/i.test(raw)) return true;
  return false;
}

/** Display #DPG-1 style IDs — never raw UUID slices like #c6175496. */
function formatReturnNumber(hw: Record<string, any>): string {
  const n = String(hw.return_number || '').trim();
  if (n && !isLegacyOrUuidReturnNumber(n)) {
    return n.startsWith('#') ? n : `#${n}`;
  }
  return '#—';
}

function initialsFromName(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function formatBerlinDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function statusBadgeClass(status: string): string {
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

function DeviceLine({
  kind,
  type,
  serial,
}: {
  kind: 'alt' | 'neu';
  type?: string | null;
  serial?: string | null;
}) {
  const label = String(type || '').trim();
  const sn = String(serial || '').trim();
  if (!label && !sn) return null;
  const visual = resolveDeviceVisual(`${label} ${sn}`);
  const Icon = visual.Icon;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
          visual.wrapClass,
        )}
      >
        <Icon className={cn('w-3.5 h-3.5', visual.iconClass)} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex rounded px-1.5 py-0.5 text-[9px] font-black tracking-wide border',
              kind === 'alt'
                ? 'bg-amber-50 text-amber-800 border-amber-100'
                : 'bg-sky-50 text-sky-800 border-sky-100',
            )}
          >
            {kind === 'alt' ? 'ALT' : 'NEU'}
          </span>
          <span className="text-xs font-semibold text-slate-800 truncate">
            {label || '—'}
          </span>
        </div>
        {sn ? (
          <p className="font-mono text-[10px] text-slate-500 mt-0.5 truncate">{sn}</p>
        ) : null}
      </div>
    </div>
  );
}

function renderDeviceColumn(hw: Record<string, any>) {
  const hasStructured =
    hw.device_old_type ||
    hw.device_old_serial ||
    hw.device_new_type ||
    hw.device_new_serial;
  if (hasStructured) {
    return (
      <div className="space-y-2 max-w-[280px]">
        <DeviceLine kind="alt" type={hw.device_old_type} serial={hw.device_old_serial} />
        <DeviceLine kind="neu" type={hw.device_new_type} serial={hw.device_new_serial} />
        {!hw.device_old_type &&
        !hw.device_old_serial &&
        !hw.device_new_type &&
        !hw.device_new_serial ? (
          <span className="text-slate-400">—</span>
        ) : null}
      </div>
    );
  }
  const text = String(hw.device_details || '').trim();
  if (!text) return <span className="text-slate-400">—</span>;
  const visual = resolveDeviceVisual(text);
  const Icon = visual.Icon;
  return (
    <div className="flex items-start gap-2.5 max-w-[280px]">
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
          visual.wrapClass,
        )}
      >
        <Icon className={cn('w-4 h-4', visual.iconClass)} />
      </span>
      <p className="min-w-0 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{text}</p>
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

const DEFAULT_CATALOG_LISTS = {
  statuses: ['Neu', 'Warten auf Third Level', 'In Bearbeitung', 'Geschlossen'],
  device_types: [
    'VL2E Adapter',
    'Secutest Pro',
    'Secutest S2 N+10',
    'PRCD Adapter',
    'BT Adapter',
    'Tablet & Dockingstation',
  ],
  service_levels: ['1', '2', '3'],
  slas: ['Niedrig', 'Normal', 'Hoch'],
  shipping_methods: [
    'Standard',
    'Express',
    'E-9 Express',
    'E-1030 Express',
    'E-1200 Express',
    'E-Samstag Express',
    'Samstag',
  ],
};

export function ReturnsWorkbench({
  mode,
  organizationId,
  canEditSettings = false,
  canImportCsv = false,
}: ReturnsWorkbenchProps) {
  const base = mode === 'portal' ? '/api/portal/returns' : '/api/returns';
  const orgQ = mode === 'staff' ? `organizationId=${encodeURIComponent(organizationId)}` : '';

  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('open');
  const [layoutMode, setLayoutMode] = useState<ReturnsLayoutMode>('list');
  const [q, setQ] = useState('');
  const [mailStatus, setMailStatus] = useState('all');
  const [overdueBucket, setOverdueBucket] = useState('all');
  const [exportStatus, setExportStatus] = useState('all');
  const [shippingMethod, setShippingMethod] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sort, setSort] = useState('due_asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(20);
  const [total, setTotal] = useState(0);
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
  const [csvImportOpen, setCsvImportOpen] = useState(false);
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
  const navigate = useNavigate();

  const openCreate = () => {
    if (mode === 'portal') {
      navigate('/portal/returns/new');
      return;
    }
    navigate(`/tickets/kunden/${encodeURIComponent(organizationId)}/returns/new`);
  };

  const openEdit = (it: ListItem) => {
    const id = returnRowId(it);
    if (!id) {
      toast.error('Rücklieferung ohne ID — bitte neu laden.');
      return;
    }
    if (mode === 'portal') {
      navigate(`/portal/returns/${encodeURIComponent(id)}`);
      return;
    }
    navigate(
      `/tickets/kunden/${encodeURIComponent(organizationId)}/returns/${encodeURIComponent(id)}`,
    );
  };

  // Kanban / Karten need the full filtered set so columns/grid stay complete.
  const boardMode = layoutMode === 'kanban' || layoutMode === 'cards';
  const effectiveLimit = boardMode ? 2000 : pageSize === 'all' ? 2000 : pageSize;
  const effectiveOffset = boardMode || pageSize === 'all' ? 0 : (page - 1) * pageSize;

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
        limit: String(effectiveLimit),
        offset: String(effectiveOffset),
      });
      if (shippingMethod !== 'all') params.set('shippingMethod', shippingMethod);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (assigneeFilter !== 'all') params.set('assignee', assigneeFilter);
      if (mode === 'staff') params.set('organizationId', organizationId);
      const res = await axios.get(`${base}?${params.toString()}`, { withCredentials: true });
      setItems(res.data?.items || []);
      setTotal(Number(res.data?.total || 0));
      setKpis(res.data?.kpis || kpis);
      setAutoSendEnabled(Boolean(res.data?.autoSendEnabled));
      setSettings(res.data?.settings || null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Laden fehlgeschlagen');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [
    organizationId,
    view,
    q,
    mailStatus,
    overdueBucket,
    exportStatus,
    shippingMethod,
    statusFilter,
    assigneeFilter,
    sort,
    effectiveLimit,
    effectiveOffset,
    base,
    mode,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Reset to page 1 whenever search, filters, view tabs, layout, or page size change. */
  useEffect(() => {
    setPage(1);
  }, [
    view,
    q,
    mailStatus,
    overdueBucket,
    exportStatus,
    shippingMethod,
    statusFilter,
    assigneeFilter,
    sort,
    pageSize,
    layoutMode,
  ]);

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

  const catalogStatuses: string[] = settings?.catalogs?.statuses?.length
    ? settings.catalogs.statuses
    : [...DEFAULT_RETURN_STATUSES];
  const catalogShipping: string[] = settings?.catalogs?.shipping_methods?.length
    ? settings.catalogs.shipping_methods
    : ['Standard', 'Express', 'E-9 Express', 'E-1030 Express', 'E-1200 Express', 'E-Samstag Express', 'Samstag'];
  const catalogDeviceTypes: string[] = settings?.catalogs?.device_types?.length
    ? settings.catalogs.device_types
    : [...DEFAULT_CATALOG_LISTS.device_types];

  const patchReturnFields = async (
    it: ListItem,
    patch: Record<string, unknown>,
    opts?: { successToast?: string; mergeLocal?: Record<string, unknown> },
  ) => {
    const id = returnRowId(it);
    if (!id) return;
    const prev = items;
    if (opts?.mergeLocal) {
      setItems((list) =>
        list.map((row) =>
          returnRowId(row) === id
            ? {
                ...row,
                hardwareReturn: { ...row.hardwareReturn, ...opts.mergeLocal },
              }
            : row,
        ),
      );
    }
    try {
      await axios.patch(
        `${base}/${encodeURIComponent(id)}`,
        {
          ...(typeof patch.status === 'string' ? { status: patch.status } : {}),
          hardwareReturn: patch,
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      if (opts?.successToast) toast.success(opts.successToast);
    } catch (err: any) {
      setItems(prev);
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
      throw err;
    }
  };

  const patchReturnStatus = async (it: ListItem, nextStatus: string) => {
    const current = String(it.hardwareReturn.status || 'Neu').trim() || 'Neu';
    if (current.toLowerCase() === nextStatus.toLowerCase()) return;
    try {
      await patchReturnFields(
        it,
        { status: nextStatus },
        { successToast: `Status → ${nextStatus}`, mergeLocal: { status: nextStatus } },
      );
    } catch {
      /* rolled back in patchReturnFields */
    }
  };

  const patchDeviceFields = async (it: ListItem, fields: DeviceFieldsPatch) => {
    await patchReturnFields(it, fields, {
      successToast: 'Gerätetyp & Seriennummern gespeichert',
      mergeLocal: fields,
    });
  };

  const markReturnedItem = async (it: ListItem) => {
    const id = returnRowId(it);
    if (!id) return;
    try {
      await axios.post(
        `${base}/${encodeURIComponent(id)}/mark-returned`,
        mode === 'staff' ? { organizationId } : {},
        { withCredentials: true },
      );
      toast.success('Eingang bestätigt');
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Fehler');
    }
  };

  const unreturnItem = async (it: ListItem) => {
    try {
      await patchReturnFields(
        it,
        { returned: false, returned_at: null },
        {
          successToast: 'Eingang zurückgesetzt',
          mergeLocal: { returned: false, returned_at: null },
        },
      );
      void load();
    } catch {
      /* rolled back */
    }
  };

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of items) {
      const hw = it.hardwareReturn;
      const id = String(hw.assignee_user_id || '').trim();
      const name = String(hw.assignee_name || '').trim() || 'Support';
      const key = id || name.toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, name);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [items]);

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
        key: 's3',
        label: '3. Erinnerung gesendet',
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

  const pageCount =
    pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / (pageSize as number)));
  const rangeFrom = total === 0 ? 0 : pageSize === 'all' ? 1 : (page - 1) * (pageSize as number) + 1;
  const rangeTo =
    total === 0 ? 0 : pageSize === 'all' ? total : Math.min(total, page * (pageSize as number));

  const PaginationBar = ({ className }: { className?: string }) => (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm',
        className,
      )}
    >
      <p className="text-xs font-medium text-slate-600">
        Zeige {rangeFrom}–{rangeTo} von {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="font-semibold">Pro Seite</span>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold"
            value={pageSize === 'all' ? 'all' : String(pageSize)}
            onChange={(e) => {
              const v = e.target.value;
              setPageSize(v === 'all' ? 'all' : (Number(v) as 20 | 50 | 100));
            }}
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">Alle</option>
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page <= 1 || pageSize === 'all'}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Zurück
        </Button>
        <span className="text-xs text-slate-500 tabular-nums">
          Seite {pageSize === 'all' ? 1 : page}/{pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={page >= pageCount || pageSize === 'all'}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
        >
          Weiter
        </Button>
      </div>
    </div>
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
              Hardware-Rückgaben, Erinnerungsstufen und Empfängersteuerung
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
              Einstellungen &amp; Listen
            </Button>
          ) : null}
          {canImportCsv ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCsvImportOpen(true)}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              CSV-Import
            </Button>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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

      <div className="flex flex-wrap items-center gap-2 justify-between">
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
        <ReturnsViewModeSelector value={layoutMode} onChange={setLayoutMode} />
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
          <option value="all">Erinnerungsstufe: Alle</option>
          <option value="none">Keine Erinnerung gesendet</option>
          <option value="mail1">1. Erinnerung versendet</option>
          <option value="mail2">2. Erinnerung versendet</option>
          <option value="mail3">3. Erinnerung versendet</option>
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
          value={shippingMethod}
          onChange={(e) => setShippingMethod(e.target.value)}
        >
          <option value="all">Versandart: Alle</option>
          {catalogShipping.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Status: Alle</option>
          {catalogStatuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="all">Bearbeiter: Alle</option>
          {assigneeOptions.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
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
        {!loading && total > 0 && layoutMode === 'list' ? (
          <PaginationBar className="border-b border-slate-100 bg-slate-50/60" />
        ) : null}
        {loading ? (
          <div className="p-10 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Laden…
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">Keine Einträge.</div>
        ) : layoutMode === 'kanban' ? (
          <ReturnsKanbanBoard
            items={items}
            catalogStatuses={catalogStatuses}
            onOpenDetails={openEdit}
            onMarkReturned={(it) => void markReturnedItem(it)}
            onUnreturn={(it) => void unreturnItem(it)}
            onStatusChange={(it, status) => void patchReturnStatus(it, status)}
          />
        ) : layoutMode === 'cards' ? (
          <ReturnsCardGrid
            items={items}
            catalogStatuses={catalogStatuses}
            onOpenDetails={openEdit}
            onMarkReturned={(it) => void markReturnedItem(it)}
            onUnreturn={(it) => void unreturnItem(it)}
            onStatusChange={(it, status) => void patchReturnStatus(it, status)}
          />
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
                  <th className="p-3">Mitarbeiter</th>
                  <th className="p-3">Bearbeiter</th>
                  <th className="p-3">Gerätetyp / Seriennummern</th>
                  <th className="p-3">Status &amp; Rückgabe</th>
                  <th className="p-3">Lieferung &amp; Fälligkeit</th>
                  <th className="p-3">Erinnerungsverlauf</th>
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
                  const assigneeName = String(hw.assignee_name || '').trim() || 'Support';
                  const statusLabel = String(hw.status || 'Neu').trim() || 'Neu';
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
                          <span className="font-mono text-xs font-black text-blue-800 tracking-tight">
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
                      <td className="p-3">
                        <div className="flex items-center gap-2 min-w-[140px]">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-black text-white">
                            {initialsFromName(assigneeName)}
                          </span>
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {assigneeName}
                          </span>
                        </div>
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <DeviceSerialPopover
                          deviceTypes={catalogDeviceTypes}
                          initial={{
                            device_old_type: hw.device_old_type || null,
                            device_old_serial: hw.device_old_serial || null,
                            device_new_type: hw.device_new_type || null,
                            device_new_serial: hw.device_new_serial || null,
                          }}
                          renderReadOnly={renderDeviceColumn(hw)}
                          onSave={(fields) => patchDeviceFields(it, fields)}
                        />
                      </td>
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col items-start gap-1.5">
                          <InlineStatusSelect
                            value={statusLabel}
                            statuses={catalogStatuses}
                            onChange={(status) => void patchReturnStatus(it, status)}
                          />
                          {hw.returned ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold">
                              <PackageCheck className="w-3 h-3" />
                              Eingegangen am{' '}
                              {formatBerlinDateTime(hw.returned_at) ||
                                formatDateDeOnly(hw.returned_at) ||
                                '—'}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        <p className="text-slate-700">
                          <span className="text-slate-400 font-medium">Lieferung:</span>{' '}
                          {formatDateDeOnly(hw.delivery_date)}
                        </p>
                        <p className="text-slate-800 font-semibold mt-0.5">
                          Fällig: {formatDateDeOnly(hw.return_due_date)}
                        </p>
                        {hw.shipping_method ? (
                          <p className="text-slate-500 mt-0.5">Versand: {hw.shipping_method}</p>
                        ) : null}
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
                                  title={`${it.nextDueStage}. Erinnerung senden`}
                                >
                                  <Mail className="w-3.5 h-3.5 mr-1" />
                                  {it.nextDueStage}. Erinnerung
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                                title="Eingang bestätigen"
                                onClick={() => void markReturnedItem(it)}
                              >
                                <PackageCheck className="w-3.5 h-3.5 mr-1" />
                                Eingang bestätigen
                              </Button>
                            </>
                          ) : (
                            <div className="flex flex-col items-start gap-1">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-2 py-0.5 text-[10px] font-bold">
                                <PackageCheck className="w-3 h-3" />
                                Eingegangen
                                {formatBerlinDateTime(hw.returned_at)
                                  ? ` am ${formatBerlinDateTime(hw.returned_at)}`
                                  : ''}
                              </span>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px] text-slate-500 hover:text-slate-800"
                                title="Eingang rückgängig machen"
                                onClick={() => void unreturnItem(it)}
                              >
                                <Undo2 className="w-3 h-3 mr-1" />
                                Rückgängig
                              </Button>
                            </div>
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
        {!loading && total > 0 && layoutMode === 'list' ? (
          <PaginationBar className="border-t border-slate-100 bg-slate-50/60" />
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="sticky bottom-4 z-10 mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3 flex flex-wrap items-center gap-2 justify-between">
          <p className="text-sm font-bold">{selected.size} ausgewählt</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void bulk('mark_returned')}>
              Eingang bestätigen
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
                <Mail className="w-4 h-4" /> E-Mail senden — {sendModal.stage}. Erinnerung
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

      {settingsOpen ? (
        <SettingsDrawer
          settings={settings || {}}
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

      {canImportCsv ? (
        <ReturnsCsvImportModal
          open={csvImportOpen}
          onOpenChange={setCsvImportOpen}
          mode={mode}
          organizationId={organizationId}
          apiBase={base}
          idPrefix={String(settings?.id_prefix || 'DPG')}
          onImported={() => {
            void load();
          }}
        />
      ) : null}

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

type SettingsTab = 'catalogs' | 'reminders' | 'm365';

function CatalogTagList(props: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (props.items.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setDraft('');
      return;
    }
    props.onChange([...props.items, v]);
    setDraft('');
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
      <div>
        <p className="text-sm font-black text-slate-900">{props.label}</p>
        {props.hint ? <p className="text-[11px] text-slate-500 mt-0.5">{props.hint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5 min-h-[36px]">
        {props.items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 pl-2.5 pr-1 py-1 text-xs font-semibold text-slate-700"
          >
            {item}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-slate-200 text-slate-500"
              onClick={() => props.onChange(props.items.filter((x) => x !== item))}
              aria-label={`${item} entfernen`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        {props.items.length === 0 ? (
          <span className="text-xs text-slate-400">Noch keine Einträge</span>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-9"
          value={draft}
          placeholder="Name tippen…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" className="h-9 shrink-0 font-bold" onClick={add}>
          <Plus className="w-4 h-4 mr-1" />
          Hinzufügen
        </Button>
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
  const cats = props.settings.catalogs || {};
  const [tab, setTab] = useState<SettingsTab>('catalogs');
  const [idPrefix, setIdPrefix] = useState(String(props.settings.id_prefix || 'DPG'));
  const [statuses, setStatuses] = useState<string[]>(
    cats.statuses?.length ? [...cats.statuses] : [...DEFAULT_CATALOG_LISTS.statuses],
  );
  const [deviceTypes, setDeviceTypes] = useState<string[]>(
    cats.device_types?.length ? [...cats.device_types] : [...DEFAULT_CATALOG_LISTS.device_types],
  );
  const [serviceLevels, setServiceLevels] = useState<string[]>(
    cats.service_levels?.length
      ? [...cats.service_levels]
      : [...DEFAULT_CATALOG_LISTS.service_levels],
  );
  const [slas, setSlas] = useState<string[]>(
    cats.slas?.length ? [...cats.slas] : [...DEFAULT_CATALOG_LISTS.slas],
  );
  const [shippingMethods, setShippingMethods] = useState<string[]>(
    cats.shipping_methods?.length
      ? [...cats.shipping_methods]
      : [...DEFAULT_CATALOG_LISTS.shipping_methods],
  );
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

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'catalogs', label: 'Listen & Dropdowns' },
    { id: 'reminders', label: 'Erinnerungswesen & Empfänger' },
    { id: 'm365', label: 'M365 Mitarbeiter-Sync' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-2xl bg-white shadow-xl border-l flex flex-col min-h-0">
        <div className="shrink-0 border-b px-5 py-4 flex items-center justify-between gap-3">
          <h3 className="font-black flex items-center gap-2 text-slate-900">
            <Settings2 className="w-4 h-4" /> Einstellungen &amp; Listen
          </h3>
          <button type="button" onClick={props.onClose} aria-label="Schließen">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="shrink-0 px-5 pt-3 border-b bg-slate-50/80">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-3 py-2 text-xs font-bold rounded-t-lg border border-b-0 transition whitespace-nowrap',
                  tab === t.id
                    ? 'bg-white text-slate-900 border-slate-200'
                    : 'bg-transparent text-slate-500 border-transparent hover:text-slate-800',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'catalogs' ? (
            <>
              <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3.5 space-y-2">
                <Label>ID-Präfix</Label>
                <div className="flex items-center gap-2">
                  <Input
                    className="h-10 max-w-[160px] font-mono font-bold uppercase"
                    value={idPrefix}
                    maxLength={12}
                    onChange={(e) =>
                      setIdPrefix(
                        e.target.value
                          .replace(/[^a-zA-Z0-9]/g, '')
                          .toUpperCase()
                          .slice(0, 12),
                      )
                    }
                    placeholder="DPG"
                  />
                  <span className="text-sm text-slate-600">
                    →{' '}
                    <span className="font-mono font-black text-blue-800">
                      #{idPrefix || 'DPG'}-1
                    </span>
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Neue Rücklieferungen erhalten fortlaufende Nummern mit diesem Präfix.
                </p>
              </div>
              <CatalogTagList label="Status-Optionen" items={statuses} onChange={setStatuses} />
              <CatalogTagList label="Gerätetypen" items={deviceTypes} onChange={setDeviceTypes} />
              <CatalogTagList
                label="Service Levels"
                items={serviceLevels}
                onChange={setServiceLevels}
              />
              <CatalogTagList label="SLA-Stufen" items={slas} onChange={setSlas} />
              <CatalogTagList
                label="Versandarten"
                items={shippingMethods}
                onChange={setShippingMethods}
              />
            </>
          ) : null}

          {tab === 'reminders' ? (
            <>
              <label className="flex items-center justify-between gap-3 text-sm font-semibold rounded-xl border border-slate-200 bg-white px-4 py-3">
                Automatischer Versand aktiv
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Mail 1 nach X Tagen</Label>
                  <Input
                    type="number"
                    min={0}
                    value={mail1}
                    onChange={(e) => setMail1(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Mail 2 nach X Tagen</Label>
                  <Input
                    type="number"
                    min={0}
                    value={mail2}
                    onChange={(e) => setMail2(Number(e.target.value))}
                  />
                </div>
                <div>
                  <Label>Mail 3 nach X Tagen</Label>
                  <Input
                    type="number"
                    min={0}
                    value={mail3}
                    onChange={(e) => setMail3(Number(e.target.value))}
                  />
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
                    <Label>
                      Text (Platzhalter: {'{{mitarbeiter}}'}, {'{{geraet}}'}, {'{{lieferdatum}}'},{' '}
                      {'{{tage_ueberfaellig}}'}, {'{{ticket_id}}'})
                    </Label>
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
            </>
          ) : null}

          {tab === 'm365' ? (
            <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <Plug className="w-4 h-4 text-sky-700" />
                    M365 Mitarbeiter-Sync (Entra ID)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Synchronisiert Mitarbeitende aus Microsoft Entra für die Autovervollständigung.
                    Nutzt die vorhandenen M365 Tenant &amp; Send-As Zugangsdaten (Application
                    Permissions <code className="text-[10px]">User.Read.All</code>
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
                    ? `Zuletzt synchronisiert: ${lastSyncCount} Mitarbeiter · ${new Date(
                        lastSyncedAt,
                      ).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`
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
          ) : null}
        </div>

        <div className="shrink-0 border-t px-5 py-4 bg-white">
          <Button
            type="button"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await props.onSave({
                  id_prefix: idPrefix.trim() || 'DPG',
                  catalogs: {
                    statuses,
                    device_types: deviceTypes,
                    service_levels: serviceLevels,
                    slas,
                    shipping_methods: shippingMethods,
                  },
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
