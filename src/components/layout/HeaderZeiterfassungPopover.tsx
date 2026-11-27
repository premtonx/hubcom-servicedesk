/**
 * Compact header clock → quick-log Zeiterfassung popover.
 * Posts to the same /api/time-entries staff endpoint (FORCE RLS / hubcom_app).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useTranslation } from '../../lib/context/I18nContext';
import { timeEntryService } from '../../services/timeEntryService';
import type { Ticket as TicketType } from '../../types';

type OrgOption = { id: string; name: string; crmCompanyId?: string | null };
type TicketOption = { id: string; label: string; organizationId: string };

function hoursFromParts(h: number, m: number): number {
  return Math.round((h + m / 60) * 4) / 4;
}

function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatHoursDe(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export type HeaderZeiterfassungPopoverProps = {
  /** Live ticket list from MainLayout (for /tickets/:id context). */
  tickets?: TicketType[];
  className?: string;
};

export function HeaderZeiterfassungPopover({
  tickets = [],
  className,
}: HeaderZeiterfassungPopoverProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [allTickets, setAllTickets] = useState<TicketOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [organizationId, setOrganizationId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [orgQuery, setOrgQuery] = useState('');
  const [kuerzel, setKuerzel] = useState('');
  const [hoursPart, setHoursPart] = useState(1);
  const [minutesPart, setMinutesPart] = useState(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sonderzahlung, setSonderzahlung] = useState(false);
  const [description, setDescription] = useState('');
  const [standardRate, setStandardRate] = useState(120);
  const [specialRate, setSpecialRate] = useState(140);

  const seededForOpen = useRef(false);

  const contextPrefill = useMemo(() => {
    // Ticket detail: /tickets/:id
    const ticketMatch = location.pathname.match(/^\/tickets\/([^/]+)/);
    if (ticketMatch) {
      const id = ticketMatch[1];
      const ticket =
        tickets.find((row) => row.id === id) ||
        tickets.find((row) => String(row.customId || '') === id);
      if (ticket) {
        const orgId = String(
          ticket.organizationId || (ticket as any).organization_id || '',
        ).trim();
        return {
          organizationId: orgId || '',
          ticketId: ticket.id,
        };
      }
      // Fallback to route param id as ticketId if list not hydrated yet
      return { organizationId: '', ticketId: id };
    }

    // Customer detail: /admin/customers?id=… or /customers?id=…
    if (
      location.pathname.startsWith('/admin/customers') ||
      location.pathname.startsWith('/customers')
    ) {
      const crmId = searchParams.get('id') || '';
      if (crmId) {
        const org = organizations.find(
          (o) => o.crmCompanyId === crmId || o.id === crmId,
        );
        return {
          organizationId: org?.id || '',
          ticketId: '',
          crmCompanyId: crmId,
        };
      }
    }

    return { organizationId: '', ticketId: '' };
  }, [location.pathname, searchParams, tickets, organizations]);

  const loadMeta = useCallback(async () => {
    setLoadingMeta(true);
    try {
      const [defaults, orgRes, ticketRes] = await Promise.all([
        timeEntryService.getDefaults(),
        axios
          .get('/api/admin/organizations', { withCredentials: true })
          .catch(() => ({ data: { organizations: [] } })),
        axios
          .get('/api/db', {
            params: { collection: 'tickets' },
            withCredentials: true,
          })
          .catch(() => ({ data: { documents: [] } })),
      ]);

      setStandardRate(defaults.rates.standardHourlyRate || 120);
      setSpecialRate(defaults.rates.specialHourlyRate || 140);
      setKuerzel((prev) => prev || defaults.kuerzel || '');

      const rows = (orgRes.data?.organizations || []) as Array<{
        id: string;
        name?: string;
        crm_company_id?: string | null;
      }>;
      setOrganizations(
        rows
          .map((o) => ({
            id: o.id,
            name: String(o.name || o.id),
            crmCompanyId: o.crm_company_id || null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      );

      const docs = Array.isArray(ticketRes.data?.documents)
        ? ticketRes.data.documents
        : Array.isArray(ticketRes.data)
          ? ticketRes.data
          : [];
      setAllTickets(
        docs.slice(0, 400).map((d: any) => ({
          id: String(d.id),
          organizationId: String(d.organizationId || d.organization_id || ''),
          label: `${String(d.customId || d.id).replace(/^#/, '')} — ${String(d.subject || '').slice(0, 48)}`,
        })),
      );
    } catch {
      /* keep empty options */
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      seededForOpen.current = false;
      return;
    }
    void loadMeta();
  }, [open, loadMeta]);

  // Apply route context once meta is ready for this open session
  useEffect(() => {
    if (!open || loadingMeta || seededForOpen.current) return;
    seededForOpen.current = true;

    let nextOrg = contextPrefill.organizationId;
    if (!nextOrg && (contextPrefill as any).crmCompanyId) {
      const match = organizations.find(
        (o) => o.crmCompanyId === (contextPrefill as any).crmCompanyId,
      );
      nextOrg = match?.id || '';
    }
    if (nextOrg) setOrganizationId(nextOrg);
    if (contextPrefill.ticketId) setTicketId(contextPrefill.ticketId);
  }, [open, loadingMeta, contextPrefill, organizations]);

  const filteredOrgs = useMemo(() => {
    const q = orgQuery.trim().toLowerCase();
    if (!q) return organizations.slice(0, 60);
    return organizations
      .filter((o) => o.name.toLowerCase().includes(q))
      .slice(0, 60);
  }, [organizations, orgQuery]);

  const ticketOptions = useMemo(() => {
    if (!organizationId) return [];
    return allTickets
      .filter((row) => row.organizationId === organizationId)
      .slice(0, 80);
  }, [allTickets, organizationId]);

  const activeRate = sonderzahlung ? specialRate : standardRate;
  const previewHours = hoursFromParts(hoursPart, minutesPart);
  const previewAmount = Math.round(previewHours * activeRate * 100) / 100;
  const canSubmit =
    Boolean(organizationId) && Boolean(kuerzel.trim()) && previewHours > 0 && !submitting;

  const resetAfterSuccess = () => {
    setDescription('');
    setHoursPart(1);
    setMinutesPart(0);
    setSonderzahlung(false);
    setDate(new Date().toISOString().slice(0, 10));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const companyName =
        organizations.find((o) => o.id === organizationId)?.name || undefined;
      await timeEntryService.create({
        organizationId,
        ticketId: ticketId || null,
        kuerzel: kuerzel.trim().toUpperCase(),
        hours: previewHours,
        minutes: minutesPart,
        sonderzahlung,
        description: description.trim(),
        date,
        customerCompany: companyName,
      });
      toast.success(t('timeTracking.created', 'Zeit erfasst.'));
      resetAfterSuccess();
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || t('timeTracking.saveFailed', 'Speichern fehlgeschlagen.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('timeTracking.tabTitle', 'Zeiterfassung')}
          aria-label={t('timeTracking.tabTitle', 'Zeiterfassung')}
          className={cn(
            'flex items-center justify-center h-9 w-9 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs shrink-0 cursor-pointer',
            open && 'bg-blue-50 text-blue-700 border-blue-200',
            className,
          )}
        >
          <Clock className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(100vw-1.5rem,400px)] p-0 rounded-2xl border border-slate-200 bg-white shadow-xl z-[120]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="px-4 pt-3.5 pb-2 border-b border-slate-100 flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black text-slate-900 tracking-tight">
              {t('timeTracking.quickLogTitle', 'Zeit erfassen')}
            </p>
            <p className="text-[10px] text-slate-500 font-medium truncate">
              {t('timeTracking.quickLogHint', 'Schnell erfassen — gleiche API wie die Übersicht')}
            </p>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[min(70vh,520px)] overflow-y-auto">
          {loadingMeta ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('timeTracking.company', 'Unternehmen')}
                  <span className="text-rose-600"> *</span>
                </Label>
                <Input
                  value={orgQuery}
                  onChange={(e) => setOrgQuery(e.target.value)}
                  placeholder={t('timeTracking.companySearchPlaceholder', 'Unternehmen suchen…')}
                  className="h-8 text-xs rounded-lg"
                />
                <select
                  className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold"
                  value={organizationId}
                  onChange={(e) => {
                    setOrganizationId(e.target.value);
                    setTicketId('');
                    setOrgQuery('');
                  }}
                >
                  <option value="">
                    {t('timeTracking.selectCompany', 'Unternehmen wählen…')}
                  </option>
                  {(orgQuery.trim()
                    ? filteredOrgs.concat(
                        organizations.filter(
                          (o) =>
                            o.id === organizationId &&
                            !filteredOrgs.some((f) => f.id === o.id),
                        ),
                      )
                    : organizations
                  ).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('timeTracking.linkTicket', 'Ticket')}
                </Label>
                <select
                  className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold disabled:opacity-60"
                  value={ticketId}
                  disabled={!organizationId}
                  onChange={(e) => setTicketId(e.target.value)}
                >
                  <option value="">{t('timeTracking.noTicket', 'Kein Ticket')}</option>
                  {ticketOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('timeTracking.kuerzel', 'Kürzel')}
                  </Label>
                  <Input
                    value={kuerzel}
                    onChange={(e) => setKuerzel(e.target.value.toUpperCase())}
                    placeholder="PX"
                    maxLength={12}
                    className="h-8 text-xs rounded-lg font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('timeTracking.date', 'Datum')}
                  </Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-8 text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('timeTracking.hoursShort', 'Std.')}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    value={hoursPart}
                    onChange={(e) => setHoursPart(Math.max(0, Number(e.target.value) || 0))}
                    className="h-8 text-xs rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {t('timeTracking.minutesShort', 'Min.')}
                  </Label>
                  <select
                    className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold"
                    value={minutesPart}
                    onChange={(e) => setMinutesPart(Number(e.target.value) || 0)}
                  >
                    {[0, 15, 30, 45].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Switch checked={sonderzahlung} onCheckedChange={setSonderzahlung} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-800 truncate">
                      {sonderzahlung
                        ? t('timeTracking.specialRate', 'Sonder-Stundensatz')
                        : t('timeTracking.standardRate', 'Standard-Stundensatz')}
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {formatEur(activeRate)} / Std.
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] font-black text-[#0B1F3A] tabular-nums">
                    {formatHoursDe(previewHours)} Std. · {formatEur(previewAmount)}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {t('timeTracking.note', 'Notiz')}
                </Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder={t(
                    'timeTracking.notePlaceholder',
                    'Was wurde erledigt? Meeting, Support, …',
                  )}
                  className="text-xs rounded-lg resize-none min-h-[56px]"
                />
              </div>

              <Button
                type="button"
                disabled={!canSubmit}
                className="w-full h-9 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"
                onClick={() => void handleSubmit()}
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : null}
                {t('timeTracking.saveEntry', 'Zeit erfassen')}
              </Button>
            </>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
          <Link
            to="/time-tracking"
            onClick={() => setOpen(false)}
            className="text-[11px] font-bold text-blue-700 hover:underline"
          >
            {t('timeTracking.viewMyTimes', 'Meine Zeiten ansehen →')}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
