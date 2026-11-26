/**
 * Read-only Rücklieferung Übersicht — opened before the edit workspace.
 * Staff: /returns/:id · Portal: /portal/returns/:id
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeftRight,
  ArrowLeft,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  Mail,
  Package,
  PackageCheck,
  Phone,
  Send,
  Trash2,
  Truck,
  Undo2,
  User,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { cn } from '../../lib/utils';
import {
  formatDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';
import {
  resolveEffectiveShipmentStatus,
  shipmentStatusLabel,
  type ShipmentStatus,
} from '../../lib/client-portal/hardware-returns-shipment';
import {
  defaultConfiguredReminderStages,
  getStageEvent,
  isStageSent,
  normalizeConfiguredReminderStages,
  reminderStageLabel,
  type ConfiguredReminderStage,
} from '../../lib/client-portal/hardware-returns-stages';
import {
  nextManualReminderStage,
  visibleReminderStages,
} from './ReturnsReminderStepper';
import { formatReturnNumber, DueCountdownPill } from './returns-layout-shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export type ReturnDetailMode = 'staff' | 'portal';

export interface ReturnDetailOverviewPageProps {
  mode: ReturnDetailMode;
  organizationId: string;
  returnId: string;
  listPath: string;
  editPath: string;
}

function formatBerlinDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Client-safe overdue day count (no server module imports). */
function computeOverdueDays(hw: Record<string, any>, now: Date = new Date()): number {
  if (hw.returned) return 0;
  const dueIso = toIsoDateOnly(hw.return_due_date) || toIsoDateOnly(hw.delivery_date);
  if (!dueIso) return 0;
  const due = new Date(`${dueIso}T00:00:00.000Z`);
  if (Number.isNaN(due.getTime())) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueUtc = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.max(0, Math.round((today - dueUtc) / (24 * 60 * 60 * 1000)));
}

function stageSentAt(hw: Record<string, any>, stage: number): string | null {
  const ev = getStageEvent(hw.reminder_stages || [], stage);
  if (ev?.sentAt) return ev.sentAt;
  if (stage === 1) return hw.mail1_sent_at || null;
  if (stage === 2) return hw.mail2_sent_at || null;
  if (stage === 3) return hw.mail3_sent_at || null;
  return null;
}

/** 1 Versendet → 2 Rückgabe offen → 3 Eingegangen → 4 Abgeschlossen */
function resolveLifecycleStep(hw: Record<string, any>): 1 | 2 | 3 | 4 {
  const closed =
    hw.exported === true ||
    /geschlossen|abgeschlossen|closed|done/i.test(String(hw.status || ''));
  if (hw.returned && closed) return 4;
  if (hw.returned) return 3;
  if (hw.delivery_date || resolveEffectiveShipmentStatus(hw) === 'versendet') return 2;
  return 1;
}

const STATUS_HERO: Record<
  ShipmentStatus,
  { icon: typeof Send; wrap: string; label: string }
> = {
  versendet: {
    icon: Send,
    wrap: 'bg-blue-50 text-blue-700 border-blue-200',
    label: 'Versendet',
  },
  eingegangen: {
    icon: CheckCircle2,
    wrap: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    label: 'Eingegangen',
  },
};

function SectionCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden',
        className,
      )}
    >
      <div className="px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
        <h2 className="text-sm font-black text-slate-900 tracking-tight">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ContactTile({
  icon,
  label,
  name,
  email,
  phone,
}: {
  icon: ReactNode;
  label: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 flex gap-3 min-w-0">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-900 truncate">{name || '—'}</p>
        {email ? (
          <p className="text-xs text-slate-500 truncate mt-0.5">{email}</p>
        ) : null}
        {phone ? (
          <p className="text-xs text-slate-500 truncate flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" />
            {phone}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function EmailChips({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const email = draft.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    if (!value.includes(email)) onChange([...value, email]);
    setDraft('');
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-wrap gap-1.5 min-h-[40px]">
      {value.map((e) => (
        <span
          key={e}
          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold"
        >
          {e}
          <button
            type="button"
            className="text-slate-400 hover:text-slate-700"
            onClick={() => onChange(value.filter((x) => x !== e))}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[8rem] text-sm outline-none bg-transparent"
        value={draft}
        placeholder="E-Mail hinzufügen…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function ReturnDetailOverviewPage({
  mode,
  organizationId,
  returnId,
  listPath,
  editPath,
}: ReturnDetailOverviewPageProps) {
  const navigate = useNavigate();
  const base = mode === 'portal' ? '/api/portal/returns' : '/api/returns';
  const orgQ =
    mode === 'staff' ? `organizationId=${encodeURIComponent(organizationId)}` : '';

  const [loading, setLoading] = useState(true);
  const [hw, setHw] = useState<Record<string, any> | null>(null);
  const [configuredStages, setConfiguredStages] = useState<ConfiguredReminderStage[]>(
    () => defaultConfiguredReminderStages(),
  );
  const [busy, setBusy] = useState(false);
  const [sendModal, setSendModal] = useState<{
    stage: number;
    to: string[];
    cc: string[];
    subject: string;
    htmlPreview: string;
    saveOverride: boolean;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = mode === 'staff' ? `?${orgQ}` : '';
      const [detailRes, settingsRes] = await Promise.all([
        axios.get(`${base}/${encodeURIComponent(returnId)}${qs}`, { withCredentials: true }),
        axios
          .get(
            `${base}/settings${mode === 'staff' ? `?${orgQ}` : ''}`,
            { withCredentials: true },
          )
          .catch(() => null),
      ]);
      const row = detailRes.data?.hardwareReturn || null;
      if (!row) {
        toast.error('Rücklieferung nicht gefunden.');
        navigate(listPath, { replace: true });
        return;
      }
      setHw(row);
      const stages = normalizeConfiguredReminderStages(
        settingsRes?.data?.stages || settingsRes?.data?.config?.stages,
      );
      if (stages.length) setConfiguredStages(stages);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Laden fehlgeschlagen');
      navigate(listPath, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [base, returnId, mode, orgQ, listPath, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const shipment = resolveEffectiveShipmentStatus({
    returned: Boolean(hw?.returned),
    shipment_status: hw?.shipment_status,
  });
  const overdue = useMemo(() => (hw ? computeOverdueDays(hw) : 0), [hw]);
  const lifecycleStep = hw ? resolveLifecycleStep(hw) : 1;
  const heading = hw ? `Rücklieferung ${formatReturnNumber(hw)}` : 'Rücklieferung';
  const nextStage = hw
    ? hw.returned
      ? null
      : (() => {
          const visible = visibleReminderStages(configuredStages, hw);
          const unsent = visible.find((s) => !isStageSent(hw as any, s));
          return unsent ?? nextManualReminderStage(configuredStages, hw);
        })()
    : null;

  const patchHw = async (fields: Record<string, unknown>, successToast: string) => {
    if (!hw) return;
    setBusy(true);
    try {
      await axios.patch(
        `${base}/${encodeURIComponent(returnId)}${mode === 'staff' ? `?${orgQ}` : ''}`,
        {
          organizationId: mode === 'staff' ? organizationId : undefined,
          hardwareReturn: fields,
        },
        { withCredentials: true },
      );
      toast.success(successToast);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const markReturned = () =>
    void patchHw(
      {
        returned: true,
        returned_at: new Date().toISOString(),
        shipment_status: 'eingegangen',
      },
      'Eingang bestätigt',
    );

  const unreturn = () =>
    void patchHw(
      { returned: false, returned_at: null, shipment_status: 'versendet' },
      'Eingang zurückgesetzt',
    );

  const openSend = async (stage: number) => {
    try {
      const qs =
        mode === 'staff' ? `?${orgQ}&stage=${stage}` : `?stage=${stage}`;
      const res = await axios.get(
        `${base}/${encodeURIComponent(returnId)}/preview-reminder${qs}`,
        { withCredentials: true },
      );
      setSendModal({
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
        `${base}/${encodeURIComponent(returnId)}/send-reminder`,
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
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Versand fehlgeschlagen');
    } finally {
      setSending(false);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await axios.post(
        `${base}/bulk`,
        {
          action: 'csv_export',
          ticketIds: [returnId],
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      if (res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruecklieferung-${formatReturnNumber(hw || {}).replace('#', '')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('CSV exportiert');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'CSV-Export fehlgeschlagen');
    }
  };

  const deleteReturn = async () => {
    if (!window.confirm('Diese Rücklieferung wirklich löschen?')) return;
    setBusy(true);
    try {
      await axios.delete(
        `${base}/${encodeURIComponent(returnId)}${mode === 'staff' ? `?${orgQ}` : ''}`,
        {
          withCredentials: true,
          data: mode === 'staff' ? { organizationId } : undefined,
        },
      );
      toast.success('Rücklieferung gelöscht');
      navigate(listPath, { replace: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !hw) {
    return (
      <div className="p-10 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Laden…
      </div>
    );
  }

  const StatusIcon = STATUS_HERO[shipment].icon;
  const activity = Array.isArray(hw.activity_log) ? [...hw.activity_log].reverse() : [];
  const reminderStages = visibleReminderStages(configuredStages, hw);
  const note = String(hw.solution_summary || hw.description || hw.device_details || '').trim();

  const lifecycle = [
    {
      n: 1 as const,
      label: 'Versendet',
      detail: hw.delivery_date ? formatDateDeOnly(hw.delivery_date) : '—',
    },
    {
      n: 2 as const,
      label: 'Rückgabe offen',
      detail: hw.returned
        ? 'Erledigt'
        : overdue > 0
          ? `+${overdue} Tage überfällig`
          : hw.return_due_date
            ? `Fällig ${formatDateDeOnly(hw.return_due_date)}`
            : '—',
    },
    {
      n: 3 as const,
      label: 'Eingegangen',
      detail: hw.returned_at
        ? formatBerlinDateTime(hw.returned_at)
        : hw.returned
          ? formatDateDeOnly(hw.returned_at) || '—'
          : '—',
    },
    {
      n: 4 as const,
      label: 'Abgeschlossen',
      detail: lifecycleStep >= 4 ? 'Abgeschlossen' : '—',
    },
  ];

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Link
            to={listPath}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Zurück zur Übersicht
          </Link>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 truncate">
            {heading}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            className="h-10 font-bold bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => navigate(editPath)}
          >
            Bearbeiten
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 outline-none"
            >
              Aktion wählen
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[14rem]">
              {!hw.returned ? (
                <DropdownMenuItem
                  className="text-xs font-semibold gap-2"
                  onClick={markReturned}
                >
                  <PackageCheck className="w-3.5 h-3.5" />
                  Eingang bestätigen
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-xs font-semibold gap-2"
                  onClick={unreturn}
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Rückgängig
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {[1, 2, 3, 4].map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  className="text-xs font-semibold gap-2"
                  disabled={Boolean(hw.returned)}
                  onClick={() => void openSend(stage)}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {stage}. Erinnerung senden
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs font-semibold gap-2"
                onClick={() => void exportCsv()}
              >
                <Download className="w-3.5 h-3.5" />
                CSV-Zeile exportieren
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs font-semibold gap-2 text-rose-700"
                onClick={() => void deleteReturn()}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Lifecycle stepper */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm px-4 sm:px-6 py-4">
        <ol className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {lifecycle.map((step, idx) => {
            const done = lifecycleStep > step.n;
            const current = lifecycleStep === step.n;
            return (
              <li key={step.n} className="relative flex items-start gap-3 min-w-0">
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-black',
                    done && 'bg-emerald-500 border-emerald-500 text-white',
                    current && !done && 'bg-blue-600 border-blue-600 text-white',
                    !done && !current && 'bg-slate-50 border-slate-200 text-slate-400',
                  )}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : step.n}
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm font-bold truncate',
                      current ? 'text-slate-900' : 'text-slate-600',
                    )}
                  >
                    {step.n}. {step.label}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{step.detail}</p>
                </div>
                {idx < lifecycle.length - 1 ? (
                  <span className="hidden lg:block absolute right-0 top-4 w-6 h-px bg-slate-200 translate-x-1/2" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {/* 3-zone body */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left 2/3-ish */}
        <div className="xl:col-span-5 space-y-5">
          <SectionCard title="Geräte-Informationen">
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
              <div className="flex-1 rounded-xl border border-amber-100 bg-amber-50/40 p-4 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700/80">
                  Bestehendes Gerät (Alt)
                </p>
                <p className="text-sm font-black text-slate-900 mt-1 truncate">
                  {hw.device_old_type || 'Altgerät'}
                </p>
                <p className="text-xs text-slate-600 mt-1 font-mono truncate">
                  SN: {hw.device_old_serial || '—'}
                </p>
                <span
                  className={cn(
                    'mt-3 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold',
                    hw.returned
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200',
                  )}
                >
                  {hw.returned ? 'Eingegangen' : 'Rückgabe offen'}
                </span>
              </div>
              <div className="flex items-center justify-center sm:px-1 text-slate-400">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              <div className="flex-1 rounded-xl border border-blue-100 bg-blue-50/40 p-4 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-blue-700/80">
                  Neues Gerät (Neu)
                </p>
                <p className="text-sm font-black text-slate-900 mt-1 truncate">
                  {hw.device_new_type || 'Ersatzgerät'}
                </p>
                <p className="text-xs text-slate-600 mt-1 font-mono truncate">
                  SN: {hw.device_new_serial || '—'}
                </p>
                <span className="mt-3 inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                  Versendet
                </span>
              </div>
            </div>
            {note ? (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">
                  Notiz / Zusatzinfo
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{note}</p>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Mitarbeiter & Kontakt">
            <div className="grid grid-cols-1 gap-3">
              <ContactTile
                icon={<User className="w-4 h-4" />}
                label="Mitarbeiter"
                name={hw.employee_name}
                email={hw.employee_email}
                phone={hw.employee_phone || hw.employee_mobile}
              />
              <ContactTile
                icon={<Briefcase className="w-4 h-4" />}
                label="Projektmanager"
                name={hw.project_manager_name}
                email={hw.project_manager_email}
              />
              <ContactTile
                icon={<Users className="w-4 h-4" />}
                label="Vorgesetzter / Chef"
                name={hw.manager_name}
                email={hw.manager_email}
              />
            </div>
          </SectionCard>
        </div>

        {/* Middle timeline */}
        <div className="xl:col-span-4 space-y-5">
          <SectionCard title="Versand- & Rückgabe-Tracking">
            <ol className="relative space-y-0 pl-1">
              <TimelineItem
                icon={<Truck className="w-3.5 h-3.5" />}
                title="Ersatzgerät versendet"
                active={Boolean(hw.delivery_date) || shipment === 'versendet'}
                meta={[
                  hw.delivery_date
                    ? `Lieferung: ${formatDateDeOnly(hw.delivery_date)}`
                    : null,
                  hw.shipping_method ? `Versandart: ${hw.shipping_method}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Noch nicht versendet'}
              />
              <TimelineItem
                icon={<Package className="w-3.5 h-3.5" />}
                title={
                  hw.returned ? 'Rücksendung eingegangen' : 'Rücksendung erwartet'
                }
                active
                meta={
                  hw.returned
                    ? `Eingang: ${formatBerlinDateTime(hw.returned_at)}`
                    : hw.return_due_date
                      ? `Fällig: ${formatDateDeOnly(hw.return_due_date)}`
                      : 'Kein Fälligkeitsdatum'
                }
              />
              <li className="relative pb-1 pl-10">
                <span className="absolute left-[15px] top-0 bottom-0 w-px bg-slate-200" />
                <span className="absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-violet-700">
                  <Mail className="w-3.5 h-3.5" />
                </span>
                <p className="text-sm font-bold text-slate-900">Erinnerungsverlauf</p>
                <ul className="mt-2 space-y-1.5">
                  {reminderStages.length === 0 ? (
                    <li className="text-xs text-slate-400">Noch keine Erinnerungen</li>
                  ) : (
                    reminderStages.map((stage) => {
                      const sent = stageSentAt(hw, stage);
                      return (
                        <li
                          key={stage}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-semibold text-slate-700">
                            {reminderStageLabel(stage)}
                          </span>
                          <span
                            className={cn(
                              'tabular-nums',
                              sent ? 'text-emerald-700 font-semibold' : 'text-slate-400',
                            )}
                          >
                            {sent ? formatBerlinDateTime(sent) : 'offen'}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </li>
            </ol>
          </SectionCard>
        </div>

        {/* Right sidebar */}
        <aside className="xl:col-span-3 space-y-4">
          <div
            className={cn(
              'rounded-2xl border p-5 flex flex-col items-center text-center gap-2 shadow-sm',
              STATUS_HERO[shipment].wrap,
            )}
          >
            <StatusIcon className="w-10 h-10" />
            <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">Status</p>
            <p className="text-xl font-black">{STATUS_HERO[shipment].label}</p>
            <p className="text-xs opacity-80">{shipmentStatusLabel(shipment)}</p>
          </div>

          <SectionCard title="Fälligkeit">
            <DueCountdownPill
              overdueDays={overdue}
              dueDate={hw.return_due_date || hw.delivery_date}
              returned={Boolean(hw.returned)}
              className="text-xs px-2.5 py-1"
            />
            {!hw.returned && overdue > 0 ? (
              <p className="mt-2 text-sm font-black text-rose-700">
                +{overdue} Tage überfällig
              </p>
            ) : null}
            <p className="mt-2 text-sm text-slate-700">
              Fällig am{' '}
              <span className="font-bold">
                {formatDateDeOnly(hw.return_due_date) || '—'}
              </span>
            </p>
            {toIsoDateOnly(hw.delivery_date) ? (
              <p className="text-xs text-slate-500 mt-1">
                Lieferung: {formatDateDeOnly(hw.delivery_date)}
              </p>
            ) : null}
          </SectionCard>

          <Button
            type="button"
            className="w-full h-11 font-bold bg-violet-600 hover:bg-violet-700 text-white"
            disabled={Boolean(hw.returned) || nextStage == null}
            onClick={() => nextStage != null && void openSend(nextStage)}
          >
            <Mail className="w-4 h-4 mr-1.5" />
            Erinnerung senden
            {nextStage != null ? ` (${nextStage}.)` : ''}
          </Button>

          <SectionCard title="Notizen & Verlauf">
            {note ? (
              <p className="text-sm text-slate-700 whitespace-pre-wrap mb-4 border-b border-slate-100 pb-3">
                {note}
              </p>
            ) : (
              <p className="text-xs text-slate-400 mb-3">Keine Notiz hinterlegt.</p>
            )}
            {activity.length === 0 ? (
              <p className="text-xs text-slate-400">Noch keine Aktivitäten.</p>
            ) : (
              <ol className="space-y-3 max-h-72 overflow-y-auto">
                {activity.slice(0, 20).map((entry: any, idx: number) => (
                  <li key={`${entry.at}-${idx}`} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-white border-slate-200 text-slate-500">
                      {entry.type === 'mail_sent' ? (
                        <Mail className="w-3 h-3" />
                      ) : entry.type === 'returned' ? (
                        <PackageCheck className="w-3 h-3" />
                      ) : (
                        <UserCircle2 className="w-3 h-3" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900">
                        {entry.message || entry.type || 'Aktualisiert'}
                      </p>
                      <p className="text-[10px] text-slate-400 tabular-nums mt-0.5">
                        {formatBerlinDateTime(entry.at)}
                        {entry.actor ? ` · ${entry.actor}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </aside>
      </div>

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
                />
              </div>
              <div>
                <Label>CC</Label>
                <EmailChips
                  value={sendModal.cc}
                  onChange={(cc) => setSendModal({ ...sendModal, cc })}
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
              <Button
                type="button"
                onClick={() => void confirmSend()}
                disabled={sending || !sendModal.to.length}
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Jetzt senden
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimelineItem({
  icon,
  title,
  meta,
  active,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  active?: boolean;
}) {
  return (
    <li className="relative pb-5 pl-10">
      <span className="absolute left-[15px] top-2 bottom-0 w-px bg-slate-200" />
      <span
        className={cn(
          'absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border',
          active
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-slate-200 bg-slate-50 text-slate-400',
        )}
      >
        {icon}
      </span>
      <p className="text-sm font-bold text-slate-900">{title}</p>
      <p className="text-xs text-slate-500 mt-0.5">{meta}</p>
    </li>
  );
}

export default ReturnDetailOverviewPage;
