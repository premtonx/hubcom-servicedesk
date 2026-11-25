import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  Search,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import {
  emptyHardwareReturnForm,
  hardwareFormFromRecord,
  hardwareFormToPayload,
  type HardwareReturnFormState,
} from '../tickets/HardwareReturnSections';
import { extractHardwareContactsFromUser } from '../../lib/client-portal/hardware-returns-nav-contacts';

export type ReturnMemberOption = {
  id: string;
  name: string;
  email: string;
  phone_office?: string | null;
  phone_mobile?: string | null;
  project_manager_name?: string | null;
  project_manager_email?: string | null;
  manager_name?: string | null;
  manager_email?: string | null;
};

interface ReturnCreateEditDrawerProps {
  open: boolean;
  mode: 'portal' | 'staff';
  organizationId: string;
  /** Existing row when editing; null when creating. */
  editItem: {
    ticketId: string;
    subject?: string | null;
    customerName?: string | null;
    customerEmail?: string | null;
    hardwareReturn: Record<string, unknown>;
  } | null;
  members: ReturnMemberOption[];
  orgCeoEmail?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Toggle({
  checked,
  onChange,
  labelYes = 'Ja',
  labelNo = 'Nein',
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  labelYes?: string;
  labelNo?: string;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={cn(
          'px-3 py-1.5 text-xs font-bold rounded-md transition',
          checked ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
        )}
      >
        {labelYes}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={cn(
          'px-3 py-1.5 text-xs font-bold rounded-md transition',
          !checked ? 'bg-white text-slate-800 shadow-sm border border-slate-200' : 'text-slate-600',
        )}
      >
        {labelNo}
      </button>
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
      <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
        {label}
      </Label>
      {children}
    </div>
  );
}

function EmailChipInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
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
            {!disabled ? (
              <button
                type="button"
                className="rounded-full p-0.5 text-slate-400 hover:text-rose-600"
                onClick={() =>
                  onChange(chips.filter((x) => x.toLowerCase() !== c.toLowerCase()).join(', '))
                }
              >
                <X className="w-3 h-3" />
              </button>
            ) : null}
          </span>
        ))}
        {!disabled ? (
          <input
            className="flex-1 min-w-[120px] text-sm outline-none bg-transparent py-1 px-1"
            placeholder="E-Mail + Enter"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commit(draft);
              }
            }}
            onBlur={() => commit(draft)}
          />
        ) : null}
      </div>
    </Field>
  );
}

export function ReturnCreateEditDrawer({
  open,
  mode,
  organizationId,
  editItem,
  members,
  orgCeoEmail,
  onClose,
  onSaved,
}: ReturnCreateEditDrawerProps) {
  const base = mode === 'portal' ? '/api/portal/returns' : '/api/returns';
  const isEdit = Boolean(editItem?.ticketId);
  const [form, setForm] = useState<HardwareReturnFormState>(() => emptyHardwareReturnForm());
  const [requesterId, setRequesterId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [memberOpen, setMemberOpen] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      const hw = hardwareFormFromRecord({
        ...editItem.hardwareReturn,
        subject: editItem.subject || 'Hardware',
      });
      setForm(hw);
      setCustomerName(editItem.customerName || '');
      setCustomerEmail(editItem.customerEmail || '');
      const match = members.find(
        (m) =>
          m.email &&
          editItem.customerEmail &&
          m.email.toLowerCase() === editItem.customerEmail.toLowerCase(),
      );
      setRequesterId(match?.id || '');
    } else {
      const blank = emptyHardwareReturnForm();
      blank.ceo_email_override = orgCeoEmail || '';
      blank.return_required = true;
      setForm(blank);
      setCustomerName('');
      setCustomerEmail('');
      setRequesterId('');
    }
    setMemberQuery('');
    setRecipientsOpen(false);
  }, [open, editItem, members, orgCeoEmail]);

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return members.slice(0, 40);
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [members, memberQuery]);

  const selectedMember = members.find((m) => m.id === requesterId) || null;

  const applyMember = (m: ReturnMemberOption) => {
    setRequesterId(m.id);
    setCustomerName(m.name || '');
    setCustomerEmail(m.email || '');
    setMemberQuery('');
    setMemberOpen(false);
    const contacts = extractHardwareContactsFromUser(m as any);
    setForm((prev) => ({
      ...prev,
      employee_phone: contacts.employee_phone || prev.employee_phone,
      employee_mobile: contacts.employee_mobile || prev.employee_mobile,
      project_manager_name: contacts.project_manager_name || prev.project_manager_name,
      project_manager_email: contacts.project_manager_email || prev.project_manager_email,
      manager_name: contacts.manager_name || prev.manager_name,
      manager_email: contacts.manager_email || prev.manager_email,
    }));
  };

  const setField = <K extends keyof HardwareReturnFormState>(
    key: K,
    value: HardwareReturnFormState[K],
  ) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'delivery_date' && typeof value === 'string' && value) {
        // Auto +14 days unless user already overrode due date relative to previous delivery.
        next.return_due_date = addDaysIso(value, 14);
      }
      return next;
    });
  };

  const save = async () => {
    if (!customerName.trim() && !customerEmail.trim() && !requesterId) {
      toast.error('Bitte einen Mitarbeiter auswählen oder Name/E-Mail angeben.');
      return;
    }
    setSaving(true);
    try {
      const hardwareReturn = hardwareFormToPayload(form);
      if (isEdit && editItem) {
        await axios.put(
          `${base}/${encodeURIComponent(editItem.ticketId)}${
            mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
          }`,
          {
            organizationId: mode === 'staff' ? organizationId : undefined,
            subject: form.subject || 'Hardware',
            customerName: customerName || null,
            customerEmail: customerEmail || null,
            hardwareReturn,
          },
          { withCredentials: true },
        );
        toast.success('Rücklieferung gespeichert.');
      } else {
        await axios.post(
          `${base}${mode === 'staff' ? `?organizationId=${encodeURIComponent(organizationId)}` : ''}`,
          {
            organizationId: mode === 'staff' ? organizationId : undefined,
            subject: form.subject || 'Hardware',
            description: form.device_details || form.solution_summary || 'Hardware-Rücklieferung',
            requesterId: requesterId || undefined,
            customerName: customerName || null,
            customerEmail: customerEmail || null,
            hardwareReturn,
          },
          { withCredentials: true },
        );
        toast.success('Rücklieferung erstellt.');
      }
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        aria-label="Schließen"
        onClick={onClose}
      />
      <div
        className="relative z-10 max-w-4xl w-full h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-drawer-title"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-white">
          <div>
            <h2 id="return-drawer-title" className="text-lg font-black text-slate-900 tracking-tight">
              {isEdit ? 'Rücklieferung bearbeiten' : 'Neue Rücklieferung erstellen'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Hardware, Kontakte und Mahnstufen in einem Vorgang
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            onClick={onClose}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Card 1 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-600" />
              1. Mitarbeiter &amp; Kontakte
            </h3>

            <Field label="Mitarbeiter">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9 h-10"
                  placeholder="Suchen nach Name oder E-Mail…"
                  value={memberOpen ? memberQuery : selectedMember?.name || customerName || memberQuery}
                  onChange={(e) => {
                    setMemberQuery(e.target.value);
                    setMemberOpen(true);
                  }}
                  onFocus={() => setMemberOpen(true)}
                  onBlur={() => window.setTimeout(() => setMemberOpen(false), 150)}
                />
                {memberOpen && filteredMembers.length > 0 ? (
                  <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1">
                    {filteredMembers.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-slate-50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => applyMember(m)}
                        >
                          <span className="block text-sm font-semibold text-slate-800 truncate">
                            {m.name || m.email}
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate">{m.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="E-Mail">
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </Field>
              <Field label="Name">
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </Field>
              <Field label="Telefon Büro">
                <Input
                  value={form.employee_phone}
                  onChange={(e) => setField('employee_phone', e.target.value)}
                />
              </Field>
              <Field label="Mobil">
                <Input
                  value={form.employee_mobile}
                  onChange={(e) => setField('employee_mobile', e.target.value)}
                />
              </Field>
              <Field label="Projektmanager (Name)">
                <Input
                  value={form.project_manager_name}
                  onChange={(e) => setField('project_manager_name', e.target.value)}
                />
              </Field>
              <Field label="Projektmanager (E-Mail)">
                <Input
                  type="email"
                  value={form.project_manager_email}
                  onChange={(e) => setField('project_manager_email', e.target.value)}
                />
              </Field>
              <Field label="Vorgesetzter / Chef (Name)">
                <Input
                  value={form.manager_name}
                  onChange={(e) => setField('manager_name', e.target.value)}
                />
              </Field>
              <Field label="Vorgesetzter / Chef (E-Mail)">
                <Input
                  type="email"
                  value={form.manager_email}
                  onChange={(e) => setField('manager_email', e.target.value)}
                />
              </Field>
              <Field label="Geschäftsführung / CEO" className="sm:col-span-2">
                <Input
                  type="email"
                  placeholder={orgCeoEmail || 'ceo@firma.de'}
                  value={form.ceo_email_override}
                  onChange={(e) => setField('ceo_email_override', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* Card 2 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600" />
              2. Hardware &amp; Service-Level (SL1–SL3)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Betreff">
                <Input
                  value={form.subject}
                  onChange={(e) => setField('subject', e.target.value)}
                />
              </Field>
              <Field label="Anfragetyp">
                <Input
                  value={form.request_type}
                  onChange={(e) => setField('request_type', e.target.value)}
                  placeholder="z. B. Austausch, Neuausgabe"
                />
              </Field>
              <Field label="Gerätetyp / Seriennummern (ALT &amp; NEU)" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={form.device_details}
                  onChange={(e) => setField('device_details', e.target.value)}
                />
              </Field>
              <Field label="Service Level (SL1 / SL2 / SL3)" className="sm:col-span-2">
                <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 gap-0.5">
                  {(['1', '2', '3'] as const).map((sl) => (
                    <button
                      key={sl}
                      type="button"
                      onClick={() => setField('service_level', sl)}
                      className={cn(
                        'px-4 py-2 text-xs font-bold rounded-md transition',
                        form.service_level === sl
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white',
                      )}
                    >
                      SL{sl}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Benötigte Zeit SL1 (Min.)">
                <Input
                  type="number"
                  value={form.time_sl1_minutes}
                  onChange={(e) => setField('time_sl1_minutes', Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Benötigte Zeit SL2 (Min.)">
                <Input
                  type="number"
                  value={form.time_sl2_minutes}
                  onChange={(e) => setField('time_sl2_minutes', Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Benötigte Zeit SL3 (Min.)">
                <Input
                  type="number"
                  value={form.time_sl3_minutes}
                  onChange={(e) => setField('time_sl3_minutes', Number(e.target.value) || 0)}
                />
              </Field>
              <Field label="Versandart">
                <select
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={form.shipping_method}
                  onChange={(e) => setField('shipping_method', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Standard">Standard</option>
                  <option value="Express">Express</option>
                  <option value="Abholung">Abholung</option>
                </select>
              </Field>
              <Field label="Versand">
                <Input
                  value={form.shipping_reference}
                  onChange={(e) => setField('shipping_reference', e.target.value)}
                  placeholder="Tracking / Referenz"
                />
              </Field>
              <Field label="Lösung" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={form.solution_summary}
                  onChange={(e) => setField('solution_summary', e.target.value)}
                />
              </Field>
              <Field label="Exportiert">
                <Toggle
                  checked={form.exported}
                  onChange={(v) => setField('exported', v)}
                />
              </Field>
            </div>
          </section>

          {/* Card 3 */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Truck className="w-4 h-4 text-sky-600" />
              3. Rücklieferung &amp; Mahnstufen
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Rücklieferung erforderlich">
                <Toggle
                  checked={form.return_required}
                  onChange={(v) => setField('return_required', v)}
                />
              </Field>
              <Field label="Automatischer Versand aktiv">
                <Toggle
                  checked={form.auto_reminder_enabled}
                  onChange={(v) => setField('auto_reminder_enabled', v)}
                />
              </Field>
              <Field label="Datum der Lieferung">
                <Input
                  type="date"
                  value={form.delivery_date}
                  onChange={(e) => setField('delivery_date', e.target.value)}
                />
              </Field>
              <Field label="Fällig am (+14 Tage)">
                <Input
                  type="date"
                  value={form.return_due_date}
                  onChange={(e) => setField('return_due_date', e.target.value)}
                />
              </Field>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
              onClick={() => setRecipientsOpen((v) => !v)}
            >
              {recipientsOpen ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Mahnempfänger anpassen
            </button>

            {recipientsOpen ? (
              <div className="space-y-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                {(['mail1', 'mail2', 'mail3'] as const).map((key, idx) => (
                  <div key={key} className="space-y-2">
                    <p className="text-xs font-black text-slate-700">{idx + 1}. Mail</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <EmailChipInput
                        label="An (To)"
                        value={form.stage_recipients_override[key]?.to || ''}
                        onChange={(to) =>
                          setForm((prev) => ({
                            ...prev,
                            stage_recipients_override: {
                              ...prev.stage_recipients_override,
                              [key]: {
                                to,
                                cc: prev.stage_recipients_override[key]?.cc || '',
                              },
                            },
                          }))
                        }
                      />
                      <EmailChipInput
                        label="CC"
                        value={form.stage_recipients_override[key]?.cc || ''}
                        onChange={(cc) =>
                          setForm((prev) => ({
                            ...prev,
                            stage_recipients_override: {
                              ...prev.stage_recipients_override,
                              [key]: {
                                to: prev.stage_recipients_override[key]?.to || '',
                                cc,
                              },
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {isEdit ? (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['1. Mail', form.mail1_sent_at, form.mail1_sent_recipients],
                      ['2. Mail', form.mail2_sent_at, form.mail2_sent_recipients],
                      ['3. Mail', form.mail3_sent_at, form.mail3_sent_recipients],
                    ] as const
                  ).map(([label, sentAt, recipients]) => (
                    <span
                      key={label}
                      title={
                        sentAt
                          ? `${new Date(sentAt).toLocaleString('de-DE')}\nAn: ${((recipients as any)?.to || []).join(', ') || '—'}`
                          : 'Noch nicht gesendet'
                      }
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold border',
                        sentAt
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-slate-100 text-slate-500 border-slate-200',
                      )}
                    >
                      {label}
                      {sentAt ? ' ✓' : ''}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Rücklieferung erfolgt">
                    <Toggle
                      checked={form.returned}
                      onChange={(v) => setField('returned', v)}
                    />
                  </Field>
                  <Field label="Wann zurückgeliefert">
                    <Input
                      type="datetime-local"
                      disabled={!form.returned}
                      value={form.returned_at}
                      onChange={(e) => setField('returned_at', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="sticky bottom-0 z-10 flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-white">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button
            type="button"
            className="min-w-[120px] bg-blue-600 hover:bg-blue-700 text-white"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Speichern
          </Button>
        </footer>
      </div>
    </div>
  );
}
