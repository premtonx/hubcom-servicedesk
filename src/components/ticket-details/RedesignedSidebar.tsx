import React, { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { 
  Sparkles, 
  ChevronDown, 
  ChevronUp, 
  Settings2, 
  Building2, 
  Tag, 
  Link2, 
  Unlink, 
  Plus,
  UserCheck,
  UserPlus,
  X,
  Clock3,
  Search,
  ListTodo,
} from 'lucide-react';
import { Ticket as TicketType, Company, Contact } from '../../types';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { SuggestedLink } from '../../services/neuralLinkService';
import { useTranslation } from '../../lib/context/I18nContext';
import { getInitials, safeString, cn } from '../../lib/utils';
import { TICKET_DISPATCH_AGENTS } from '../../lib/ticketDispatchAgents';
import {
  buildAssigneePayload,
  clearAssigneePayload,
  resolveTicketAssignee,
  scalarAssigneeId,
} from '../../lib/ticketAssignee';
import { useAuth } from '../../lib/hooks';
import { isReadonlyTerminalStatus } from '../../lib/ticket-status';
import { useTicketCategories } from '../../hooks/useTicketCategories';
import { useTicketStatuses } from '../../hooks/useTicketStatuses';
import { useTicketPriorities } from '../../hooks/useTicketPriorities';
import {
  TicketStatusChip,
  TicketPriorityChip,
  TicketCategoryChip,
} from '../tickets/TicketTableCells';
import { CustomerOrgAvatar, resolveTicketOrgLogo } from '../tickets/CustomerOrgAvatar';
import { customerService } from '../../services/customerService';
import { userService } from '../../services/userService';
import type {
  PortalTicketWorkspaceMeta,
  TicketDetailWorkbenchCapabilities,
} from '../../lib/tickets/ticket-detail-workbench-adapter';
import type { TicketStatusConfig, TicketPriorityConfig } from '../../lib/ticket-config/types';
import type { TicketCategory } from '../../lib/ticket-categories/types';

/** DPG or orgs with explicit 2nd-level escalation workflow. */
function orgSupportsEscalation(org: {
  name?: string | null;
  slug?: string | null;
  settings?: Record<string, unknown> | null;
  second_level_notify_enabled?: boolean;
} | null): boolean {
  if (!org) return false;
  const name = String(org.name || '');
  const slug = String(org.slug || '');
  if (/dpg/i.test(name) || /dpg/i.test(slug)) return true;
  if (org.second_level_notify_enabled === true) return true;
  const settings = org.settings || {};
  if (settings.escalation_workflow_enabled === true) return true;
  if (settings.second_level_notify_enabled === true) return true;
  return false;
}

function matchDispatchAgentId(
  assignee: { id: string; name: string } | null,
  agents: { id: string; name: string }[],
): string {
  if (!assignee) return '';
  if (assignee.id) {
    const byId = agents.find((a) => a.id === assignee.id);
    if (byId) return byId.id;
  }
  const label = (assignee.name || assignee.id).trim().toLowerCase();
  if (label) {
    const byName = agents.find((a) => a.name.toLowerCase() === label);
    if (byName) return byName.id;
  }
  return assignee.id || '';
}

interface RedesignedSidebarProps {
  ticket: TicketType;
  contact: Contact | null;
  company: Company | null;
  allTickets: TicketType[];
  onUpdateTicketField: (data: Partial<TicketType>) => void;
  isAiReady: boolean;
  isAiDrafting: boolean;
  onDraftWithAI: () => void;
  onConvertToKB: () => void;
  suggestedNeuralLinks: SuggestedLink[];
  onLinkTicket: (id: string) => void;
  onUnlinkTicket: (id: string) => void;
  tagsInput: string;
  onChangeTagsInput: (val: string) => void;
  onAddTag: () => void;
  suggestedTags: string[];
  onInitiateHandoff?: (data: { agentName: string; agentId?: string }) => void;
  onCloseMobile?: () => void;
  portalMode?: boolean;
  portalMeta?: PortalTicketWorkspaceMeta | null;
  portalCapabilities?: TicketDetailWorkbenchCapabilities;
  organizationNameById?: Record<string, string>;
  organizationLogoById?: Record<string, string | null>;
}

export function RedesignedSidebar({
  ticket,
  contact,
  company,
  allTickets,
  onUpdateTicketField,
  isAiReady,
  isAiDrafting,
  onDraftWithAI,
  onConvertToKB,
  suggestedNeuralLinks,
  onLinkTicket,
  onUnlinkTicket,
  tagsInput,
  onChangeTagsInput,
  onAddTag,
  suggestedTags,
  onInitiateHandoff,
  onCloseMobile,
  portalMode = false,
  portalMeta = null,
  portalCapabilities,
  organizationNameById = {},
  organizationLogoById = {},
}: RedesignedSidebarProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const usePortalMeta = portalMode && portalMeta != null;
  const { categories: hookedCategories } = useTicketCategories(false, {
    enabled: !usePortalMeta,
  });
  const { statuses: hookedStatuses } = useTicketStatuses({ enabled: !usePortalMeta });
  const { priorities: hookedPriorities } = useTicketPriorities({ enabled: !usePortalMeta });

  const allTicketCategories: TicketCategory[] = usePortalMeta
    ? (portalMeta!.categories || []).map((c, i) => ({
        id: c.id,
        name: c.name,
        slug: c.slug || c.name,
        color: c.color || null,
        sortOrder: i,
        isActive: true,
      })) as TicketCategory[]
    : hookedCategories;
  const ticketStatuses: TicketStatusConfig[] = usePortalMeta
    ? (portalMeta!.statuses || []).map((s, i) => ({
        id: s.id || s.key,
        key: s.key,
        name: s.name,
        description: '',
        color: s.color || '#64748b',
        sortOrder: s.sortOrder ?? i,
        isActive: true,
        workflowKind: (s.workflowKind as TicketStatusConfig['workflowKind']) || 'open',
        createdAt: '',
        updatedAt: '',
      }))
    : hookedStatuses;
  const ticketPriorities: TicketPriorityConfig[] = usePortalMeta
    ? (portalMeta!.priorities || []).map((p, i) => ({
        id: p.id || p.key,
        key: p.key,
        name: p.name,
        description: '',
        color: p.color || '#64748b',
        sortOrder: p.sortOrder ?? i,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      }))
    : hookedPriorities;
  const canEditAssignee = portalMode ? portalCapabilities?.canEditAssignee !== false : true;
  const canEditProperties = portalMode ? portalCapabilities?.canEditProperties !== false : true;

  const ticketAssignee = useMemo(
    () => resolveTicketAssignee(ticket),
    [ticket.agentId, ticket.assignedTo, ticket.assigneeId, ticket.agentName],
  );

  const [liveAgents, setLiveAgents] = useState<{ id: string; name: string }[]>([]);
  const [agentQuery, setAgentQuery] = useState('');
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyQuery, setCompanyQuery] = useState('');
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const [escalationOrg, setEscalationOrg] = useState<{
    name?: string;
    slug?: string;
    settings?: Record<string, unknown>;
    second_level_notify_enabled?: boolean;
  } | null>(null);
  const [loggedHours, setLoggedHours] = useState<number | null>(null);

  useEffect(() => {
    if (portalMode) {
      setLiveAgents((portalMeta?.agents || []).map((a) => ({ id: a.id, name: a.name || a.email })));
      return;
    }
    return userService.subscribeToUsers((users) => {
      setLiveAgents(
        users
          .filter((u: any) => {
            const role = String(u.role || u.hubcomRole || '').toUpperCase();
            return (
              !role.startsWith('CLIENT_') &&
              Boolean(scalarAssigneeId(u.id || u.uid))
            );
          })
          .map((u: any) => ({
            id: String(u.id || u.uid),
            name: String(u.name || u.displayName || u.email || u.id),
          })),
      );
    });
  }, [portalMode, portalMeta]);

  useEffect(() => {
    if (portalMode) {
      setCompanies(company ? [company] : []);
      return;
    }
    return customerService.subscribeToCompanies(setCompanies);
  }, [portalMode, company]);

  useEffect(() => {
    const orgId = String(
      ticket.organizationId || (ticket as any).organization_id || '',
    ).trim();
    if (!orgId || portalMode) {
      setEscalationOrg(null);
      return;
    }
    let cancelled = false;
    void axios
      .get(`/api/admin/organizations/${encodeURIComponent(orgId)}`, { withCredentials: true })
      .then((res) => {
        if (!cancelled) setEscalationOrg(res.data?.organization || null);
      })
      .catch(() => {
        if (!cancelled) setEscalationOrg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.organizationId, (ticket as any).organization_id, portalMode]);

  useEffect(() => {
    if (portalMode) {
      setLoggedHours(null);
      return;
    }
    let cancelled = false;
    void axios
      .get('/api/time-entries', {
        params: { ticketId: ticket.id },
        withCredentials: true,
      })
      .then((res) => {
        if (cancelled) return;
        const entries = (res.data?.entries || res.data || []) as Array<{ hours?: number }>;
        if (!Array.isArray(entries)) {
          setLoggedHours(0);
          return;
        }
        const total = entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0);
        setLoggedHours(total);
      })
      .catch(() => {
        if (!cancelled) setLoggedHours(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticket.id, portalMode]);

  const dispatchAgents = useMemo(() => {
    const agents = usePortalMeta
      ? (portalMeta!.agents || []).map((a) => ({ id: a.id, name: a.name || a.email }))
      : liveAgents.length
        ? liveAgents
        : TICKET_DISPATCH_AGENTS.map((a) => ({ ...a }));
    const filtered = agents.filter((a) => Boolean(scalarAssigneeId(a.id)));
    const currentId = scalarAssigneeId(user?.uid || '');
    const currentName = user?.displayName || user?.email || '';
    if (currentId && !filtered.some((a) => a.id === currentId)) {
      filtered.unshift({
        id: currentId,
        name: currentName || t('tickets.assigneeYourself', 'Yourself'),
      });
    }
    if (!ticketAssignee) return filtered;
    const knownById = Boolean(ticketAssignee.id && filtered.some((a) => a.id === ticketAssignee.id));
    const knownByName = Boolean(
      ticketAssignee.name && filtered.some((a) => a.name.toLowerCase() === ticketAssignee.name.toLowerCase()),
    );
    if (!knownById && !knownByName && ticketAssignee.id) {
      filtered.unshift({
        id: ticketAssignee.id,
        name: ticketAssignee.name || ticketAssignee.id,
      });
    }
    return filtered;
  }, [ticketAssignee, user?.uid, user?.displayName, user?.email, t, usePortalMeta, portalMeta, liveAgents]);

  const syncedDispatchAgentId = useMemo(
    () => matchDispatchAgentId(ticketAssignee, dispatchAgents),
    [ticketAssignee, dispatchAgents],
  );

  const [dispatchAgentId, setDispatchAgentId] = useState(syncedDispatchAgentId);

  useEffect(() => {
    setDispatchAgentId(syncedDispatchAgentId);
  }, [ticket.id, syncedDispatchAgentId]);

  useEffect(() => {
    setCompanyMenuOpen(false);
    setCompanyQuery('');
    setAgentMenuOpen(false);
    setAgentQuery('');
  }, [ticket.id]);

  const filteredAgents = useMemo(() => {
    const q = agentQuery.trim().toLowerCase();
    if (!q) return dispatchAgents;
    return dispatchAgents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  }, [dispatchAgents, agentQuery]);

  const filteredCompanies = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return companies.slice(0, 40);
    return companies
      .filter((c) => String(c.name || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [companies, companyQuery]);

  const showEscalation = orgSupportsEscalation(escalationOrg);

  const hoursLabel =
    loggedHours == null
      ? '—'
      : `${loggedHours.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Std. erfasst`;

  // Collapsing Section States — KI-Copilot + Verbundene Tickets collapsed by default
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    copilot: true,
    tags: false,
    related: true,
  });

  const toggleSection = (section: string) => {
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const assignToMe = () => {
    const id = scalarAssigneeId(user?.uid || '');
    if (!id) return;
    const name = user?.displayName || user?.email || t('tickets.assigneeYourself', 'Yourself');
    setDispatchAgentId(id);
    onUpdateTicketField(buildAssigneePayload(id, name) as Partial<TicketType>);
  };

  const assignCompany = async (companyId: string) => {
    if (portalMode || !canEditProperties) return;
    const nextCompany = companies.find((c) => c.id === companyId) || null;
    let nextOrgId = String(
      (nextCompany as any)?.organizationId ||
        (nextCompany as any)?.organization_id ||
        '',
    ).trim();
    if (!nextOrgId && nextCompany?.name) {
      try {
        const res = await axios.get('/api/admin/organizations', { withCredentials: true });
        const orgs = (res.data?.organizations || []) as Array<{
          id: string;
          name?: string;
          crm_company_id?: string | null;
        }>;
        const match =
          orgs.find((o) => o.crm_company_id === companyId) ||
          orgs.find(
            (o) =>
              String(o.name || '').trim().toLowerCase() ===
              String(nextCompany.name || '').trim().toLowerCase(),
          );
        if (match) nextOrgId = match.id;
      } catch {
        /* PATCH stamp still runs */
      }
    }
    onUpdateTicketField({
      companyId,
      company: nextCompany?.name || '',
      organizationId: nextOrgId || null,
      organization_id: nextOrgId || null,
    } as any);
  };

  const orgId = String(ticket.organizationId || (ticket as any).organization_id || '').trim();
  const companyLabel =
    (orgId && organizationNameById[orgId]) ||
    safeString(ticket.company) ||
    t('tickets.detail.noCompany', 'Kein Unternehmen');
  const logoUrl = resolveTicketOrgLogo(ticket, organizationLogoById);
  const contactLabel = safeString(
    contact?.name || ticket.customerName,
    t('tickets.customerTab.noContactAssigned', 'Keine Kontaktperson zugewiesen'),
  );
  const contactEmail = safeString(contact?.email || (ticket as any).customerEmail || '');
  const channelLabel = (() => {
    const ch = String(ticket.channel || 'email').toLowerCase();
    if (ch === 'chat') return t('tickets.channel.chat', 'Chat');
    if (ch === 'phone') return t('tickets.channel.phone', 'Telefon');
    if (ch === 'whatsapp') return t('tickets.channel.whatsapp', 'WhatsApp');
    return t('tickets.channel.email', 'E-Mail');
  })();

  const fieldRowClass = 'flex items-start justify-between gap-3 py-2.5';
  const fieldLabelClass = 'text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0 pt-1 w-[6.5rem]';

  return (
    <aside className="relative isolate w-full min-w-0 bg-white flex flex-col shrink-0 h-full min-h-0 overflow-hidden select-none">
      <div className="relative z-20 shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-white">
        <span className="text-xs font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-muted-foreground" />
          <span>{t('tickets.sidebar.title', 'Ticket-Details')}</span>
        </span>
        {onCloseMobile ? (
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden h-8 w-8 hover:bg-muted rounded-full"
            onClick={onCloseMobile}
          >
            <X className="w-4 h-4" />
          </Button>
        ) : null}
      </div>

      <div className="relative z-0 flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4">
        {/* Kunde / Unternehmen — click to assign */}
        {!portalMode ? (
          <div className="pt-3 pb-3 border-b border-slate-100 relative">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              {t('tickets.sidebar.customerCompany', 'Kunde / Unternehmen')}
            </p>
            <button
              type="button"
              disabled={!canEditProperties}
              onClick={() => setCompanyMenuOpen((o) => !o)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-slate-50 transition-colors',
                !canEditProperties && 'opacity-70 cursor-default',
              )}
            >
              <CustomerOrgAvatar
                logoUrl={logoUrl}
                companyName={companyLabel}
                contactName={contactLabel}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 truncate">{companyLabel}</p>
                <p className="text-[11px] text-slate-600 truncate">{contactLabel}</p>
                {contactEmail ? (
                  <p className="text-[10px] text-slate-400 truncate">{contactEmail}</p>
                ) : null}
              </div>
              <ChevronDown className={cn('w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform', companyMenuOpen && 'rotate-180')} />
            </button>
            {companyMenuOpen && canEditProperties ? (
              <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg p-2 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={companyQuery}
                    onChange={(e) => setCompanyQuery(e.target.value)}
                    placeholder={t('tickets.sidebar.companySearchPlaceholder', 'Unternehmen suchen…')}
                    className="h-8 pl-8 text-xs"
                    autoFocus
                  />
                </div>
                <div className="max-h-44 overflow-y-auto space-y-0.5">
                  {filteredCompanies.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-50',
                        ticket.companyId === c.id && 'bg-slate-100 font-semibold',
                      )}
                      onClick={() => {
                        void assignCompany(c.id);
                        setCompanyQuery('');
                        setCompanyMenuOpen(false);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                  {filteredCompanies.length === 0 ? (
                    <p className="px-2.5 py-2 text-[11px] text-slate-400 italic">
                      {t('tickets.sidebar.noCompanies', 'Keine Unternehmen gefunden.')}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Flat property rows */}
        <div className="divide-y divide-slate-100">
          <div className={fieldRowClass}>
            <span className={fieldLabelClass}>{t('tickets.sidebar.channel', 'Kanal')}</span>
            <span className="text-xs font-semibold text-slate-800 pt-0.5">{channelLabel}</span>
          </div>

          <div className={fieldRowClass}>
            <span className={fieldLabelClass}>{t('tickets.sidebar.category', 'Kategorie')}</span>
            <div className="min-w-0 flex-1 flex justify-end">
              <TicketCategoryChip
                categoryId={ticket.categoryId}
                categoryName={ticket.categoryName}
                categories={allTicketCategories}
                onChange={(patch) =>
                  canEditProperties ? onUpdateTicketField(patch) : undefined
                }
              />
            </div>
          </div>

          <div className={fieldRowClass}>
            <span className={fieldLabelClass}>{t('tickets.sidebar.priority', 'Priorität')}</span>
            <div className="min-w-0 flex-1 flex justify-end">
              <TicketPriorityChip
                priority={ticket.priority ?? 'medium'}
                priorities={ticketPriorities}
                onChange={(priority) =>
                  canEditProperties
                    ? onUpdateTicketField({ priority: priority as any })
                    : undefined
                }
              />
            </div>
          </div>

          <div className={fieldRowClass}>
            <span className={fieldLabelClass}>{t('tickets.sidebar.dispatchCaseStatus', 'Status')}</span>
            <div className="min-w-0 flex-1 flex items-center justify-end gap-1.5">
              <TicketStatusChip
                status={ticket.status ?? 'open'}
                statuses={ticketStatuses}
                onChange={(status) =>
                  canEditProperties
                    ? onUpdateTicketField({ status: status as any })
                    : undefined
                }
              />
              {isReadonlyTerminalStatus(ticket.status) ? (
                <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground shrink-0">
                  {t('tickets.merge.readonlyMerged', 'Nur lesbar')}
                </span>
              ) : null}
            </div>
          </div>

          <div className="py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={fieldLabelClass + ' pt-0'}>
                <span className="inline-flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5" />
                  {t('tickets.sidebar.assignee', 'Zuständiger')}
                </span>
              </span>
              {canEditAssignee ? (
                <button
                  type="button"
                  className="text-[10px] font-bold text-indigo-700 hover:underline"
                  onClick={assignToMe}
                >
                  {t('tickets.sidebar.assignToMe', 'Mir zuweisen')}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              disabled={!canEditAssignee}
              onClick={() => setAgentMenuOpen((o) => !o)}
              className={cn(
                'w-full flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2 text-left hover:bg-slate-50 transition-colors',
                !canEditAssignee && 'opacity-70 cursor-default',
              )}
            >
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 border',
                  ticketAssignee
                    ? 'bg-slate-100 text-slate-700 border-slate-200'
                    : 'bg-white text-slate-400 border-dashed border-slate-300',
                )}
              >
                {ticketAssignee ? getInitials(ticketAssignee.name || ticketAssignee.id) : '—'}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-xs truncate',
                    ticketAssignee ? 'font-semibold text-slate-900' : 'italic text-slate-400',
                  )}
                >
                  {safeString(
                    ticketAssignee?.name || ticketAssignee?.id,
                    t('tickets.unassigned', 'Nicht zugewiesen'),
                  )}
                </p>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
            {agentMenuOpen && canEditAssignee ? (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-2 space-y-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={agentQuery}
                    onChange={(e) => setAgentQuery(e.target.value)}
                    placeholder={t('tickets.sidebar.agentSearchPlaceholder', 'Agent suchen…')}
                    className="h-8 pl-8 text-xs"
                    autoFocus
                  />
                </div>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50"
                  onClick={() => {
                    setDispatchAgentId('');
                    onUpdateTicketField(clearAssigneePayload());
                    setAgentMenuOpen(false);
                    setAgentQuery('');
                  }}
                >
                  {t('tickets.unassigned', 'Nicht zugewiesen')}
                </button>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredAgents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50',
                        dispatchAgentId === a.id && 'bg-slate-900 text-white hover:bg-slate-800',
                      )}
                      onClick={() => {
                        setDispatchAgentId(a.id);
                        onUpdateTicketField(
                          buildAssigneePayload(a.id, a.name) as Partial<TicketType>,
                        );
                        setAgentMenuOpen(false);
                        setAgentQuery('');
                      }}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {ticketAssignee && onInitiateHandoff ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50"
                onClick={() => {
                  const selected = dispatchAgents.find((a) => a.id === dispatchAgentId);
                  onInitiateHandoff({
                    agentName: selected?.name || safeString(ticket.agentName, 'Agent'),
                    agentId: dispatchAgentId || ticketAssignee?.id || ticket.agentId || undefined,
                  });
                }}
              >
                <UserPlus className="w-3.5 h-3.5" />
                {t('tickets.sidebar.transferTicket', 'Ticket übergeben')}
              </Button>
            ) : null}
          </div>

          <div className={fieldRowClass}>
            <span className={fieldLabelClass}>{t('tickets.sidebar.ticketType', 'Typ')}</span>
            <select
              className="bg-transparent border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary max-w-[12rem]"
              value={ticket.type || 'incident'}
              disabled={!canEditProperties}
              onChange={(e) => onUpdateTicketField({ type: e.target.value as any })}
            >
              <option value="incident">{t('tickets.typeLabels.incident', 'Vorfall')}</option>
              <option value="question">{t('tickets.typeLabels.question', 'Frage')}</option>
              <option value="problem">{t('tickets.typeLabels.problem', 'Problem')}</option>
              <option value="feature_request">
                {t('tickets.typeLabels.feature_request', 'Feature-Anfrage')}
              </option>
            </select>
          </div>

          {!portalMode ? (
            <div className={fieldRowClass}>
              <span className={fieldLabelClass + ' flex items-center gap-1'}>
                <Clock3 className="w-3.5 h-3.5" />
                {t('tickets.sidebar.timeTracking', 'Zeiterfassung')}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-indigo-700"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('hubcom-ticket-open-view', { detail: { tab: 'time' } }),
                  );
                }}
              >
                <span>{hoursLabel === '—' ? t('tickets.sidebar.noTimeLogged', '0,00 Std. erfasst') : hoursLabel}</span>
                <span className="text-[10px] font-bold text-indigo-700">
                  {t('tickets.sidebar.addTime', '+ Zeit')}
                </span>
              </button>
            </div>
          ) : null}
        </div>

        {/* Tags — always visible compact */}
        <div className="py-3 border-t border-slate-100 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              {t('tickets.sidebar.metadataTags', 'Tags')}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {ticket.tags && ticket.tags.length > 0 ? (
              ticket.tags.map((tag) => {
                const tagText =
                  typeof tag === 'string'
                    ? tag
                    : tag && typeof tag === 'object'
                      ? safeString((tag as Record<string, unknown>).name) ||
                        safeString((tag as Record<string, unknown>).label) ||
                        String(tag)
                      : String(tag ?? '');
                if (!tagText) return null;
                return (
                  <Badge
                    key={String(tagText)}
                    className="bg-slate-100 text-slate-700 hover:bg-slate-100 hover:text-red-500 border-none text-[9px] font-bold px-2 py-0.5 gap-1 shrink-0 cursor-pointer"
                    onClick={() =>
                      onUpdateTicketField({
                        tags: ticket.tags.filter((row) => row !== tag),
                      })
                    }
                  >
                    <span>#{String(tagText)}</span>
                    <span className="font-bold text-[8px] opacity-70">x</span>
                  </Badge>
                );
              })
            ) : (
              <span className="text-[10px] text-muted-foreground italic">
                {t('tickets.sidebar.noTagsDefined', 'No manual tags defined.')}
              </span>
            )}
          </div>
          <div className="relative">
            <Input
              placeholder={t('tickets.sidebar.addTagPlaceholder', '+ Tag')}
              className="h-8 text-xs rounded-lg pr-8"
              value={tagsInput}
              onChange={(e) => onChangeTagsInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagsInput.trim()) onAddTag();
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1 h-6 w-6 rounded-md text-slate-600 hover:bg-slate-50"
              onClick={onAddTag}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          {suggestedTags && suggestedTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {suggestedTags
                .filter((st) => !(ticket.tags ?? []).includes(st))
                .map((st) => (
                  <button
                    key={st}
                    type="button"
                    className="text-[9px] font-bold bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 px-2 py-0.5 rounded-full"
                    onClick={() =>
                      onUpdateTicketField({ tags: [...(ticket.tags ?? []), st] })
                    }
                  >
                    +#{st}
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        {/* DPG-only Support-Level / Eskalation */}
        {showEscalation ? (
          <div className="py-3 border-t border-slate-100 space-y-2">
            <label
              htmlFor="dispatch-support-level-select"
              className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block"
            >
              {t('tickets.sidebar.supportLevelEscalation', 'Support-Level / Eskalation')}
            </label>
            <select
              id="dispatch-support-level-select"
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              value={String(
                ticket.support_level ||
                  ticket.supportLevel ||
                  ticket.assigned_queue ||
                  ticket.assignedQueue ||
                  'first_level',
              )}
              onChange={(e) => {
                const val = e.target.value === 'second_level' ? 'second_level' : 'first_level';
                onUpdateTicketField({
                  supportLevel: val,
                  support_level: val,
                  assignedQueue: val,
                  assigned_queue: val,
                  escalated: val === 'second_level',
                  isEscalated: val === 'second_level',
                } as Partial<TicketType>);
              }}
            >
              <option value="first_level">
                {t('tickets.sidebar.firstLevelSupport', '1st-Level / Standard')}
              </option>
              <option value="second_level">
                {t('tickets.sidebar.secondLevelSupport', '2nd-Level-Support')}
              </option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs font-semibold py-2 rounded-lg border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              onClick={() =>
                onUpdateTicketField({
                  supportLevel: 'second_level',
                  support_level: 'second_level',
                  assignedQueue: 'second_level',
                  assigned_queue: 'second_level',
                  escalated: true,
                  isEscalated: true,
                } as Partial<TicketType>)
              }
            >
              {t(
                'tickets.sidebar.escalateToSecondLevel',
                'An 2nd-Level-Support eskalieren / zuweisen',
              )}
            </Button>
          </div>
        ) : null}

        {/* Verbundene Tickets — collapsed */}
        <div className="border-t border-slate-100">
          <button
            type="button"
            className="w-full flex items-center justify-between text-[10.5px] font-bold uppercase tracking-widest text-slate-500 hover:text-foreground transition-colors py-3 focus:outline-none"
            onClick={() => toggleSection('related')}
          >
            <span className="flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-slate-400" />
              <span>
                {t('tickets.sidebar.linkedTickets', 'Verbundene Tickets ({{count}})').replace(
                  '{{count}}',
                  String(ticket.linkedTicketIds?.length || 0),
                )}
              </span>
            </span>
            {collapsed.related ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
          {!collapsed.related ? (
            <div className="space-y-2 pb-3">
              {ticket.linkedTicketIds && ticket.linkedTicketIds.length > 0 ? (
                ticket.linkedTicketIds.map((id) => (
                  <div
                    key={id}
                    className="py-1.5 flex items-center justify-between text-[11px]"
                  >
                    <span className="truncate pr-1 text-foreground font-semibold">
                      #{id.slice(-5).toUpperCase()}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-red-500 p-0.5 rounded"
                      onClick={() => onUnlinkTicket(id)}
                    >
                      <Unlink className="w-3 h-3" />
                    </button>
                  </div>
                ))
              ) : (
                <span className="text-[10px] text-muted-foreground italic block">
                  {t('tickets.sidebar.noActiveLinks', 'No active linkages.')}
                </span>
              )}
              {suggestedNeuralLinks?.length ? (
                <div className="pt-1 space-y-1">
                  {suggestedNeuralLinks.slice(0, 3).map((link) => (
                    <button
                      key={link.ticketId}
                      type="button"
                      className="w-full text-left text-[10px] font-semibold text-indigo-700 hover:underline"
                      onClick={() => onLinkTicket(link.ticketId)}
                    >
                      + {link.subject || link.ticketId}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* KI-Copilot — collapsed */}
        <div className="border-t border-slate-100">
          <button
            type="button"
            className="w-full flex items-center justify-between text-[10.5px] font-bold uppercase tracking-widest text-slate-500 hover:text-foreground transition-colors py-3 focus:outline-none"
            onClick={() => toggleSection('copilot')}
          >
            <span className="flex items-center gap-1.5 text-indigo-700">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span>{t('tickets.sidebar.aiCopilotHub', 'KI-Copilot')}</span>
            </span>
            {collapsed.copilot ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
          {!collapsed.copilot ? (
            <div className="space-y-2 pb-3">
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  className="bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold h-8 rounded-lg"
                  onClick={onDraftWithAI}
                  disabled={isAiDrafting || !isAiReady}
                >
                  {t('tickets.sidebar.draftReply', 'Draft reply')}
                </Button>
                <Button
                  className="bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold h-8 rounded-lg"
                  onClick={onConvertToKB}
                  disabled={!isAiReady}
                >
                  {t('tickets.sidebar.kbExtraction', 'KB extraction')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Schnellaktionen footer */}
      {!portalMode ? (
        <div className="shrink-0 border-t border-slate-200 px-4 py-3 bg-slate-50/80 space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {t('tickets.sidebar.quickActions', 'Schnellaktionen')}
          </p>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white transition-colors"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('hubcom-ticket-open-view', { detail: { tab: 'tasks' } }),
              );
            }}
          >
            <ListTodo className="w-3.5 h-3.5 text-slate-400" />
            {t('tickets.sidebar.createTask', 'Aufgabe erstellen')}
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white transition-colors"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('hubcom-ticket-open-view', { detail: { tab: 'time' } }),
              );
            }}
          >
            <Clock3 className="w-3.5 h-3.5 text-slate-400" />
            {t('tickets.sidebar.logTime', 'Zeit erfassen')}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
