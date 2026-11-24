import { useEffect, useMemo, useState } from 'react';
import { Building2, Globe, FileText } from 'lucide-react';
import { Ticket as TicketType, Company, Contact } from '../../types';
import { CustomField } from '../../services/schemaService';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useTranslation } from '../../lib/context/I18nContext';
import { getInitials, safeString } from '../../lib/utils';
import { customerService } from '../../services/customerService';
import axios from 'axios';
import { toast } from 'sonner';

interface CustomerTabContentProps {
  ticket: TicketType;
  contact: Contact | null;
  company: Company | null;
  contactSchema: CustomField[];
  allTickets: TicketType[];
  onUpdateTicket?: (data: Partial<TicketType>) => void;
}

type OrgContract = {
  name: string;
  tier: string | null;
  sla: string | null;
  contract_renewal: string | null;
  monthly_rate: string | null;
  website: string | null;
  domain: string | null;
};

type PersonOption = {
  id: string;
  name: string;
  email: string;
  userId?: string;
};

function resolveCustomerEmail(ticket: TicketType, contact: Contact | null): string {
  const fromContact = String(contact?.email || '').trim();
  if (fromContact) return fromContact;
  const fromTicket = String((ticket as any).customerEmail || '').trim();
  if (fromTicket && fromTicket !== '@domain.com') return fromTicket;
  const customerId = String(ticket.customerId || '').trim();
  if (customerId.includes('@') && !customerId.endsWith('@domain.com')) return customerId;
  return '';
}

export function CustomerTabContent({
  ticket,
  contact,
  company,
  contactSchema,
  allTickets,
  onUpdateTicket,
}: CustomerTabContentProps) {
  const { t } = useTranslation();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [orgContract, setOrgContract] = useState<OrgContract | null>(null);
  const [saving, setSaving] = useState(false);

  const customerEmail = resolveCustomerEmail(ticket, contact);
  const customerName = safeString(contact?.name ?? ticket.customerName);
  const hasPerson = Boolean(customerName || customerEmail || ticket.requesterId || ticket.contactId);
  const kundenId =
    String(ticket.requesterId || ticket.customerId || ticket.contactId || '').trim() || null;

  const personalHistory = useMemo(() => {
    const key = String(ticket.requesterId || ticket.customerId || ticket.customerEmail || '');
    if (!key) return [];
    return allTickets.filter((tkt) => {
      if (tkt.id === ticket.id) return false;
      return (
        tkt.requesterId === key ||
        tkt.customerId === key ||
        (tkt as any).customerEmail === key
      );
    });
  }, [allTickets, ticket]);

  useEffect(() => {
    return customerService.subscribeToCompanies(setCompanies);
  }, []);

  const orgId = String(
    ticket.organizationId ||
      (ticket as any).organization_id ||
      (company as any)?.organizationId ||
      (company as any)?.organization_id ||
      '',
  ).trim();

  useEffect(() => {
    if (!orgId) {
      setOrgContract(null);
      return;
    }
    let cancelled = false;
    void axios
      .get(`/api/admin/organizations/${encodeURIComponent(orgId)}`, { withCredentials: true })
      .then((res) => {
        if (cancelled) return;
        const org = res.data?.organization;
        if (!org) {
          setOrgContract(null);
          return;
        }
        setOrgContract({
          name: String(org.name || ''),
          tier: org.tier || null,
          sla: org.sla || null,
          contract_renewal: org.contract_renewal || null,
          monthly_rate: org.monthly_rate || null,
          website: org.website || null,
          domain: org.domain || null,
        });
      })
      .catch(() => {
        if (!cancelled) setOrgContract(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    const companyId = ticket.companyId;
    if (!companyId) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const unsub = customerService.subscribeToContacts(companyId, (rows) => {
      if (cancelled) return;
      const base: PersonOption[] = rows
        .filter((c) => c.email)
        .map((c) => ({ id: c.id, name: c.name || c.email, email: c.email }));
      setPeople(base);
    });

    if (orgId) {
      void axios
        .get(`/api/admin/organizations/${encodeURIComponent(orgId)}/users`, {
          withCredentials: true,
        })
        .then((res) => {
          if (cancelled) return;
          const users = (res.data?.users || []) as Array<Record<string, unknown>>;
          setPeople((prev) => {
            const byEmail = new Map(prev.map((p) => [p.email.toLowerCase(), p]));
            for (const u of users) {
              const email = String(u.email || '').trim();
              if (!email) continue;
              const key = email.toLowerCase();
              const existing = byEmail.get(key);
              byEmail.set(key, {
                id: existing?.id || `portal:${String(u.id)}`,
                name: String(u.name || email),
                email,
                userId: String(u.id || ''),
              });
            }
            return Array.from(byEmail.values());
          });
        })
        .catch(() => {
          /* keep contacts */
        });
    }

    return () => {
      cancelled = true;
      unsub();
    };
  }, [ticket.companyId, orgId]);

  const orgDisplayName =
    orgContract?.name || company?.name || ticket.company || null;
  const hasContract = Boolean(
    orgContract?.tier ||
      orgContract?.sla ||
      orgContract?.contract_renewal ||
      orgContract?.monthly_rate ||
      (company as any)?.contractPlan ||
      (company as any)?.contractSla ||
      (company as any)?.tier,
  );

  const assignCompany = async (companyId: string) => {
    if (!onUpdateTicket) return;
    setSaving(true);
    try {
      const nextCompany = companies.find((c) => c.id === companyId) || null;
      const nextOrgId = String(
        (nextCompany as any)?.organizationId ||
          (nextCompany as any)?.organization_id ||
          '',
      ).trim();
      onUpdateTicket({
        companyId,
        company: nextCompany?.name || '',
        organizationId: nextOrgId || null,
        organization_id: nextOrgId || null,
        contactId: '',
        customerName: '',
        customerId: '',
        customerEmail: '',
        requesterId: null,
        requester_id: null,
      } as any);
      toast.success(t('tickets.customerTab.companyUpdated', 'Unternehmen aktualisiert.'));
    } finally {
      setSaving(false);
    }
  };

  const assignPerson = async (personId: string) => {
    if (!onUpdateTicket) return;
    const person = people.find((p) => p.id === personId);
    if (!person) return;
    setSaving(true);
    try {
      onUpdateTicket({
        contactId: person.id.startsWith('portal:') ? undefined : person.id,
        customerName: person.name,
        customerEmail: person.email,
        customerId: person.userId || person.id,
        requesterId: person.userId || null,
        requester_id: person.userId || null,
      } as any);
      toast.success(t('tickets.customerTab.contactUpdated', 'Kontaktperson aktualisiert.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="customer-tab-view" className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <Card className="border-border rounded-2xl shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary text-lg font-black shrink-0 shadow-sm border">
                  {hasPerson ? getInitials(customerName || customerEmail || '?') : '—'}
                </div>
                <div className="min-w-0">
                  {hasPerson ? (
                    <>
                      <h3 className="text-base font-bold text-foreground">
                        {customerName || t('tickets.customerTab.unnamedContact', 'Unbenannter Kontakt')}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {customerEmail || '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {t('tickets.customerTab.customerId', 'Kunden-ID')}:{' '}
                        <span className="font-mono tabular-nums font-semibold text-slate-600">
                          {kundenId || '—'}
                        </span>
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-base font-bold text-foreground">
                        {t(
                          'tickets.customerTab.noContactAssigned',
                          'Keine Kontaktperson zugewiesen',
                        )}
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t(
                          'tickets.customerTab.noContactHint',
                          'Weisen Sie unten eine Kontaktperson zu, damit Antworten und Portal-Sichtbarkeit greifen.',
                        )}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {onUpdateTicket ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-border/60">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      {t('tickets.customerTab.company', 'Unternehmen')}
                    </Label>
                    <Select
                      value={ticket.companyId || undefined}
                      onValueChange={(v) => void assignCompany(v)}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-9 rounded-xl text-xs">
                        <SelectValue
                          placeholder={t(
                            'tickets.customerTab.selectCompany',
                            'Unternehmen wählen…',
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {companies.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      {t('tickets.customerTab.contact', 'Kontaktperson')}
                    </Label>
                    <Select
                      value={
                        ticket.contactId ||
                        (ticket.requesterId ? `portal:${ticket.requesterId}` : undefined)
                      }
                      onValueChange={(v) => void assignPerson(v)}
                      disabled={saving || !ticket.companyId}
                    >
                      <SelectTrigger className="h-9 rounded-xl text-xs">
                        <SelectValue
                          placeholder={
                            ticket.companyId
                              ? t('tickets.customerTab.selectContact', 'Kontakt wählen…')
                              : t(
                                  'tickets.customerTab.selectCompanyFirst',
                                  'Zuerst Unternehmen wählen',
                                )
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {people.length === 0 ? (
                          <SelectItem value="__empty" disabled className="text-xs">
                            {t('tickets.customerTab.noPeople', 'Keine Kontakte vorhanden')}
                          </SelectItem>
                        ) : (
                          people.map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-xs">
                              {p.name} ({p.email})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              <Separator />

              <div className="space-y-3">
                <h4 className="text-[10.5px] font-black uppercase tracking-wider text-muted-foreground">
                  {t('tickets.customerTab.adminMetaFields', 'Administrative Metafelder')}
                </h4>
                {contactSchema.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {contactSchema.map((field) => {
                      const value =
                        contact?.metadata?.[field.internalName] ||
                        t('tickets.customerTab.notConfigured', 'Nicht konfiguriert');
                      return (
                        <div
                          key={field.id}
                          className="p-2.5 bg-muted/30 border border-border/80 rounded-xl space-y-1"
                        >
                          <label className="text-[9.5px] font-black text-muted-foreground uppercase">
                            {field.label}
                          </label>
                          <p className="text-xs font-semibold text-foreground truncate">
                            {String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    {t(
                      'tickets.customerTab.noCustomMetadata',
                      'Keine benutzerdefinierten Metadaten für diesen Kontakt.',
                    )}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border rounded-2xl shadow-sm">
            <CardContent className="p-6 space-y-4">
              <h4 className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                {t('tickets.customerTab.clientHistory', 'Kundenhistorie')}
              </h4>
              <div className="space-y-3">
                {personalHistory.length > 0 ? (
                  personalHistory.map((hist) => (
                    <div
                      key={hist.id}
                      className="p-3 bg-card border border-border rounded-xl flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-primary block truncate">
                          {hist.subject}
                        </span>
                        <span className="text-[9.5px] text-muted-foreground">
                          ID: #{hist.id.slice(-5).toUpperCase()} •{' '}
                          {t('tickets.customerTab.statusLabel', 'Status')}:{' '}
                          <span className="font-bold">{hist.status}</span>
                        </span>
                      </div>
                      <Badge className="bg-slate-50 text-slate-605 border text-[8.5px] h-4.5 px-1.5 font-bold shrink-0">
                        {hist.createdAt?.toDate
                          ? hist.createdAt.toDate().toLocaleDateString('de-DE')
                          : '—'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="p-4 rounded-xl border border-dashed text-center py-8 text-xs text-muted-foreground italic">
                    {t(
                      'tickets.customerTab.noLegacyCases',
                      'Keine weiteren Tickets für diesen Kontakt.',
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Card className="border-border rounded-2xl shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-500" />
                  <h3 className="text-sm font-bold text-foreground">
                    {t('tickets.customerTab.organization', 'Organisation')}
                  </h3>
                </div>
                {orgContract?.tier || (company as any)?.tier ? (
                  <Badge className="bg-slate-100 text-slate-700 text-[9.5px] font-black uppercase">
                    {orgContract?.tier || (company as any)?.tier}
                  </Badge>
                ) : null}
              </div>

              {!orgDisplayName ? (
                <p className="text-xs text-muted-foreground font-semibold">
                  {t(
                    'tickets.customerTab.noOrganization',
                    'Kein Unternehmen mit diesem Ticket verknüpft.',
                  )}
                </p>
              ) : (
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center text-xs gap-3">
                    <span className="text-muted-foreground">
                      {t('tickets.customerTab.companyName', 'Unternehmen')}:
                    </span>
                    <span className="font-bold text-foreground text-right">{orgDisplayName}</span>
                  </div>
                  <Separator className="bg-border/40" />
                  <div className="flex justify-between items-center text-xs gap-3">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5" />{' '}
                      {t('tickets.customerTab.domainWebsite', 'Website / Domain')}:
                    </span>
                    <span className="font-semibold text-foreground truncate text-right">
                      {orgContract?.website ||
                        orgContract?.domain ||
                        company?.website ||
                        company?.domain ||
                        '—'}
                    </span>
                  </div>
                </div>
              )}

              {hasContract ? (
                <div className="p-3 bg-emerald-50/40 border border-emerald-150 rounded-xl space-y-2">
                  <h5 className="text-[10px] uppercase font-black text-emerald-800 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    {t('tickets.customerTab.supportContract', 'Support-Vertrag')}
                  </h5>
                  <div className="grid grid-cols-1 gap-1.5 text-xs text-emerald-900 font-semibold">
                    <div className="flex justify-between gap-2">
                      <span className="text-emerald-800/70">{t('tickets.customerTab.plan', 'Tarif')}</span>
                      <span>
                        {orgContract?.tier ||
                          (company as any)?.contractPlan ||
                          (company as any)?.tier ||
                          '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-emerald-800/70">SLA</span>
                      <span>
                        {orgContract?.sla || (company as any)?.contractSla || '—'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-emerald-800/70">
                        {t('tickets.customerTab.renewal', 'Verlängerung')}
                      </span>
                      <span>
                        {orgContract?.contract_renewal ||
                          (company as any)?.contractRenewalDate ||
                          '—'}
                      </span>
                    </div>
                    {(orgContract?.monthly_rate || (company as any)?.monthlySpend) && (
                      <div className="flex justify-between gap-2">
                        <span className="text-emerald-800/70">
                          {t('tickets.customerTab.monthlyRate', 'Monatliche Rate')}
                        </span>
                        <span>
                          {orgContract?.monthly_rate || (company as any)?.monthlySpend}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-muted/30 border border-dashed rounded-xl space-y-2">
                  <p className="text-xs font-bold text-foreground">
                    {t('tickets.customerTab.noContract', 'Kein Vertrag hinterlegt')}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-semibold">
                    {t(
                      'tickets.customerTab.noContractHint',
                      'Tarif und SLA können im Admin-Hub unter Kunden konfiguriert werden.',
                    )}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
