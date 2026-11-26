/**
 * Shared full-page create/edit workspace for Hardware-Rücklieferungen.
 * Used identically by Hubcom Staff and DPG Kunden-Portal (mode switches APIs only).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Hash,
  HardDrive,
  Loader2,
  Mail,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Truck,
  User,
  UserCircle2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { DeviceTypeSelect } from './DeviceTypeSelect';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/hooks';
import {
  emptyHardwareReturnForm,
  hardwareFormFromRecord,
  hardwareFormToPayload,
  type HardwareReturnFormState,
} from '../tickets/HardwareReturnSections';
import {
  formatDateDeOnly,
  parseDateDeOnly,
  toIsoDateOnly,
} from '../../lib/client-portal/hardware-returns-dates';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  defaultConfiguredReminderStages,
  normalizeConfiguredReminderStages,
  reminderStageLabel,
  stageOverrideKey,
  type ConfiguredReminderStage,
} from '../../lib/client-portal/hardware-returns-stages';
import {
  nextManualReminderStage,
  ReturnsReminderStepper,
} from './ReturnsReminderStepper';

function formatReturnNumberDisplay(returnNumber: string | null | undefined): string {
  const raw = String(returnNumber || '').trim();
  if (!raw) return '';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

export type ReturnEditorMode = 'staff' | 'portal';

type Catalogs = {
  statuses: string[];
  device_types: string[];
  service_levels: string[];
  slas: string[];
  shipping_methods: string[];
};

type DirectoryHit = {
  id: string;
  displayName: string;
  email: string | null;
  phoneOffice: string | null;
  phoneMobile: string | null;
  managerName: string | null;
  managerEmail: string | null;
  department: string | null;
  source: 'm365' | 'portal';
};

type Assignee = { id: string; name: string; email: string; role: string };

const DEFAULT_CATALOGS: Catalogs = {
  statuses: ['Neu', 'Warten auf Third Level', 'Abgeschlossen'],
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

const STEPS = [
  { id: 'kundendaten', label: 'Kundendaten', sectionId: 'section-kundendaten' },
  { id: 'geraete', label: 'Gerätedetails', sectionId: 'section-geraete' },
  { id: 'rueckgabe', label: 'Rückgabedetails', sectionId: 'section-rueckgabe' },
  {
    id: 'erinnerung',
    label: 'Erinnerungen & Abschluss',
    sectionId: 'section-erinnerung',
  },
] as const;

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

function statusDotClass(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('geschlossen') || s === 'closed' || s === 'returned') return 'bg-emerald-500';
  if (s.includes('bearbeitung') || s.includes('progress')) return 'bg-sky-500';
  if (s.includes('warten') || s.includes('wait')) return 'bg-amber-500';
  return 'bg-slate-400';
}

function slaBadgeClass(sla: string): string {
  const s = sla.toLowerCase();
  if (s.includes('hoch') || s.includes('high')) return 'bg-rose-50 text-rose-700 border-rose-100';
  if (s.includes('niedrig') || s.includes('low')) return 'bg-slate-50 text-slate-600 border-slate-200';
  return 'bg-amber-50 text-amber-800 border-amber-100';
}

function Field({
  label,
  children,
  className,
  required,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
        {label}
        {required ? <span className="text-sky-600"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

/** German TT.MM.JJJJ text date — never browser mm/dd/yyyy. */
function GermanDateInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
}) {
  const display = formatDateDeOnly(value);
  const [text, setText] = useState(display === '—' ? '' : display);
  useEffect(() => {
    const next = formatDateDeOnly(value);
    setText(next === '—' ? '' : next);
  }, [value]);
  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="TT.MM.JJJJ"
      className={cn('h-10 font-medium tabular-nums', className)}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (!raw.trim()) {
          onChange('');
          return;
        }
        const iso = parseDateDeOnly(raw);
        if (iso) onChange(iso);
      }}
      onBlur={() => {
        if (!text.trim()) {
          onChange('');
          setText('');
          return;
        }
        const iso = parseDateDeOnly(text);
        if (iso) {
          onChange(iso);
          setText(formatDateDeOnly(iso));
          return;
        }
        const fallback = formatDateDeOnly(value);
        setText(fallback === '—' ? '' : fallback);
      }}
    />
  );
}

function IconFieldShell({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Icon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      {children}
    </div>
  );
}

function SectionCard({
  id,
  title,
  icon,
  tone,
  badge,
  children,
}: {
  id?: string;
  title: string;
  icon: ReactNode;
  tone: 'blue' | 'green' | 'purple' | 'teal' | 'amber';
  badge?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    blue: 'from-sky-50 to-white border-sky-100 text-sky-700',
    green: 'from-emerald-50 to-white border-emerald-100 text-emerald-700',
    purple: 'from-violet-50 to-white border-violet-100 text-violet-700',
    teal: 'from-teal-50 to-white border-teal-100 text-teal-700',
    amber: 'from-amber-50 to-white border-amber-100 text-amber-800',
  };
  return (
    <section
      id={id}
      className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden scroll-mt-24"
    >
      <div
        className={cn(
          'flex items-center gap-2.5 px-5 py-3.5 border-b bg-gradient-to-r',
          tones[tone],
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/80 border border-white shadow-sm">
          {icon}
        </div>
        <h2 className="text-sm font-black text-slate-900 tracking-tight flex-1">{title}</h2>
        {badge}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

function EmailChipInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const chips = value
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const [draft, setDraft] = useState('');
  const commit = (raw: string) => {
    const next = raw.trim().toLowerCase();
    if (!next.includes('@')) return;
    const set = new Set(chips.map((c) => c.toLowerCase()));
    set.add(next);
    onChange(Array.from(set).join(', '));
    setDraft('');
  };
  return (
    <Field label={label}>
      <div className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 min-h-[42px] flex flex-wrap gap-1.5 items-center">
        {chips.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 pl-2 pr-1 py-0.5 text-[11px] font-semibold text-slate-700"
          >
            {c}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-slate-200"
              onClick={() => onChange(chips.filter((x) => x !== c).join(', '))}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[120px] text-sm outline-none py-1"
          value={draft}
          placeholder="E-Mail…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit(draft);
            }
          }}
          onBlur={() => commit(draft)}
        />
      </div>
    </Field>
  );
}

export interface ReturnEditorPageProps {
  mode: ReturnEditorMode;
  organizationId: string;
  /** null = create; return UUID = edit */
  returnId: string | null;
  listPath: string;
}

export function ReturnEditorPage({
  mode,
  organizationId,
  returnId,
  listPath,
}: ReturnEditorPageProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const base = mode === 'portal' ? '/api/portal/returns' : '/api/returns';
  const isEdit = Boolean(returnId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<HardwareReturnFormState>(() => emptyHardwareReturnForm());
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [catalogs, setCatalogs] = useState<Catalogs>(DEFAULT_CATALOGS);
  const [configuredStages, setConfiguredStages] = useState<ConfiguredReminderStage[]>(
    () => defaultConfiguredReminderStages(),
  );
  const [returnNumber, setReturnNumber] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<any[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [dirQuery, setDirQuery] = useState('');
  const [dirHits, setDirHits] = useState<DirectoryHit[]>([]);
  const [dirOpen, setDirOpen] = useState(false);
  const [dirLoading, setDirLoading] = useState(false);
  const [reminderDetailsOpen, setReminderDetailsOpen] = useState(false);
  const [selectedReminderStage, setSelectedReminderStage] = useState(1);
  const [extraReminderStages, setExtraReminderStages] = useState<number[]>([]);
  const [timeOpen, setTimeOpen] = useState(false);
  const [sendingStage, setSendingStage] = useState<number | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const dirBoxRef = useRef<HTMLDivElement>(null);
  const initialSnapshot = useRef<{
    form: HardwareReturnFormState;
    customerName: string;
    customerEmail: string;
    dirQuery: string;
  } | null>(null);

  const setField = <K extends keyof HardwareReturnFormState>(
    key: K,
    value: HardwareReturnFormState[K],
  ) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'delivery_date' && typeof value === 'string' && value) {
        const delay = configuredStages[0]?.delayDays ?? 14;
        next.return_due_date = addDaysIso(value, delay);
      }
      if (key === 'returned' && value === true && !prev.returned_at) {
        next.returned_at = new Date().toISOString();
      }
      if (key === 'returned' && value === false) {
        next.returned_at = '';
      }
      return next;
    });
  };

  const loadMeta = useCallback(async () => {
    const [settingsRes, assigneesRes] = await Promise.all([
      axios.get(
        `${base}/settings${mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`,
        { withCredentials: true },
      ),
      axios.get(
        `${base}/assignees${mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`,
        { withCredentials: true },
      ),
    ]);
    const cfg = settingsRes.data?.hardware_returns_config || settingsRes.data?.settings || {};
    const cats = cfg.catalogs || settingsRes.data?.catalogs || DEFAULT_CATALOGS;
    setCatalogs({
      statuses: cats.statuses?.length ? cats.statuses : DEFAULT_CATALOGS.statuses,
      device_types: cats.device_types?.length ? cats.device_types : DEFAULT_CATALOGS.device_types,
      service_levels: cats.service_levels?.length
        ? cats.service_levels
        : DEFAULT_CATALOGS.service_levels,
      slas: cats.slas?.length ? cats.slas : DEFAULT_CATALOGS.slas,
      shipping_methods: cats.shipping_methods?.length
        ? cats.shipping_methods
        : DEFAULT_CATALOGS.shipping_methods,
    });
    setConfiguredStages(
      normalizeConfiguredReminderStages(cfg.stages, {
        mail1_days_after_delivery: cfg.mail1_days_after_delivery,
        mail2_days_after_mail1: cfg.mail2_days_after_mail1,
        mail3_days_after_mail2: cfg.mail3_days_after_mail2,
        stage_recipients: cfg.stage_recipients,
        templates: cfg.templates,
      }),
    );
    setAssignees((assigneesRes.data?.assignees || []) as Assignee[]);
    return cfg;
  }, [base, mode, organizationId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        await loadMeta();
        if (!active) return;
        if (returnId) {
          const res = await axios.get(
            `${base}/${encodeURIComponent(returnId)}${
              mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
            }`,
            { withCredentials: true },
          );
          if (!active) return;
          const hw = res.data?.hardwareReturn || res.data;
          const mapped = hardwareFormFromRecord(hw);
          setForm(mapped);
          setCustomerName(String(hw.employee_name || ''));
          setCustomerEmail(String(hw.employee_email || ''));
          setDirQuery(String(hw.employee_name || ''));
          setReturnNumber(hw.return_number ? String(hw.return_number) : null);
          setActivityLog(Array.isArray(hw.activity_log) ? hw.activity_log : []);
          initialSnapshot.current = {
            form: mapped,
            customerName: String(hw.employee_name || ''),
            customerEmail: String(hw.employee_email || ''),
            dirQuery: String(hw.employee_name || ''),
          };
        } else {
          const blank = emptyHardwareReturnForm();
          blank.status = 'Neu';
          blank.sla = 'Normal';
          blank.auto_reminder_enabled = true;
          blank.assignee_user_id = String(user?.uid || '');
          blank.assignee_name = String(user?.displayName || user?.email || '');
          setForm(blank);
          setReminderDetailsOpen(false);
          setSelectedReminderStage(1);
          setExtraReminderStages([]);
          setCustomerName('');
          setCustomerEmail('');
          setDirQuery('');
          setReturnNumber(null);
          setActivityLog([]);
          initialSnapshot.current = {
            form: blank,
            customerName: '',
            customerEmail: '',
            dirQuery: '',
          };
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Laden fehlgeschlagen');
        navigate(listPath, { replace: true });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    returnId,
    organizationId,
    mode,
    base,
    loadMeta,
    listPath,
    navigate,
    user?.uid,
    user?.displayName,
    user?.email,
  ]);

  // Directory autocomplete (debounced)
  useEffect(() => {
    const q = dirQuery.trim();
    if (q.length < 1) {
      setDirHits([]);
      return;
    }
    let active = true;
    const t = setTimeout(() => {
      setDirLoading(true);
      void axios
        .get(
          `${base}/directory-users?q=${encodeURIComponent(q)}&limit=15${
            mode === 'staff' ? `&organizationId=${encodeURIComponent(organizationId)}` : ''
          }`,
          { withCredentials: true },
        )
        .then((res) => {
          if (!active) return;
          setDirHits((res.data?.users || []) as DirectoryHit[]);
        })
        .catch(() => {
          if (active) setDirHits([]);
        })
        .finally(() => {
          if (active) setDirLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [dirQuery, base, mode, organizationId]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!dirBoxRef.current?.contains(e.target as Node)) setDirOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Default Bearbeiter to logged-in user once assignees load (create mode).
  useEffect(() => {
    if (isEdit || !user?.uid || assignees.length === 0) return;
    setForm((prev) => {
      if (prev.assignee_user_id && assignees.some((a) => a.id === prev.assignee_user_id)) {
        return prev;
      }
      const me = assignees.find((a) => a.id === user.uid);
      if (!me) {
        return {
          ...prev,
          assignee_user_id: String(user.uid),
          assignee_name: String(user.displayName || user.email || prev.assignee_name),
        };
      }
      return {
        ...prev,
        assignee_user_id: me.id,
        assignee_name: me.name || me.email,
      };
    });
  }, [assignees, isEdit, user?.uid, user?.displayName, user?.email]);

  const applyDirectoryUser = (hit: DirectoryHit) => {
    setCustomerName(hit.displayName || '');
    setCustomerEmail(hit.email || '');
    setDirQuery(hit.displayName || '');
    setDirOpen(false);
    setForm((prev) => ({
      ...prev,
      directory_user_id: hit.source === 'm365' ? hit.id : prev.directory_user_id,
      employee_phone: hit.phoneOffice || prev.employee_phone,
      employee_mobile: hit.phoneMobile || prev.employee_mobile,
      manager_name: hit.managerName || prev.manager_name,
      manager_email: hit.managerEmail || prev.manager_email,
    }));
  };

  const save = async () => {
    if (!customerName.trim() && !customerEmail.trim()) {
      toast.error('Bitte einen Mitarbeiter auswählen oder Name/E-Mail angeben.');
      return;
    }
    setSaving(true);
    try {
      const hardwareReturn = {
        ...hardwareFormToPayload(form),
        employee_name: customerName || null,
        employee_email: customerEmail || null,
      };
      if (isEdit && returnId) {
        await axios.put(
          `${base}/${encodeURIComponent(returnId)}${
            mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
          }`,
          {
            organizationId: mode === 'staff' ? organizationId : undefined,
            customerName: customerName || null,
            customerEmail: customerEmail || null,
            status: form.status,
            assigneeName: form.assignee_name || null,
            hardwareReturn,
          },
          { withCredentials: true },
        );
        toast.success('Rücklieferung gespeichert.');
        navigate(listPath);
      } else {
        const res = await axios.post(
          `${base}${mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`,
          {
            organizationId: mode === 'staff' ? organizationId : undefined,
            subject: null,
            description: form.solution_summary || form.device_details || null,
            customerName: customerName || null,
            customerEmail: customerEmail || null,
            hardwareReturn,
          },
          { withCredentials: true },
        );
        toast.success('Rücklieferung erstellt.');
        const newId = res.data?.id || res.data?.hardwareReturn?.id;
        if (newId) {
          navigate(
            mode === 'portal'
              ? `/portal/returns/${newId}`
              : `/tickets/kunden/${organizationId}/returns/${newId}`,
            { replace: true },
          );
        } else {
          navigate(listPath);
        }
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    const snap = initialSnapshot.current;
    if (!snap) return;
    setForm({ ...snap.form });
    setCustomerName(snap.customerName);
    setCustomerEmail(snap.customerEmail);
    setDirQuery(snap.dirQuery);
    setReminderDetailsOpen(false);
    setSelectedReminderStage(1);
    setExtraReminderStages([]);
    setTimeOpen(false);
    toast.message('Formular zurückgesetzt');
  };

  const sendReminder = async (stage: number) => {
    if (!returnId) return;
    setSendingStage(stage);
    try {
      await axios.post(
        `${base}/${encodeURIComponent(returnId)}/send-reminder`,
        {
          stage,
          ...(mode === 'staff' ? { organizationId } : {}),
        },
        { withCredentials: true },
      );
      toast.success(`${reminderStageLabel(stage)} versendet`);
      const res = await axios.get(
        `${base}/${encodeURIComponent(returnId)}${
          mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
        }`,
        { withCredentials: true },
      );
      const hw = res.data?.hardwareReturn || res.data;
      setForm(hardwareFormFromRecord(hw));
      setActivityLog(Array.isArray(hw.activity_log) ? hw.activity_log : []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Versand fehlgeschlagen');
    } finally {
      setSendingStage(null);
    }
  };

  const title = isEdit
    ? `${formatReturnNumberDisplay(returnNumber) || 'Rücklieferung'} bearbeiten`
    : 'Neue Rücklieferung erstellen';

  const railTitle = isEdit ? 'Rücklieferung bearbeiten' : 'Rücklieferung erfassen';

  const mailSummary = `Standard-Erinnerungsplan aktiv: ${configuredStages
    .map((s, i) =>
      i === 0
        ? `1. Erinnerung nach ${s.delayDays} Tagen`
        : `${s.stage}. Erinnerung +${s.delayDays} Tage`,
    )
    .join(' · ')}`;

  const planCompact = `${configuredStages.length || 4} Stufen: ${
    configuredStages.length
      ? configuredStages
          .map((s, i) => (i === 0 ? `${s.delayDays}T` : `+${s.delayDays}T`))
          .join(' → ')
      : '14T → +7T → +7T → +7T'
  }`;

  const autoStatusPill = form.auto_reminder_enabled
    ? `Automatisch aktiv · 1. Stufe nach ${
        configuredStages[0]?.delayDays ?? 14
      } Tagen, danach +${configuredStages[1]?.delayDays ?? 7} Tage`
    : 'Automatischer Versand aus';

  const editableReminderStages = useMemo(() => {
    const base = configuredStages.map((s) => s.stage);
    const merged = Array.from(new Set([...base, ...extraReminderStages])).sort(
      (a, b) => a - b,
    );
    return merged.length ? merged : [1, 2, 3, 4];
  }, [configuredStages, extraReminderStages]);

  const getScheduledDate = (stage: number): string => {
    if (stage === 1) return form.mail1_scheduled_date;
    if (stage === 2) return form.mail2_scheduled_date;
    if (stage === 3) return form.mail3_scheduled_date;
    return form.stage_scheduled_overrides[`stage${stage}`] || '';
  };

  const setScheduledDate = (stage: number, value: string) => {
    if (stage === 1) setField('mail1_scheduled_date', value);
    else if (stage === 2) setField('mail2_scheduled_date', value);
    else if (stage === 3) setField('mail3_scheduled_date', value);
    else {
      setForm((prev) => ({
        ...prev,
        stage_scheduled_overrides: {
          ...prev.stage_scheduled_overrides,
          [`stage${stage}`]: value,
        },
      }));
    }
  };

  const overrideKeyFor = (stage: number) => stageOverrideKey(stage);

  const nextPlusStage = nextManualReminderStage(configuredStages, {
    returned: form.returned,
    mail1_sent_at: form.mail1_sent_at,
    mail2_sent_at: form.mail2_sent_at,
    mail3_sent_at: form.mail3_sent_at,
    reminder_stages: form.reminder_stages || [],
    reminder_count: form.reminder_count || 0,
  });

  const stepDone = useMemo(() => {
    const kundendaten = Boolean(customerName.trim() || customerEmail.trim());
    const geraete = Boolean(
      form.device_old_type.trim() ||
        form.device_old_serial.trim() ||
        form.device_new_type.trim() ||
        form.device_new_serial.trim() ||
        form.solution_summary.trim() ||
        form.device_details.trim(),
    );
    const rueckgabe = Boolean(
      form.shipping_method.trim() || form.delivery_date || form.returned,
    );
    // Step 4 → Erinnerungsmanagement: complete from reminder/return state once
    // prior cards are filled (auto-ON alone must not green-check an empty form).
    const hasReminderOverrides =
      Boolean(form.mail1_scheduled_date) ||
      Object.values(form.stage_scheduled_overrides || {}).some((v) => Boolean(v)) ||
      Object.keys(form.stage_recipients_override || {}).length > 0;
    const erinnerung =
      kundendaten &&
      geraete &&
      rueckgabe &&
      (form.returned || form.auto_reminder_enabled || hasReminderOverrides);
    return [kundendaten, geraete, rueckgabe, erinnerung] as const;
  }, [customerName, customerEmail, form]);

  useEffect(() => {
    const firstOpen = stepDone.findIndex((d) => !d);
    setActiveStep(firstOpen === -1 ? STEPS.length - 1 : firstOpen);
  }, [stepDone]);

  const scrollToStep = (index: number) => {
    setActiveStep(index);
    const el = document.getElementById(STEPS[index]!.sectionId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const deviceCount =
    (form.device_old_type || form.device_old_serial ? 1 : 0) +
    (form.device_new_type || form.device_new_serial ? 1 : 0);
  const assigneeLabel =
    form.assignee_name ||
    assignees.find((a) => a.id === form.assignee_user_id)?.name ||
    user?.displayName ||
    '—';

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-slate-500 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Laden…
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#f6f8fb]">
      <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex items-start gap-3">
            <Link
              to={listPath}
              className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Zurück zu Rücklieferungen</span>
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg sm:text-xl font-black tracking-tight text-slate-900 truncate">
                  {title}
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                  <span className={cn('h-2 w-2 rounded-full', statusDotClass(form.status))} />
                  {form.status || 'Neu'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="outline" onClick={() => navigate(listPath)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <Save className="w-4 h-4 mr-1.5" />
              )}
              Speichern
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px] gap-5 items-start">
          {/* Left step rail */}
          <aside className="lg:sticky lg:top-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-5">
              <div className="flex items-start gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
                  <Package className="w-6 h-6" />
                  <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white border border-sky-100 text-sky-700 shadow-sm">
                    <RotateCcw className="w-3 h-3" />
                  </span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-900 tracking-tight">
                    {railTitle}
                  </h2>
                  <p className="text-[12px] text-slate-500 font-medium mt-1 leading-relaxed">
                    Erfassen Sie hier die Details zur Rückgabe eines Geräts oder Zubehörs.
                  </p>
                </div>
              </div>

              <ol className="space-y-1">
                {STEPS.map((step, idx) => {
                  const done = stepDone[idx];
                  const current = activeStep === idx;
                  const nextHighlight = idx > 0 && stepDone[idx - 1] && !done;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => scrollToStep(idx)}
                        className={cn(
                          'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                          current || nextHighlight
                            ? 'bg-sky-50 border border-sky-100'
                            : 'hover:bg-slate-50 border border-transparent',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black border',
                            done
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : current || nextHighlight
                                ? 'bg-sky-600 border-sky-600 text-white'
                                : 'bg-white border-slate-200 text-slate-500',
                          )}
                        >
                          {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                        </span>
                        <span
                          className={cn(
                            'text-sm font-bold',
                            done
                              ? 'text-emerald-800'
                              : current || nextHighlight
                                ? 'text-sky-900'
                                : 'text-slate-600',
                          )}
                        >
                          {step.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-3 py-2.5 text-[11px] font-semibold text-sky-800 leading-relaxed">
                Alle Felder mit * sind Pflichtfelder.
              </div>
            </div>
          </aside>

          {/* Center form */}
          <div className="space-y-5 min-w-0">
            <SectionCard
              id="section-kundendaten"
              title="Mitarbeiter & Kontakt"
              tone="blue"
              icon={<Users className="w-4 h-4" />}
            >
              <div ref={dirBoxRef} className="relative">
                <Field label="Mitarbeiter" required>
                  <IconFieldShell icon={Search}>
                    <Input
                      className="pl-9 h-11"
                      value={dirQuery}
                      placeholder="Name tippen… z. B. ad"
                      onChange={(e) => {
                        setDirQuery(e.target.value);
                        setCustomerName(e.target.value);
                        setDirOpen(true);
                      }}
                      onFocus={() => setDirOpen(true)}
                    />
                    {dirLoading ? (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-400" />
                    ) : null}
                  </IconFieldShell>
                </Field>
                {dirOpen && dirHits.length > 0 ? (
                  <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                    {dirHits.map((hit) => (
                      <li key={`${hit.source}-${hit.id}`}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-sky-50 border-b border-slate-50 last:border-0"
                          onClick={() => applyDirectoryUser(hit)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-900">
                              {hit.displayName}
                            </span>
                            {hit.source === 'm365' ? (
                              <span className="rounded-full bg-sky-50 border border-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                M365
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                                Portal
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{hit.email || '—'}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="E-Mail">
                  <IconFieldShell icon={Mail}>
                    <Input
                      type="email"
                      className="pl-9 h-11"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="name@firma.de"
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Telefon (Büro)">
                  <IconFieldShell icon={Phone}>
                    <Input
                      className="pl-9 h-11"
                      value={form.employee_phone}
                      onChange={(e) => setField('employee_phone', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Telefon (Mobil)">
                  <IconFieldShell icon={Smartphone}>
                    <Input
                      className="pl-9 h-11"
                      value={form.employee_mobile}
                      onChange={(e) => setField('employee_mobile', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <Field label="Projektmanager Name">
                  <IconFieldShell icon={Briefcase}>
                    <Input
                      className="pl-9 h-11"
                      value={form.project_manager_name}
                      onChange={(e) => setField('project_manager_name', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Projektmanager E-Mail">
                  <IconFieldShell icon={Mail}>
                    <Input
                      type="email"
                      className="pl-9 h-11"
                      value={form.project_manager_email}
                      onChange={(e) => setField('project_manager_email', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Vorgesetzter / Chef Name">
                  <IconFieldShell icon={User}>
                    <Input
                      className="pl-9 h-11"
                      value={form.manager_name}
                      onChange={(e) => setField('manager_name', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Vorgesetzter / Chef E-Mail">
                  <IconFieldShell icon={Mail}>
                    <Input
                      type="email"
                      className="pl-9 h-11"
                      value={form.manager_email}
                      onChange={(e) => setField('manager_email', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
              </div>
            </SectionCard>

            <SectionCard
              id="section-geraete"
              title="Geräte & Seriennummern"
              tone="green"
              icon={<HardDrive className="w-4 h-4" />}
              badge={
                deviceCount > 0 ? (
                  <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-black text-emerald-800">
                    {deviceCount} Gerät{deviceCount === 1 ? '' : 'e'}
                  </span>
                ) : null
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Bestehendes Gerät (Alt)">
                  <DeviceTypeSelect
                    aria-label="Bestehendes Gerät (Alt)"
                    value={form.device_old_type}
                    onChange={(v) => setField('device_old_type', v)}
                    options={catalogs.device_types}
                  />
                </Field>
                <Field label="Seriennummer (Alt)">
                  <IconFieldShell icon={Hash}>
                    <Input
                      className="pl-9 h-11"
                      value={form.device_old_serial}
                      onChange={(e) => setField('device_old_serial', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
                <Field label="Neues Gerät (Neu)">
                  <DeviceTypeSelect
                    aria-label="Neues Gerät (Neu)"
                    value={form.device_new_type}
                    onChange={(v) => setField('device_new_type', v)}
                    options={catalogs.device_types}
                  />
                </Field>
                <Field label="Seriennummer (Neu)">
                  <IconFieldShell icon={Hash}>
                    <Input
                      className="pl-9 h-11"
                      value={form.device_new_serial}
                      onChange={(e) => setField('device_new_serial', e.target.value)}
                    />
                  </IconFieldShell>
                </Field>
              </div>
              <Field label="Notiz / Zusatzinfo">
                <Textarea
                  className="min-h-[88px]"
                  value={form.solution_summary || form.device_details}
                  onChange={(e) => {
                    setField('solution_summary', e.target.value);
                    setField('device_details', e.target.value);
                  }}
                  placeholder="Zubehör, Kabel, Lösung…"
                />
              </Field>
            </SectionCard>

            <SectionCard
              id="section-rueckgabe"
              title="Versand & Rücklieferung"
              tone="purple"
              icon={<Truck className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Versandart">
                  <IconFieldShell icon={Package}>
                    <select
                      className="h-11 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm"
                      value={form.shipping_method}
                      onChange={(e) => setField('shipping_method', e.target.value)}
                    >
                      <option value="">— Keine Auswahl —</option>
                      {catalogs.shipping_methods.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </IconFieldShell>
                </Field>
                <Field label="Datum der Rücklieferung">
                  <IconFieldShell icon={Calendar}>
                    <Input
                      type="date"
                      className="pl-9 h-11"
                      value={toIsoDateOnly(form.delivery_date) || ''}
                      onChange={(e) => setField('delivery_date', e.target.value)}
                    />
                  </IconFieldShell>
                  {form.delivery_date ? (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Anzeige: {formatDateDeOnly(form.delivery_date)}
                    </p>
                  ) : null}
                </Field>
              </div>

              <div
                className={cn(
                  'rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3',
                  form.returned
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-slate-200 bg-slate-50/80',
                )}
              >
                <div>
                  <p className="text-sm font-black text-slate-900">
                    Rücksendung erfolgt (Eingang bestätigt)
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Markiert den Vorgang als zurückgeliefert und stoppt Erinnerungen.
                  </p>
                  {/* Keep legacy phrase for isolation contract */}
                  <span className="sr-only">Rücklieferung erfolgt</span>
                  {form.returned ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Zurückgeliefert am: {formatBerlinDateTime(form.returned_at) || '—'}
                      </span>
                      <Input
                        type="datetime-local"
                        className="h-8 w-auto text-[11px]"
                        value={
                          form.returned_at
                            ? new Date(form.returned_at).toISOString().slice(0, 16)
                            : ''
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          setField(
                            'returned_at',
                            v ? new Date(v).toISOString() : new Date().toISOString(),
                          );
                        }}
                        aria-label="Zurückgeliefert am bearbeiten"
                      />
                    </div>
                  ) : null}
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-bold shrink-0">
                  <span className={form.returned ? 'text-emerald-700' : 'text-slate-500'}>
                    {form.returned ? 'Ein' : 'Aus'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.returned}
                    className={cn(
                      'relative h-7 w-12 rounded-full transition',
                      form.returned ? 'bg-emerald-500' : 'bg-slate-300',
                    )}
                    onClick={() => setField('returned', !form.returned)}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition',
                        form.returned ? 'left-5' : 'left-0.5',
                      )}
                    />
                  </button>
                </label>
              </div>

            </SectionCard>

            <SectionCard
              id="section-erinnerung"
              title="Erinnerungsmanagement & Empfänger"
              tone="teal"
              icon={<Clock className="w-4 h-4" />}
            >
              {/* Row 1 — auto toggle + plan + manual send */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 min-w-0">
                  <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-800 shrink-0">
                    Automatischer Versand
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.auto_reminder_enabled}
                      className={cn(
                        'relative h-7 w-12 rounded-full transition',
                        form.auto_reminder_enabled ? 'bg-teal-500' : 'bg-slate-300',
                      )}
                      onClick={() =>
                        setField('auto_reminder_enabled', !form.auto_reminder_enabled)
                      }
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition',
                          form.auto_reminder_enabled ? 'left-5' : 'left-0.5',
                        )}
                      />
                    </button>
                  </label>
                  <span
                    className={cn(
                      'inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[11px] font-bold',
                      form.auto_reminder_enabled
                        ? 'border-teal-200 bg-teal-50 text-teal-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600',
                    )}
                    title={mailSummary}
                  >
                    {autoStatusPill}
                  </span>
                  <span className="hidden lg:inline text-[11px] font-semibold text-slate-500">
                    {planCompact}
                  </span>
                </div>
                {isEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={form.returned}
                      className={cn(
                        'inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 shadow-sm hover:bg-slate-50',
                        form.returned && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      Manuelle Erinnerung senden
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[12rem]">
                      {editableReminderStages.map((stage) => (
                        <DropdownMenuItem
                          key={`send-${stage}`}
                          disabled={sendingStage === stage || form.returned}
                          onClick={() => void sendReminder(stage)}
                        >
                          {sendingStage === stage ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                          ) : null}
                          {reminderStageLabel(stage)}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem
                        disabled={sendingStage === nextPlusStage || form.returned}
                        onClick={() => void sendReminder(nextPlusStage)}
                      >
                        + Neue Stufe
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>

              {/* Row 2 — collapsed stage editor */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                  onClick={() => setReminderDetailsOpen((v) => !v)}
                >
                  <span className="text-sm font-bold text-slate-800 inline-flex items-center gap-2">
                    {reminderDetailsOpen ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    Termine &amp; Empfänger anpassen
                  </span>
                  {!reminderDetailsOpen ? (
                    <span className="text-[11px] font-semibold text-slate-500 truncate">
                      {planCompact}
                    </span>
                  ) : null}
                </button>
                {reminderDetailsOpen ? (
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                    <Field label="Stufe wählen">
                      <select
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                        value={selectedReminderStage}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '__add__') {
                            const next =
                              Math.max(0, ...editableReminderStages) + 1;
                            setExtraReminderStages((prev) =>
                              prev.includes(next) ? prev : [...prev, next],
                            );
                            setSelectedReminderStage(next);
                            return;
                          }
                          setSelectedReminderStage(Number(v) || 1);
                        }}
                      >
                        {editableReminderStages.map((stage) => (
                          <option key={`opt-${stage}`} value={stage}>
                            {reminderStageLabel(stage)}
                          </option>
                        ))}
                        <option value="__add__">+ Stufe hinzufügen</option>
                      </select>
                    </Field>
                    <Field label={`${reminderStageLabel(selectedReminderStage)} Datum`}>
                      <GermanDateInput
                        value={getScheduledDate(selectedReminderStage)}
                        onChange={(iso) => setScheduledDate(selectedReminderStage, iso)}
                      />
                    </Field>
                    {(() => {
                      const key = overrideKeyFor(selectedReminderStage);
                      return (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <EmailChipInput
                            label="AN (E-Mail)"
                            value={form.stage_recipients_override[key]?.to || ''}
                            onChange={(v) =>
                              setForm((prev) => ({
                                ...prev,
                                stage_recipients_override: {
                                  ...prev.stage_recipients_override,
                                  [key]: {
                                    to: v,
                                    cc: prev.stage_recipients_override[key]?.cc || '',
                                  },
                                },
                              }))
                            }
                          />
                          <EmailChipInput
                            label="CC (E-Mail)"
                            value={form.stage_recipients_override[key]?.cc || ''}
                            onChange={(v) =>
                              setForm((prev) => ({
                                ...prev,
                                stage_recipients_override: {
                                  ...prev.stage_recipients_override,
                                  [key]: {
                                    to: prev.stage_recipients_override[key]?.to || '',
                                    cc: v,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                      );
                    })()}
                    <p className="text-[11px] text-slate-500 font-medium">{mailSummary}</p>
                  </div>
                ) : null}
              </div>

              {isEdit ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-sky-600" />
                    Erinnerungsverlauf
                  </h3>
                  <ReturnsReminderStepper
                    hw={{
                      returned: form.returned,
                      mail1_sent_at: form.mail1_sent_at,
                      mail2_sent_at: form.mail2_sent_at,
                      mail3_sent_at: form.mail3_sent_at,
                      mail1_sent_recipients: form.mail1_sent_recipients,
                      mail2_sent_recipients: form.mail2_sent_recipients,
                      mail3_sent_recipients: form.mail3_sent_recipients,
                      reminder_stages: form.reminder_stages || [],
                      reminder_count: form.reminder_count || 0,
                    }}
                    configuredStages={configuredStages}
                    onOpenSend={(stage) => void sendReminder(stage)}
                  />
                </div>
              ) : null}
            </SectionCard>

            <SectionCard
              id="section-abschluss"
              title="Bearbeitung & Steuerung"
              tone="amber"
              icon={<Briefcase className="w-4 h-4" />}
            >
              <div className="space-y-4">
                <h3 className="sr-only">Bearbeitung &amp; Steuerung</h3>
                <Field label="Bearbeiter">
                  <IconFieldShell icon={UserCircle2}>
                    <select
                      className="h-11 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm"
                      value={form.assignee_user_id}
                      onChange={(e) => {
                        const id = e.target.value;
                        const a = assignees.find((x) => x.id === id);
                        setForm((prev) => ({
                          ...prev,
                          assignee_user_id: id,
                          assignee_name: a?.name || a?.email || prev.assignee_name,
                        }));
                      }}
                    >
                      {!assignees.some((a) => a.id === form.assignee_user_id) &&
                      form.assignee_user_id ? (
                        <option value={form.assignee_user_id}>
                          {form.assignee_name ||
                            user?.displayName ||
                            user?.email ||
                            'Aktueller Benutzer'}
                        </option>
                      ) : null}
                      {!form.assignee_user_id ? (
                        <option value="">
                          {form.assignee_name || user?.displayName || 'Aktueller Benutzer'}
                        </option>
                      ) : null}
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name || a.email}
                        </option>
                      ))}
                    </select>
                  </IconFieldShell>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Status">
                    <div className="relative">
                      <span
                        className={cn(
                          'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full',
                          statusDotClass(form.status),
                        )}
                      />
                      <select
                        className="h-11 w-full rounded-md border border-slate-200 bg-white pl-8 pr-3 text-sm"
                        value={form.status}
                        onChange={(e) => setField('status', e.target.value)}
                      >
                        {catalogs.statuses.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="SLA">
                    <select
                      className={cn(
                        'h-11 w-full rounded-md border px-3 text-sm font-semibold',
                        slaBadgeClass(form.sla),
                      )}
                      value={form.sla}
                      onChange={(e) => setField('sla', e.target.value)}
                    >
                      {catalogs.slas.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Service Level">
                  <div className="flex flex-wrap gap-1.5">
                    {catalogs.service_levels.map((sl) => (
                      <button
                        key={sl}
                        type="button"
                        className={cn(
                          'min-w-[2.5rem] rounded-lg border px-3 py-2 text-sm font-black transition',
                          form.service_level === sl
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
                        )}
                        onClick={() =>
                          setField('service_level', form.service_level === sl ? '' : sl)
                        }
                      >
                        {sl}
                      </button>
                    ))}
                  </div>
                </Field>

                <button
                  type="button"
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
                  onClick={() => setTimeOpen((v) => !v)}
                >
                  {timeOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  Benötigte Zeit &amp; Export
                </button>
                {timeOpen ? (
                  <div className="grid grid-cols-3 gap-2">
                    {(['time_sl1_minutes', 'time_sl2_minutes', 'time_sl3_minutes'] as const).map(
                      (key, i) => (
                        <Field key={key} label={`SL${i + 1} Min.`}>
                          <Input
                            type="number"
                            min={0}
                            className="h-10"
                            value={form[key]}
                            onChange={(e) => setField(key, Number(e.target.value) || 0)}
                          />
                        </Field>
                      ),
                    )}
                    <label className="col-span-3 flex items-center justify-between text-sm font-semibold pt-1">
                      Exportiert
                      <input
                        type="checkbox"
                        checked={form.exported}
                        onChange={(e) => setField('exported', e.target.checked)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              {isEdit ? (
                <div className="space-y-4 pt-2 border-t border-slate-100">
                  <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-600" />
                      Verlauf &amp; E-Mail-Protokoll
                    </h3>
                    {activityLog.length === 0 ? (
                      <p className="text-sm text-slate-500">Noch keine Verlaufseinträge.</p>
                    ) : (
                      <ol className="space-y-3">
                        {activityLog
                          .slice()
                          .reverse()
                          .slice(0, 30)
                          .map((entry: any, idx: number) => (
                            <li key={`${entry.at}-${idx}`} className="flex gap-3">
                              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-white border-slate-200 text-slate-600">
                                {entry.type === 'mail_sent' ? (
                                  <Mail className="w-3.5 h-3.5" />
                                ) : entry.type === 'returned' ? (
                                  <Package className="w-3.5 h-3.5" />
                                ) : (
                                  <Clock className="w-3.5 h-3.5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1 border-b border-slate-100 pb-2">
                                <p className="text-sm font-semibold text-slate-900">
                                  {entry.message || entry.type || 'Aktualisiert'}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                                  {formatBerlinDateTime(entry.at)}
                                  {entry.actor ? ` · ${entry.actor}` : ''}
                                </p>
                              </div>
                            </li>
                          ))}
                      </ol>
                    )}
                  </section>
                </div>
              ) : null}
            </SectionCard>
          </div>

          {/* Right Überblick */}
          <aside className="xl:sticky xl:top-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-sm font-black text-slate-900 tracking-tight">Überblick</h2>
              </div>
              <div className="p-5 space-y-3">
                <OverviewRow
                  icon={<UserCircle2 className="w-3.5 h-3.5" />}
                  label="Bearbeiter"
                  value={assigneeLabel}
                />
                <OverviewRow
                  icon={<User className="w-3.5 h-3.5" />}
                  label="Mitarbeiter"
                  value={customerName || '—'}
                />
                <OverviewRow
                  icon={<Package className="w-3.5 h-3.5" />}
                  label="Gerät (Alt / Neu)"
                  value={
                    [
                      form.device_old_type ? `Alt: ${form.device_old_type}` : null,
                      form.device_new_type ? `Neu: ${form.device_new_type}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  }
                />
                <OverviewRow
                  icon={<Hash className="w-3.5 h-3.5" />}
                  label="Seriennummern"
                  value={
                    [
                      form.device_old_serial ? `Alt: ${form.device_old_serial}` : null,
                      form.device_new_serial ? `Neu: ${form.device_new_serial}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || '—'
                  }
                />
                <OverviewRow
                  icon={<Truck className="w-3.5 h-3.5" />}
                  label="Versandart"
                  value={form.shipping_method || '—'}
                />
                <OverviewRow
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  label="Rücklieferung am"
                  value={
                    form.delivery_date ? formatDateDeOnly(form.delivery_date) || '—' : '—'
                  }
                />

                <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 flex gap-2 text-[11px] font-semibold text-amber-900 leading-relaxed">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Bitte prüfen Sie die Angaben vor dem Speichern.
                </div>

                <Button
                  type="button"
                  className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Check className="w-4 h-4 mr-1.5" />
                  )}
                  Rücklieferung speichern
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-10 font-bold text-sky-700 border-sky-200"
                  onClick={resetForm}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  Zurücksetzen
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function OverviewRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 border border-slate-100 text-slate-500">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-semibold text-slate-900 truncate">{value}</p>
      </div>
    </div>
  );
}

export default ReturnEditorPage;
