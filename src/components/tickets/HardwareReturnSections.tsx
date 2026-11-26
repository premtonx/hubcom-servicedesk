import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Package, Truck } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import { toIsoDateOnly } from '../../lib/client-portal/hardware-returns-dates';
import { resolveEffectiveShipmentStatus } from '../../lib/client-portal/hardware-returns-shipment';

export interface HardwareReturnFormState {
  /** Betreff — unused in Part-3 UI (kept for legacy payload compat). */
  subject: string;
  request_type: string;
  device_details: string;
  device_old_type: string;
  device_old_serial: string;
  device_new_type: string;
  device_new_serial: string;
  employee_phone: string;
  employee_mobile: string;
  /** Free-form service level from org catalogs. */
  service_level: string;
  sla: string;
  status: string;
  assignee_user_id: string;
  assignee_name: string;
  directory_user_id: string;
  time_sl1_minutes: number;
  time_sl2_minutes: number;
  time_sl3_minutes: number;
  shipping_method: string;
  shipping_reference: string;
  shipment_status: string;
  solution_summary: string;
  exported: boolean;
  return_required: boolean;
  delivery_date: string;
  return_due_date: string;
  mail1_scheduled_date: string;
  mail2_scheduled_date: string;
  mail3_scheduled_date: string;
  /** Per-stage schedule overrides for stages ≥ 4 (`stage4`, `stage5`, …). */
  stage_scheduled_overrides: Record<string, string>;
  project_manager_name: string;
  project_manager_email: string;
  manager_name: string;
  manager_email: string;
  ceo_email_override: string;
  auto_reminder_enabled: boolean;
  returned: boolean;
  returned_at: string;
  /** Keys: mail1/mail2/mail3 or stageN (N≥4). */
  stage_recipients_override: Record<string, { to: string; cc: string }>;
  mail1_sent_at?: string | null;
  mail2_sent_at?: string | null;
  mail3_sent_at?: string | null;
  mail1_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  mail2_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  mail3_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  reminder_stages?: Array<{
    stage: number;
    sentAt: string | null;
    scheduledDate: string | null;
    recipientsTo: string[];
    recipientsCc: string[];
  }>;
  reminder_count?: number;
}

export function emptyHardwareReturnForm(): HardwareReturnFormState {
  return {
    subject: '',
    request_type: '',
    device_details: '',
    device_old_type: '',
    device_old_serial: '',
    device_new_type: '',
    device_new_serial: '',
    employee_phone: '',
    employee_mobile: '',
    service_level: '',
    sla: 'Normal',
    status: 'Neu',
    assignee_user_id: '',
    assignee_name: '',
    directory_user_id: '',
    time_sl1_minutes: 0,
    time_sl2_minutes: 0,
    time_sl3_minutes: 0,
    shipping_method: '',
    shipping_reference: '',
    shipment_status: 'versendet',
    solution_summary: '',
    exported: false,
    return_required: true,
    delivery_date: '',
    return_due_date: '',
    mail1_scheduled_date: '',
    mail2_scheduled_date: '',
    mail3_scheduled_date: '',
    stage_scheduled_overrides: {},
    project_manager_name: '',
    project_manager_email: '',
    manager_name: '',
    manager_email: '',
    ceo_email_override: '',
    auto_reminder_enabled: true,
    returned: false,
    returned_at: '',
    stage_recipients_override: {},
    reminder_stages: [],
    reminder_count: 0,
  };
}

export function hardwareFormFromRecord(raw: Record<string, unknown> | null | undefined): HardwareReturnFormState {
  const base = emptyHardwareReturnForm();
  if (!raw) return base;
  const sl = Number(raw.service_level);
  const override = (raw.stage_recipients_override || {}) as Record<string, { to?: string[]; cc?: string[] }>;
  const slRaw =
    raw.service_level == null || String(raw.service_level).trim() === ''
      ? ''
      : String(raw.service_level).trim();
  return {
    ...base,
    subject: String(raw.subject || ''),
    request_type: String(raw.request_type || ''),
    device_details: String(raw.device_details || ''),
    device_old_type: String(raw.device_old_type || ''),
    device_old_serial: String(raw.device_old_serial || ''),
    device_new_type: String(raw.device_new_type || ''),
    device_new_serial: String(raw.device_new_serial || ''),
    employee_phone: String(raw.employee_phone || ''),
    employee_mobile: String(raw.employee_mobile || ''),
    service_level: slRaw || (sl === 1 || sl === 2 || sl === 3 ? String(sl) : ''),
    sla: String(raw.sla || 'Normal'),
    status: String(raw.status || 'Neu'),
    assignee_user_id: String(raw.assignee_user_id || ''),
    assignee_name: String(raw.assignee_name || ''),
    directory_user_id: String(raw.directory_user_id || ''),
    time_sl1_minutes: Number(raw.time_sl1_minutes) || 0,
    time_sl2_minutes: Number(raw.time_sl2_minutes) || 0,
    time_sl3_minutes: Number(raw.time_sl3_minutes) || 0,
    shipping_method: String(raw.shipping_method || ''),
    shipping_reference: String(raw.shipping_reference || ''),
    shipment_status: resolveEffectiveShipmentStatus({
      returned: Boolean(raw.returned),
      shipment_status: (raw.shipment_status as string | null) || null,
    }),
    solution_summary: String(raw.solution_summary || ''),
    exported: Boolean(raw.exported),
    return_required: raw.return_required !== false && raw.return_required !== 'f',
    delivery_date: toIsoDateOnly(raw.delivery_date) || '',
    return_due_date: toIsoDateOnly(raw.return_due_date) || '',
    mail1_scheduled_date: toIsoDateOnly(raw.mail1_scheduled_date) || '',
    mail2_scheduled_date: toIsoDateOnly(raw.mail2_scheduled_date) || '',
    mail3_scheduled_date: toIsoDateOnly(raw.mail3_scheduled_date) || '',
    stage_scheduled_overrides: (() => {
      const out: Record<string, string> = {};
      const stages = Array.isArray(raw.reminder_stages)
        ? (raw.reminder_stages as Array<{ stage?: number; scheduledDate?: string | null }>)
        : [];
      for (const ev of stages) {
        const n = Number(ev.stage);
        if (!Number.isInteger(n) || n < 4) continue;
        const iso = toIsoDateOnly(ev.scheduledDate);
        if (iso) out[`stage${n}`] = iso;
      }
      return out;
    })(),
    project_manager_name: String(raw.project_manager_name || ''),
    project_manager_email: String(raw.project_manager_email || ''),
    manager_name: String(raw.manager_name || ''),
    manager_email: String(raw.manager_email || ''),
    ceo_email_override: String(raw.ceo_email_override || ''),
    auto_reminder_enabled: raw.auto_reminder_enabled !== false,
    returned: Boolean(raw.returned),
    returned_at: raw.returned_at ? String(raw.returned_at) : '',
    stage_recipients_override: (() => {
      const out: Record<string, { to: string; cc: string }> = {};
      for (const [key, val] of Object.entries(override)) {
        if (!val || typeof val !== 'object') continue;
        out[key] = {
          to: (val.to || []).join(', '),
          cc: (val.cc || []).join(', '),
        };
      }
      return out;
    })(),
    mail1_sent_at: raw.mail1_sent_at ? String(raw.mail1_sent_at) : null,
    mail2_sent_at: raw.mail2_sent_at ? String(raw.mail2_sent_at) : null,
    mail3_sent_at: raw.mail3_sent_at ? String(raw.mail3_sent_at) : null,
    mail1_sent_recipients: (raw.mail1_sent_recipients as any) || null,
    mail2_sent_recipients: (raw.mail2_sent_recipients as any) || null,
    mail3_sent_recipients: (raw.mail3_sent_recipients as any) || null,
    reminder_stages: Array.isArray(raw.reminder_stages)
      ? (raw.reminder_stages as HardwareReturnFormState['reminder_stages'])
      : [],
    reminder_count: Number(raw.reminder_count) || 0,
  };
}

function splitEmails(raw: string | undefined): string[] {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));
}

export function hardwareFormToPayload(form: HardwareReturnFormState): Record<string, unknown> {
  const override: Record<string, { to: string[]; cc: string[] }> = {};
  for (const [key, stage] of Object.entries(form.stage_recipients_override || {})) {
    if (!stage || !/^(mail[123]|stage\d+)$/.test(key)) continue;
    const to = splitEmails(stage.to);
    const cc = splitEmails(stage.cc);
    if (to.length || cc.length) override[key] = { to, cc };
  }
  return {
    request_type: form.request_type || null,
    device_details: form.device_details || null,
    device_old_type: form.device_old_type || null,
    device_old_serial: form.device_old_serial || null,
    device_new_type: form.device_new_type || null,
    device_new_serial: form.device_new_serial || null,
    employee_phone: form.employee_phone || null,
    employee_mobile: form.employee_mobile || null,
    service_level: form.service_level || null,
    sla: form.sla || 'Normal',
    status: form.status || 'Neu',
    assignee_user_id: form.assignee_user_id || null,
    assignee_name: form.assignee_name || null,
    directory_user_id: form.directory_user_id || null,
    time_sl1_minutes: form.time_sl1_minutes || 0,
    time_sl2_minutes: form.time_sl2_minutes || 0,
    time_sl3_minutes: form.time_sl3_minutes || 0,
    shipping_method: form.shipping_method || null,
    shipping_reference: form.shipping_reference || null,
    shipment_status: form.shipment_status || null,
    solution_summary: form.solution_summary || null,
    exported: form.exported,
    return_required: form.return_required,
    delivery_date: toIsoDateOnly(form.delivery_date),
    return_due_date: toIsoDateOnly(form.return_due_date),
    mail1_scheduled_date: toIsoDateOnly(form.mail1_scheduled_date),
    mail2_scheduled_date: toIsoDateOnly(form.mail2_scheduled_date),
    mail3_scheduled_date: toIsoDateOnly(form.mail3_scheduled_date),
    project_manager_name: form.project_manager_name || null,
    project_manager_email: form.project_manager_email || null,
    manager_name: form.manager_name || null,
    manager_email: form.manager_email || null,
    ceo_email_override: form.ceo_email_override || null,
    auto_reminder_enabled: form.auto_reminder_enabled,
    returned: form.returned,
    returned_at: form.returned_at ? new Date(form.returned_at).toISOString() : null,
    stage_recipients_override: Object.keys(override).length ? override : null,
  };
}

function MailBadge(props: {
  label: string;
  sentAt?: string | null;
  recipients?: { to?: string[]; cc?: string[] } | null;
}) {
  const sent = Boolean(props.sentAt);
  const tip = useMemo(() => {
    if (!sent) return 'Noch nicht gesendet';
    const to = (props.recipients?.to || []).join(', ') || '—';
    const cc = (props.recipients?.cc || []).join(', ') || '—';
    return `${new Date(props.sentAt!).toLocaleString('de-DE')}\nAn: ${to}\nCC: ${cc}`;
  }, [props.sentAt, props.recipients, sent]);
  return (
    <span
      title={tip}
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold',
        sent ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500',
      )}
    >
      {props.label}
      {sent ? ' ✓' : ''}
    </span>
  );
}

interface HardwareReturnSectionsProps {
  value: HardwareReturnFormState;
  onChange: (next: HardwareReturnFormState) => void;
  readOnly?: boolean;
  compact?: boolean;
}

export function HardwareReturnSections({
  value,
  onChange,
  readOnly,
  compact,
}: HardwareReturnSectionsProps) {
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const set = <K extends keyof HardwareReturnFormState>(key: K, v: HardwareReturnFormState[K]) => {
    const next = { ...value, [key]: v };
    if (key === 'delivery_date' && typeof v === 'string' && v && !value.return_due_date) {
      const d = new Date(`${v}T00:00:00`);
      d.setDate(d.getDate() + 14);
      next.return_due_date = d.toISOString().slice(0, 10);
    }
    onChange(next);
  };

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Package className="w-4 h-4 text-emerald-600" />
          Hardware &amp; Service-Level (SL1–SL3)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Anfragetyp">
            <Input
              disabled={readOnly}
              value={value.request_type}
              onChange={(e) => set('request_type', e.target.value)}
            />
          </Field>
          <Field label="Versandart">
            <select
              disabled={readOnly}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={value.shipping_method}
              onChange={(e) => set('shipping_method', e.target.value)}
            >
              <option value="">—</option>
              <option value="Standard">Standard</option>
              <option value="Express">Express</option>
              <option value="Abholung">Abholung</option>
            </select>
          </Field>
          <Field label="Gerätetyp / Seriennummern (ALT &amp; NEU)" className="md:col-span-2">
            <Textarea
              disabled={readOnly}
              value={value.device_details}
              onChange={(e) => set('device_details', e.target.value)}
              rows={2}
            />
          </Field>
          <Field label="Telefon Büro">
            <Input
              disabled={readOnly}
              value={value.employee_phone}
              onChange={(e) => set('employee_phone', e.target.value)}
            />
          </Field>
          <Field label="Mobil">
            <Input
              disabled={readOnly}
              value={value.employee_mobile}
              onChange={(e) => set('employee_mobile', e.target.value)}
            />
          </Field>
          <Field label="Service Level">
            <select
              disabled={readOnly}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={value.service_level}
              onChange={(e) => set('service_level', e.target.value as any)}
            >
              <option value="">—</option>
              <option value="1">SL1</option>
              <option value="2">SL2</option>
              <option value="3">SL3</option>
            </select>
          </Field>
          <Field label="Versand">
            <Input
              disabled={readOnly}
              value={value.shipping_reference}
              onChange={(e) => set('shipping_reference', e.target.value)}
            />
          </Field>
          <Field label="Zeit SL1 (Min.)">
            <Input
              type="number"
              disabled={readOnly}
              value={value.time_sl1_minutes}
              onChange={(e) => set('time_sl1_minutes', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Zeit SL2 (Min.)">
            <Input
              type="number"
              disabled={readOnly}
              value={value.time_sl2_minutes}
              onChange={(e) => set('time_sl2_minutes', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Zeit SL3 (Min.)">
            <Input
              type="number"
              disabled={readOnly}
              value={value.time_sl3_minutes}
              onChange={(e) => set('time_sl3_minutes', Number(e.target.value) || 0)}
            />
          </Field>
          <Field label="Exportiert">
            <label className="inline-flex items-center gap-2 text-sm h-9">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={value.exported}
                onChange={(e) => set('exported', e.target.checked)}
              />
              Ja
            </label>
          </Field>
          <Field label="Lösung" className="md:col-span-2">
            <Textarea
              disabled={readOnly}
              value={value.solution_summary}
              onChange={(e) => set('solution_summary', e.target.value)}
              rows={3}
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Truck className="w-4 h-4 text-sky-600" />
          Rücklieferung &amp; Empfänger
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Rücklieferung">
            <label className="inline-flex items-center gap-2 text-sm h-9">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={value.return_required}
                onChange={(e) => set('return_required', e.target.checked)}
              />
              Ja
            </label>
          </Field>
          <Field label="Auto-Erinnerung aktiv">
            <label className="inline-flex items-center gap-2 text-sm h-9">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={value.auto_reminder_enabled}
                onChange={(e) => set('auto_reminder_enabled', e.target.checked)}
              />
              Ja
            </label>
          </Field>
          <Field label="Datum der Lieferung">
            <Input
              type="date"
              disabled={readOnly}
              value={value.delivery_date}
              onChange={(e) => set('delivery_date', e.target.value)}
            />
          </Field>
          <Field label="Fällig am">
            <Input
              type="date"
              disabled={readOnly}
              value={value.return_due_date}
              onChange={(e) => set('return_due_date', e.target.value)}
            />
          </Field>
          <Field label="Projektmanager Name">
            <Input
              disabled={readOnly}
              value={value.project_manager_name}
              onChange={(e) => set('project_manager_name', e.target.value)}
            />
          </Field>
          <Field label="Projektmanager E-Mail">
            <Input
              type="email"
              disabled={readOnly}
              value={value.project_manager_email}
              onChange={(e) => set('project_manager_email', e.target.value)}
            />
          </Field>
          <Field label="Vorgesetzter / Chef Name">
            <Input
              disabled={readOnly}
              value={value.manager_name}
              onChange={(e) => set('manager_name', e.target.value)}
            />
          </Field>
          <Field label="Vorgesetzter / Chef E-Mail">
            <Input
              type="email"
              disabled={readOnly}
              value={value.manager_email}
              onChange={(e) => set('manager_email', e.target.value)}
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <MailBadge label="1. Mail" sentAt={value.mail1_sent_at} recipients={value.mail1_sent_recipients} />
          <MailBadge label="2. Mail" sentAt={value.mail2_sent_at} recipients={value.mail2_sent_recipients} />
          <MailBadge label="3. Mail" sentAt={value.mail3_sent_at} recipients={value.mail3_sent_recipients} />
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
          onClick={() => setRecipientsOpen((v) => !v)}
        >
          {recipientsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Empfänger pro Mahnstufe anpassen
        </button>

        {recipientsOpen ? (
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 border border-slate-100 p-3">
            {(['mail1', 'mail2', 'mail3'] as const).map((key, idx) => (
              <div key={key} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Field label={`Mail ${idx + 1} — An (E-Mails, kommagetrennt)`}>
                  <Input
                    disabled={readOnly}
                    value={value.stage_recipients_override[key]?.to || ''}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        stage_recipients_override: {
                          ...value.stage_recipients_override,
                          [key]: {
                            to: e.target.value,
                            cc: value.stage_recipients_override[key]?.cc || '',
                          },
                        },
                      })
                    }
                  />
                </Field>
                <Field label={`Mail ${idx + 1} — CC`}>
                  <Input
                    disabled={readOnly}
                    value={value.stage_recipients_override[key]?.cc || ''}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        stage_recipients_override: {
                          ...value.stage_recipients_override,
                          [key]: {
                            to: value.stage_recipients_override[key]?.to || '',
                            cc: e.target.value,
                          },
                        },
                      })
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <Field label="Rücklieferung erfolgt">
            <label className="inline-flex items-center gap-2 text-sm h-9">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={value.returned}
                onChange={(e) => set('returned', e.target.checked)}
              />
              Ja
            </label>
          </Field>
          <Field label="Wann zurückgeliefert">
            <Input
              type="datetime-local"
              disabled={readOnly || !value.returned}
              value={value.returned_at}
              onChange={(e) => set('returned_at', e.target.value)}
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</Label>
      {children}
    </div>
  );
}

export default HardwareReturnSections;
