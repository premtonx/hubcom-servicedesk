import { useState, useEffect, useMemo } from 'react';
import { vaultService } from '../../../services/vaultService';
import { VaultItem } from '../../../types';
import {
  Users,
  Mail,
  Phone,
  Plus,
  FileText,
  Key,
  Eye,
  EyeOff,
  Brain,
  Clock,
  Sparkles,
  Lock,
  Copy,
  Trash2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';
import { Contact, Ticket } from '../../../types';
import { CustomField } from '../../../services/schemaService';
import { cn } from '../../../lib/utils';
import {
  HydratedCompany,
  buildCompanyActivityEvents,
  deriveTicketInsights,
  formatDateDe,
  formatDateTimeDe,
  invitationStatusLabelDe,
} from './utils';
import { toast } from 'sonner';
import axios from 'axios';
import { useTranslation } from '../../../lib/context/I18nContext';

interface CompanyOtherTabsProps {
  activeSubTab: string;
  company: HydratedCompany;
  employees: Contact[];
  contactSchema: CustomField[];
  ticketHistory: Ticket[];
  onAddContactClick: () => void;
  onSelectTicket?: (id: string) => void;
  onCompanyUpdated?: (patch: Partial<HydratedCompany>) => void;
  onVaultItemsChange?: (items: VaultItem[]) => void;
}

export default function CompanyOtherTabs({
  activeSubTab,
  company,
  employees,
  contactSchema,
  ticketHistory,
  onAddContactClick,
  onSelectTicket,
  onCompanyUpdated,
  onVaultItemsChange,
}: CompanyOtherTabsProps) {
  const { t } = useTranslation();
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [companyVaultItems, setCompanyVaultItems] = useState<VaultItem[]>([]);
  type OrgVaultSecretRow = {
    id: string;
    name: string;
    category: string;
    notes?: string | null;
    masked_value: string;
    client_visible: boolean;
    organization_id?: string | null;
  };
  const [orgVaultSecrets, setOrgVaultSecrets] = useState<OrgVaultSecretRow[]>([]);
  const [revealedOrgVault, setRevealedOrgVault] = useState<Record<string, string>>({});
  const [isAddingSecret, setIsAddingSecret] = useState(false);
  const [newSecretLabel, setNewSecretLabel] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [newSecretType, setNewSecretType] = useState('password');
  const [newSecretClientVisible, setNewSecretClientVisible] = useState(false);
  const [portalStatusByEmail, setPortalStatusByEmail] = useState<Record<string, string>>({});
  const [editingContract, setEditingContract] = useState(false);
  const [savingContract, setSavingContract] = useState(false);
  const [contractDraft, setContractDraft] = useState({
    contractPlan: company.contractPlan || '',
    contractReference: company.contractReference || '',
    contractSla: company.contractSla || '',
    contractTerm: company.contractTerm || '',
    contractRenewalDate: company.contractRenewalDate || '',
    monthlySpend: company.monthlySpend || '',
    contractNotes: company.contractNotes || '',
  });

  useEffect(() => {
    setContractDraft({
      contractPlan: company.contractPlan || '',
      contractReference: company.contractReference || '',
      contractSla: company.contractSla || '',
      contractTerm: company.contractTerm || '',
      contractRenewalDate: company.contractRenewalDate || '',
      monthlySpend: company.monthlySpend || '',
      contractNotes: company.contractNotes || '',
    });
  }, [company.id, company.hasContract, company.contractPlan, company.contractSla]);

  const orgId = company.organizationId || (company as any).organization_id || null;
  const companyScopeIds = useMemo(() => {
    const ids = new Set<string>([company.id]);
    if (orgId) ids.add(String(orgId));
    return ids;
  }, [company.id, orgId]);

  useEffect(() => {
    const unsub = vaultService.subscribeToHistory((items) => {
      const filtered = items.filter((item) => {
        const related = String(item.metadata?.relatedCompanyId || '');
        return related && companyScopeIds.has(related);
      });
      setCompanyVaultItems(filtered);
      onVaultItemsChange?.(filtered);
    });
    return () => unsub();
  }, [companyScopeIds, onVaultItemsChange]);

  const reloadOrgVault = async () => {
    if (!orgId) {
      setOrgVaultSecrets([]);
      return;
    }
    try {
      const res = await axios.get(
        `/api/admin/organizations/${encodeURIComponent(String(orgId))}/vault`,
        { withCredentials: true },
      );
      setOrgVaultSecrets(Array.isArray(res.data?.secrets) ? res.data.secrets : []);
    } catch {
      setOrgVaultSecrets([]);
    }
  };

  useEffect(() => {
    if (activeSubTab !== 'vault') return;
    void reloadOrgVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, activeSubTab]);

  useEffect(() => {
    if (!orgId || activeSubTab !== 'contacts') return;
    let cancelled = false;
    void axios
      .get(`/api/admin/organizations/${encodeURIComponent(String(orgId))}/users`, {
        withCredentials: true,
      })
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const u of (res.data?.users || []) as Array<Record<string, unknown>>) {
          const email = String(u.email || '')
            .trim()
            .toLowerCase();
          if (!email) continue;
          map[email] = String(u.invitationStatus || u.invitation_status || '');
        }
        setPortalStatusByEmail(map);
      })
      .catch(() => {
        if (!cancelled) setPortalStatusByEmail({});
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, activeSubTab, employees.length]);

  const handleCompanyAddSecret = async () => {
    if (!newSecretLabel.trim() || !newSecretValue.trim()) {
      toast.error(t('companies.vault.fillRequired', 'Bitte Bezeichnung und Geheimnis ausfüllen.'));
      return;
    }
    if (!orgId) {
      toast.error(
        t(
          'companies.vault.noOrg',
          'Kein verknüpftes Kunden-Portal Unternehmen — Tresor benötigt organizations.id.',
        ),
      );
      return;
    }
    try {
      setIsAddingSecret(true);
      await axios.post(
        `/api/admin/organizations/${encodeURIComponent(String(orgId))}/vault`,
        {
          name: newSecretLabel.trim(),
          category: newSecretType,
          value: newSecretValue,
          client_visible: newSecretClientVisible,
        },
        { withCredentials: true },
      );

      toast.success(t('companies.vault.registered', 'Geheimnis registriert.'));
      setNewSecretLabel('');
      setNewSecretValue('');
      setNewSecretClientVisible(false);
      await reloadOrgVault();
      setIsAddingSecret(false);
    } catch (err: any) {
      console.error(err);
      toast.error(
        err?.response?.data?.error ||
          t('companies.vault.registerFailed', 'Geheimnis konnte nicht gespeichert werden.'),
      );
      setIsAddingSecret(false);
    }
  };

  const toggleKeyReveal = (id: string) => {
    setRevealedKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const saveContract = async () => {
    if (!orgId) {
      toast.error(
        t(
          'companies.contract.noOrg',
          'Kein verknüpftes Unternehmen (Organization) — Vertrag kann nicht gespeichert werden.',
        ),
      );
      return;
    }
    setSavingContract(true);
    try {
      await axios.put(
        `/api/admin/organizations/${encodeURIComponent(String(orgId))}`,
        {
          name: company.name,
          tier: contractDraft.contractPlan || null,
          sla: contractDraft.contractSla || null,
          contract_renewal: contractDraft.contractRenewalDate || null,
          monthly_rate: contractDraft.monthlySpend || null,
          contract_reference: contractDraft.contractReference || null,
          contract_notes: contractDraft.contractNotes || null,
          contract_term: contractDraft.contractTerm || null,
        },
        { withCredentials: true },
      );
      onCompanyUpdated?.({
        contractPlan: contractDraft.contractPlan,
        contractSla: contractDraft.contractSla,
        contractRenewalDate: contractDraft.contractRenewalDate,
        monthlySpend: contractDraft.monthlySpend,
        contractReference: contractDraft.contractReference,
        contractNotes: contractDraft.contractNotes,
        contractTerm: contractDraft.contractTerm,
        tier: contractDraft.contractPlan,
        hasContract: Boolean(
          contractDraft.contractPlan ||
            contractDraft.contractSla ||
            contractDraft.contractRenewalDate ||
            contractDraft.monthlySpend ||
            contractDraft.contractReference ||
            contractDraft.contractTerm ||
            contractDraft.contractNotes,
        ),
      });
      setEditingContract(false);
      toast.success(t('companies.contract.saved', 'Vertrag gespeichert.'));
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error ||
          t('companies.contract.saveFailed', 'Vertrag konnte nicht gespeichert werden.'),
      );
    } finally {
      setSavingContract(false);
    }
  };

  if (activeSubTab === 'contacts') {
    return (
      <Card className="border border-muted-foreground/10 rounded-2xl bg-background overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2 bg-muted/10">
          <div>
            <CardTitle className="text-sm font-black text-foreground">
              {t('companies.contactsTitle', 'Kontakte & Mitarbeiter')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                'companies.contactsHint',
                'Primäre Ansprechpartner und operative Kontakte dieses Unternehmens.',
              )}
            </p>
          </div>
          <Button
            onClick={onAddContactClick}
            variant="outline"
            size="sm"
            className="rounded-xl font-bold text-xs h-9 px-4 border-muted-foreground/15 text-foreground hover:bg-muted"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('companies.addContact', 'Kontakt hinzufügen')}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  <th className="px-5 py-3.5">{t('companies.employee', 'Mitarbeiter')}</th>
                  <th className="px-5 py-3.5">{t('companies.directAccess', 'Direkter Kontakt')}</th>
                  <th className="px-5 py-3.5">{t('companies.customAttributes', 'Attribute')}</th>
                  <th className="px-5 py-3.5 text-center">{t('companies.status', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs">
                {employees.map((employee) => {
                  const meta = (employee.metadata || {}) as Record<string, unknown>;
                  const portalRole = meta.portalRole ? String(meta.portalRole) : null;
                  const emailKey = String(employee.email || '')
                    .trim()
                    .toLowerCase();
                  const liveStatus = portalStatusByEmail[emailKey];
                  const inviteStatus = liveStatus
                    ? liveStatus
                    : meta.invitationStatus
                      ? String(meta.invitationStatus)
                      : meta.syncedFromPortal
                        ? 'pending'
                        : null;
                  const statusLabel = invitationStatusLabelDe(inviteStatus);
                  const phone = employee.phoneWork || employee.phoneMobile || '';
                  return (
                    <tr key={employee.id} className="hover:bg-muted/10 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary/10 text-primary font-black flex items-center justify-center text-xs">
                            {employee.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-foreground text-sm leading-none">
                              {employee.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {employee.title || t('companies.contact', 'Kontakt')}
                            </p>
                            {portalRole ? (
                              <Badge className="mt-1.5 text-[9px] font-extrabold uppercase bg-indigo-50 text-indigo-700 border-indigo-100">
                                {portalRole}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col gap-1 text-muted-foreground font-semibold">
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 opacity-60" />
                            {employee.email || '—'}
                          </div>
                          {phone ? (
                            <div className="flex items-center gap-1.5 opacity-80">
                              <Phone className="w-3.5 h-3.5" />
                              {phone}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {contactSchema
                            .filter((f) => !f.system && employee.metadata?.[f.internalName])
                            .map((field) => (
                              <span
                                key={field.id}
                                className="text-[9px] font-extrabold bg-indigo-50 text-indigo-600 border border-indigo-150 px-2 py-0.5 rounded uppercase"
                              >
                                {field.label}: {String(employee.metadata?.[field.internalName])}
                              </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-center">
                        {statusLabel ? (
                          <Badge
                            className={cn(
                              'text-[9px] font-extrabold uppercase border',
                              inviteStatus === 'accepted' &&
                                'bg-emerald-50 text-emerald-700 border-emerald-100',
                              inviteStatus === 'sent' &&
                                'bg-sky-50 text-sky-700 border-sky-100',
                              inviteStatus === 'failed' &&
                                'bg-rose-50 text-rose-700 border-rose-100',
                              (inviteStatus === 'pending' || inviteStatus === 'expired') &&
                                'bg-amber-50 text-amber-800 border-amber-100',
                            )}
                          >
                            {statusLabel}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {employees.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-5 py-12 text-center text-muted-foreground italic font-semibold"
                    >
                      {t(
                        'companies.noContacts',
                        'Noch keine Kontakte für dieses Unternehmen.',
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeSubTab === 'tickets') {
    return (
      <Card className="border border-muted-foreground/10 rounded-2xl bg-background overflow-hidden">
        <CardHeader className="pb-2 bg-muted/10">
          <CardTitle className="text-sm font-black text-foreground">
            {t('companies.ticketsTitle', 'Tickets')}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(
              'companies.ticketsHint',
              'Support-Tickets, die diesem Unternehmen zugeordnet sind.',
            )}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  <th className="px-5 py-3.5 text-center">ID</th>
                  <th className="px-5 py-3.5">{t('companies.subject', 'Betreff')}</th>
                  <th className="px-5 py-3.5">{t('companies.priority', 'Priorität')}</th>
                  <th className="px-5 py-3.5">{t('companies.status', 'Status')}</th>
                  <th className="px-5 py-3.5">{t('companies.requester', 'Anfragender')}</th>
                  <th className="px-5 py-3.5">{t('companies.date', 'Datum')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 text-xs text-foreground font-semibold">
                {ticketHistory.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => onSelectTicket?.(ticket.id)}
                    className="hover:bg-muted/10 transition-colors cursor-pointer select-none"
                  >
                    <td className="px-5 py-3.5 font-mono text-muted-foreground text-center">
                      #{ticket.id}
                    </td>
                    <td className="px-5 py-3.5 max-w-sm truncate font-black text-foreground">
                      {ticket.subject}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={cn(
                          'text-[9px] font-black px-2 py-0.5 rounded uppercase',
                          ticket.priority === 'urgent' && 'bg-rose-500/10 text-rose-500',
                          ticket.priority === 'high' && 'bg-amber-500/10 text-amber-500',
                          ticket.priority === 'medium' && 'bg-blue-500/10 text-blue-500',
                          ticket.priority === 'low' && 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={cn(
                          'text-[9px] font-black px-2 py-0.5 rounded uppercase',
                          ticket.status === 'open' && 'bg-emerald-500/10 text-emerald-500',
                          ticket.status === 'pending' && 'bg-amber-500/10 text-amber-500',
                          ticket.status === 'resolved' && 'bg-slate-100 text-slate-500',
                          ticket.status === 'closed' && 'bg-slate-200 text-slate-600',
                        )}
                      >
                        {ticket.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground font-bold">
                      {ticket.customerName || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">
                      {ticket.createdAt?.toDate
                        ? formatDateDe(ticket.createdAt.toDate())
                        : formatDateDe(ticket.createdAt as any) || '—'}
                    </td>
                  </tr>
                ))}
                {ticketHistory.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center text-muted-foreground italic font-semibold"
                    >
                      {t(
                        'companies.noTicketsForCompany',
                        'Noch keine Tickets für dieses Unternehmen.',
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (activeSubTab === 'assets') {
    return (
      <Card className="border border-muted-foreground/10 rounded-2xl bg-background">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-black text-foreground">
              {t('companies.assetOverview', 'Asset-Übersicht')}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                'companies.assetsHint',
                'Verwaltete Geräte und Anwendungen dieses Unternehmens.',
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl font-bold text-xs h-9"
            onClick={() =>
              toast.info(
                t(
                  'companies.assetsAddSoon',
                  'Asset-Erfassung wird über die Inventar-Integration bereitgestellt.',
                ),
              )
            }
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('companies.addAsset', 'Asset hinzufügen')}
          </Button>
        </CardHeader>
        <CardContent>
          <p className="py-12 text-center text-sm text-muted-foreground font-semibold">
            {t('companies.noAssetsLinked', 'Noch keine Assets verknüpft.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (activeSubTab === 'contracts') {
    return (
      <div className="space-y-6">
        <Card className="border border-muted-foreground/10 rounded-2xl bg-background max-w-4xl">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-sm font-black text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              {t('companies.supportContract', 'Support-Vertrag')}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl font-bold text-xs h-9"
              onClick={() => setEditingContract((v) => !v)}
            >
              {editingContract
                ? t('common.cancel', 'Abbrechen')
                : t('companies.editContract', 'Vertrag bearbeiten')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {!company.hasContract && !editingContract ? (
              <div className="rounded-xl border border-dashed border-muted p-8 text-center space-y-3">
                <p className="text-sm font-bold text-foreground">
                  {t('companies.noContract', 'Kein Vertrag hinterlegt')}
                </p>
                <p className="text-xs text-muted-foreground font-semibold">
                  {t(
                    'companies.noContractHint',
                    'Tarif, SLA und Verlängerungsdatum können hier hinterlegt werden.',
                  )}
                </p>
                <Button
                  size="sm"
                  className="rounded-xl font-bold text-xs"
                  onClick={() => setEditingContract(true)}
                >
                  {t('companies.configureContract', 'Vertrag konfigurieren')}
                </Button>
              </div>
            ) : editingContract ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(
                  [
                    ['contractPlan', 'Tarif'],
                    ['contractReference', 'Vertragsreferenz'],
                    ['contractSla', 'SLA-Reaktionszeit'],
                    ['contractTerm', 'Laufzeit'],
                    ['contractRenewalDate', 'Verlängerungsdatum'],
                    ['monthlySpend', 'Monatlicher Betrag'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                      {label}
                    </Label>
                    <Input
                      value={contractDraft[key]}
                      onChange={(e) =>
                        setContractDraft((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="h-9 rounded-xl text-xs"
                      autoComplete="off"
                    />
                  </div>
                ))}
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase text-muted-foreground">
                    Notizen
                  </Label>
                  <Textarea
                    value={contractDraft.contractNotes}
                    onChange={(e) =>
                      setContractDraft((prev) => ({
                        ...prev,
                        contractNotes: e.target.value,
                      }))
                    }
                    className="min-h-[90px] rounded-xl text-xs"
                    autoComplete="off"
                  />
                </div>
                <div className="md:col-span-2">
                  <Button
                    onClick={() => void saveContract()}
                    disabled={savingContract}
                    className="rounded-xl font-bold text-xs"
                  >
                    {savingContract
                      ? t('common.saving', 'Speichern…')
                      : t('common.save', 'Speichern')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs font-semibold">
                {[
                  ['Tarif', company.contractPlan],
                  ['Vertragsreferenz', company.contractReference],
                  ['SLA-Reaktionszeit', company.contractSla],
                  ['Laufzeit', company.contractTerm],
                  ['Verlängerungsdatum', company.contractRenewalDate],
                  ['Monatlicher Betrag', company.monthlySpend],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between border-b pb-1 gap-4">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground font-bold text-right">{value || '—'}</span>
                  </div>
                ))}
                {company.contractNotes ? (
                  <div className="md:col-span-2 pt-2">
                    <p className="text-muted-foreground mb-1">Notizen</p>
                    <p className="text-foreground font-semibold whitespace-pre-wrap">
                      {company.contractNotes}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeSubTab === 'vault') {
    const revealOrgSecret = async (id: string, purpose: 'reveal' | 'copy' = 'reveal') => {
      if (!orgId) return;
      try {
        const res = await axios.post(
          `/api/admin/organizations/${encodeURIComponent(String(orgId))}/vault/${encodeURIComponent(id)}/reveal`,
          { purpose },
          { withCredentials: true },
        );
        const value = String(res.data?.value || '');
        if (purpose === 'copy') {
          await navigator.clipboard.writeText(value);
          toast.success(t('companies.vault.copied', 'In Zwischenablage kopiert.'));
        } else {
          setRevealedOrgVault((prev) => ({ ...prev, [id]: value }));
        }
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Anzeigen fehlgeschlagen.');
      }
    };

    const toggleClientVisible = async (secret: OrgVaultSecretRow) => {
      if (!orgId) return;
      try {
        await axios.patch(
          `/api/admin/organizations/${encodeURIComponent(String(orgId))}/vault/${encodeURIComponent(secret.id)}`,
          { client_visible: !secret.client_visible },
          { withCredentials: true },
        );
        toast.success(
          !secret.client_visible
            ? t('companies.vault.sharedPortal', 'Für Kunden-Portal freigegeben.')
            : t('companies.vault.hubcomOnly', 'Nur noch für Hubcom sichtbar.'),
        );
        await reloadOrgVault();
      } catch (err: any) {
        toast.error(err?.response?.data?.error || 'Sichtbarkeit konnte nicht geändert werden.');
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-muted/20 border border-muted-foreground/10 p-5 rounded-2xl gap-4">
          <div>
            <h3 className="font-sans font-bold text-sm text-foreground flex items-center gap-1.5">
              <Lock className="w-4.5 h-4.5 text-primary" />
              {t('companies.vaultTitle', 'Tresor')} — {company.name}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t(
                'companies.vaultHint',
                'AES-256-GCM · Standard „Nur Hubcom“. Freigabe fürs Kunden-Portal explizit setzen.',
              )}
            </p>
          </div>
          <Badge className="bg-primary/10 text-primary border-none text-[10px] font-bold uppercase tracking-widest px-3 h-6">
            {orgVaultSecrets.length}{' '}
            {t('companies.records', 'Einträge')}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card className="border border-muted-foreground/10 rounded-2xl bg-background overflow-hidden">
              <CardHeader className="bg-muted/10 pb-3">
                <span className="text-xs font-black uppercase text-foreground">
                  {t('companies.secretsRegistry', 'Geheimnis-Register')}
                </span>
              </CardHeader>
              <CardContent className="p-0">
                {!orgId ? (
                  <p className="px-5 py-12 text-center text-xs text-muted-foreground font-semibold">
                    {t(
                      'companies.vault.needOrg',
                      'Bitte zuerst ein Kunden-Portal Unternehmen verknüpfen.',
                    )}
                  </p>
                ) : orgVaultSecrets.length === 0 ? (
                  <p className="px-5 py-12 text-center text-xs text-muted-foreground font-semibold">
                    {t(
                      'companies.noVaultEntries',
                      'Noch keine Tresor-Einträge für dieses Unternehmen.',
                    )}
                  </p>
                ) : (
                  <div className="overflow-x-auto text-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-muted/20 border-b text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                          <th className="px-5 py-3.5">
                            {t('companies.recordId', 'Bezeichnung')}
                          </th>
                          <th className="px-5 py-3.5">{t('companies.type', 'Typ')}</th>
                          <th className="px-5 py-3.5">{t('companies.visibility', 'Sichtbarkeit')}</th>
                          <th className="px-5 py-3.5 text-right">
                            {t('companies.actions', 'Aktionen')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50 text-foreground font-semibold">
                        {orgVaultSecrets.map((item) => {
                          const display = revealedOrgVault[item.id] || item.masked_value;
                          return (
                            <tr key={item.id} className="hover:bg-muted/5">
                              <td className="px-5 py-3.5 font-bold max-w-[200px] truncate">
                                {item.name}
                              </td>
                              <td className="px-5 py-3.5">
                                <Badge
                                  variant="outline"
                                  className="text-[9px] border-none font-bold bg-muted uppercase px-2"
                                >
                                  {item.category}
                                </Badge>
                              </td>
                              <td className="px-5 py-3.5">
                                <button
                                  type="button"
                                  onClick={() => void toggleClientVisible(item)}
                                  className="inline-flex"
                                  title={t(
                                    'companies.vault.toggleVisible',
                                    'Für Kunden-Portal freigeben / Nur Hubcom',
                                  )}
                                >
                                  <Badge
                                    className={cn(
                                      'text-[9px] border-none font-bold uppercase px-2 cursor-pointer',
                                      item.client_visible
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-600',
                                    )}
                                  >
                                    {item.client_visible
                                      ? t('companies.vault.badgePortal', 'Im Kunden-Portal sichtbar')
                                      : t('companies.vault.badgeHubcom', 'Nur Hubcom')}
                                  </Badge>
                                </button>
                              </td>
                              <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                <div className="flex justify-end gap-1 items-center">
                                  <span className="font-mono text-[10px] text-muted-foreground mr-1 max-w-[100px] truncate">
                                    {display}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() =>
                                      revealedOrgVault[item.id]
                                        ? setRevealedOrgVault((prev) => {
                                            const next = { ...prev };
                                            delete next[item.id];
                                            return next;
                                          })
                                        : void revealOrgSecret(item.id, 'reveal')
                                    }
                                  >
                                    {revealedOrgVault[item.id] ? (
                                      <EyeOff className="w-3.5 h-3.5" />
                                    ) : (
                                      <Eye className="w-3.5 h-3.5" />
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-[#1A73E8]"
                                    onClick={() => void revealOrgSecret(item.id, 'copy')}
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-red-500"
                                    onClick={async () => {
                                      if (!orgId) return;
                                      await axios.delete(
                                        `/api/admin/organizations/${encodeURIComponent(String(orgId))}/vault/${encodeURIComponent(item.id)}`,
                                        { withCredentials: true },
                                      );
                                      toast.success(
                                        t('companies.vault.deleted', 'Eintrag gelöscht.'),
                                      );
                                      await reloadOrgVault();
                                    }}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border border-muted-foreground/10 rounded-2xl bg-background shadow-xs">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-xs font-black uppercase text-foreground flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-primary" />
                {t('companies.registerSecret', 'Geheimnis registrieren')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4 text-xs">
              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">
                  {t('companies.recordName', 'Bezeichnung')}
                </label>
                <Input
                  placeholder={t('companies.secretNamePlaceholder', 'z. B. VPN-Zugang')}
                  value={newSecretLabel}
                  onChange={(e) => setNewSecretLabel(e.target.value)}
                  className="h-9 mt-1 bg-muted/20 text-xs font-semibold rounded-xl"
                  autoComplete="off"
                  name="company-secret-label"
                />
              </div>
              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">
                  {t('companies.secretType', 'Geheimnistyp')}
                </label>
                <select
                  value={newSecretType}
                  onChange={(e) => setNewSecretType(e.target.value)}
                  className="w-full h-9 px-2 mt-1 bg-muted/20 border border-muted-foreground/10 rounded-xl text-xs font-bold cursor-pointer"
                  autoComplete="off"
                >
                  <option value="password">Passwort</option>
                  <option value="api_key">API-Schlüssel</option>
                  <option value="certificate">Zertifikat</option>
                  <option value="license">Lizenz</option>
                  <option value="note">Notiz</option>
                </select>
              </div>
              <div>
                <label className="text-[9.5px] font-black uppercase text-slate-400">
                  {t('companies.secretValue', 'Geheimniswert')}
                </label>
                <Input
                  type="password"
                  placeholder={t('companies.secretValuePlaceholder', 'Wert eingeben…')}
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  className="h-9 mt-1 bg-muted/20 text-xs font-semibold rounded-xl"
                  autoComplete="new-password"
                  name="company-secret-value"
                />
              </div>
              <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-muted-foreground/10 bg-muted/10 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={newSecretClientVisible}
                  onChange={(e) => setNewSecretClientVisible(e.target.checked)}
                />
                <span>
                  <span className="block text-[11px] font-black text-foreground">
                    {t('companies.vault.sharePortal', 'Für Kunden-Portal freigeben')}
                  </span>
                  <span className="block text-[10px] text-muted-foreground font-semibold mt-0.5">
                    {t(
                      'companies.vault.sharePortalHint',
                      'Standard: Nur Hubcom. Aktivieren, damit CLIENT_ADMIN/SUPPORTER den Eintrag sehen.',
                    )}
                  </span>
                </span>
              </label>
              <Button
                onClick={handleCompanyAddSecret}
                disabled={isAddingSecret || !orgId}
                className="w-full bg-primary hover:bg-primary/95 text-white h-9 rounded-xl font-bold"
              >
                {isAddingSecret
                  ? t('companies.vault.locking', 'Speichern…')
                  : t('companies.vault.register', 'Geheimnis registrieren')}
              </Button>
              <div className="flex gap-2 items-center text-[10px] text-primary font-bold bg-[#E8F0FE] p-1.5 px-3 rounded-lg w-full">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t('companies.vault.scoped', 'AES-256-GCM · organization_id gebunden')}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (activeSubTab === 'insights') {
    const insights = deriveTicketInsights(ticketHistory);
    const hasData = Boolean(insights.topCategory || insights.automationHint);

    return (
      <div className="space-y-6">
        {!hasData ? (
          <Card className="border border-muted-foreground/10 rounded-2xl bg-background max-w-3xl">
            <CardContent className="py-12 text-center space-y-2">
              <Brain className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-bold text-foreground">
                {t('companies.aiInsights', 'KI-Erkenntnisse')}
              </p>
              <p className="text-xs text-muted-foreground font-semibold max-w-md mx-auto">
                {t(
                  'companies.aiEmpty',
                  'Noch keine KI-Erkenntnisse — benötigt aktive Tickets und konfigurierte KI.',
                )}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border border-indigo-500/20 rounded-2xl">
              <CardHeader>
                <CardTitle className="text-sm font-black text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  {t('companies.issueDetection', 'Themen-Erkennung')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs font-semibold">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">
                    {t('companies.topIssueCategory', 'Häufigste Kategorie')}
                  </span>
                  <span className="font-extrabold">{insights.topCategory || '—'}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">
                    {t('companies.openTickets', 'Offene Tickets')}
                  </span>
                  <span className="font-extrabold">{insights.openCount}</span>
                </div>
                {insights.automationHint ? (
                  <p className="text-indigo-700 font-bold leading-relaxed">
                    {insights.automationHint}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <Card className="border border-muted rounded-2xl">
              <CardHeader>
                <CardTitle className="text-sm font-black text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                  <Users className="w-4 h-4 text-primary" />
                  {t('companies.ticketVolume', 'Ticketvolumen')}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs font-semibold text-muted-foreground">
                {t('companies.ticketVolumeDesc', 'Aus {{count}} Tickets dieses Unternehmens berechnet.').replace(
                  '{{count}}',
                  String(ticketHistory.length),
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  if (activeSubTab === 'activity') {
    const events = buildCompanyActivityEvents({
      company,
      tickets: ticketHistory,
      vaultItems: companyVaultItems,
    });

    return (
      <Card className="border border-muted-foreground/10 rounded-2xl bg-background max-w-4xl">
        <CardHeader className="pb-2 bg-muted/10">
          <CardTitle className="text-sm font-black text-foreground flex items-center gap-1.5 uppercase tracking-wider">
            <Clock className="w-4 h-4 text-purple-500" />
            {t('companies.activityTimeline', 'Aktivitätschronik')}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t(
              'companies.activityHint',
              'Chronologische Ereignisse zu Tickets, Tresor und Unternehmensanlage.',
            )}
          </p>
        </CardHeader>
        <CardContent className="p-6">
          {events.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground font-semibold">
              {t('companies.noActivity', 'Noch keine Aktivitäten protokolliert.')}
            </p>
          ) : (
            <div className="relative pl-6 border-l-2 border-slate-200/80 space-y-6">
              {events.map((ev, idx) => (
                <div key={`${ev.title}-${idx}`} className="relative">
                  <div
                    className={cn(
                      'absolute -left-[32px] top-1.5 h-4 w-4 rounded-full border-4 border-background',
                      ev.color || 'bg-primary',
                    )}
                  />
                  <span className="text-[10px] text-muted-foreground font-bold">{ev.time}</span>
                  <h4 className="text-sm font-black text-foreground mt-0.5">{ev.title}</h4>
                  <p className="text-xs text-muted-foreground/90 mt-1 font-semibold leading-relaxed max-w-3xl">
                    {ev.desc}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="py-12 text-center text-sm text-muted-foreground font-semibold italic">
      {t('companies.viewUnderConstruction', 'Ansicht in Vorbereitung.')}
    </div>
  );
}
