import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Dialog, DialogContent } from './ui/dialog';
import { Sheet, SheetContent } from './ui/sheet';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { ticketService } from '../services/ticketService';
import { useAuth } from '../lib/hooks';
import { toast } from 'sonner';
import { logAudit } from '../services/auditService';
import { buildAssigneePayload, clearAssigneePayload } from '../lib/ticketAssignee';
const RichTextEditor = lazy(() =>
  import('./RichTextEditor').then((m) => ({ default: m.RichTextEditor })),
);
import {
  Plus,
  X,
  ChevronDown,
  ChevronLeft,
  Building2,
  Clock,
  Info,
  FileText,
  User as UserIcon,
  Users,
  Flag,
  HelpCircle,
  Settings,
  PenSquare,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { customerService } from '../services/customerService';
import { groupService } from '../services/groupService';
import axios from 'axios';
import { userService } from '../services/userService';
import { Company, Contact, Group, User } from '../types';
import { useTranslation } from '../lib/context/I18nContext';
import { useWorkspace } from '../lib/context/WorkspaceContext';
import { useTicketCategories } from '../hooks/useTicketCategories';
import { useTicketStatuses } from '../hooks/useTicketStatuses';
import { useTicketPriorities } from '../hooks/useTicketPriorities';
import { useTicketTypes } from '../hooks/useTicketTypes';
import {
  resolvePriorityConfig,
  resolveStatusConfig,
  resolveTypeConfig,
  softTintStyles,
} from '../lib/ticket-config/display';

interface CreateTicketDialogProps {
  isOpen: boolean;
  onClose: () => void;
  presentation?: 'dialog' | 'drawer' | 'inline';
  prefetchedCompanies?: Company[];
  prefetchedAgents?: User[];
}

const SHELL_CLASS =
  'w-full h-full max-w-full max-h-screen sm:max-w-[1100px] sm:max-h-[95vh] rounded-none sm:rounded-xl flex flex-col p-0 overflow-hidden bg-[#F8F9FB] border-none shadow-2xl';

const INLINE_CLASS =
  'w-full flex flex-col bg-[#F8F9FB] min-h-0 flex-1 border-none shadow-none';

const DRAFT_STORAGE_KEY = 'hubcom.createTicket.draft.v1';

type FormState = {
  subject: string;
  description: string;
  internalNotes: string;
  priority: string;
  status: string;
  groupId: string;
  groupName: string;
  /** Legacy string kept for older consumers; prefer groupId. */
  group: string;
  type: string;
  customerName: string;
  customerId: string;
  customerEmail: string;
  contactId: string;
  companyId: string;
  organizationId: string;
  requesterId: string;
  product: string;
  tags: string[];
  assignee: string;
  ticketKind: 'support' | 'bug';
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  slaTier: string;
  affectedVersion: string;
  environment: string;
  stepsToReproduce: string;
};

type ContactOption = {
  id: string;
  name: string;
  email: string;
  source: 'contact' | 'portal';
  userId?: string;
};

const EMPTY_FORM: FormState = {
  subject: '',
  description: '',
  internalNotes: '',
  priority: 'medium',
  status: 'open',
  groupId: '',
  groupName: '',
  group: '',
  type: 'question',
  customerName: '',
  customerId: '',
  customerEmail: '',
  contactId: '',
  companyId: '',
  organizationId: '',
  requesterId: '',
  product: '',
  tags: [],
  assignee: 'unassigned',
  ticketKind: 'support',
  categoryId: '',
  categoryName: '',
  categorySlug: '',
  slaTier: '',
  affectedVersion: '',
  environment: '',
  stepsToReproduce: '',
};

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readStoredDraft(): FormState | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    return { ...EMPTY_FORM, ...parsed, tags: Array.isArray(parsed.tags) ? parsed.tags : [] };
  } catch {
    return null;
  }
}

function writeStoredDraft(data: FormState) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

function clearStoredDraft() {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function CreateTicketDialog({
  isOpen,
  onClose,
  presentation = 'dialog',
  prefetchedCompanies,
  prefetchedAgents,
}: CreateTicketDialogProps) {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { categories: ticketCategories, loading: categoriesLoading } = useTicketCategories(true);
  const { activeStatuses, statuses, loading: statusesLoading } = useTicketStatuses();
  const { activePriorities, priorities, loading: prioritiesLoading } = useTicketPriorities();
  const { activeTypes, types, loading: typesLoading } = useTicketTypes();

  const [loading, setLoading] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [companies, setCompanies] = useState<Company[]>(prefetchedCompanies ?? []);
  const [agents, setAgents] = useState<User[]>(prefetchedAgents ?? []);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [portalContacts, setPortalContacts] = useState<ContactOption[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
  const [baselineJson, setBaselineJson] = useState(() => JSON.stringify(EMPTY_FORM));
  const defaultsAppliedRef = useRef(false);
  const submitLockRef = useRef(false);

  const configLoading = statusesLoading || prioritiesLoading || typesLoading || categoriesLoading;

  const isDirty = useMemo(
    () => JSON.stringify(formData) !== baselineJson,
    [formData, baselineJson],
  );

  const resetToBaseline = useCallback((next: FormState) => {
    setFormData(next);
    setBaselineJson(JSON.stringify(next));
    setTagInput('');
  }, []);

  const buildDefaults = useCallback(
    (kind: 'support' | 'bug', draft?: FormState | null): FormState => {
      const openStatus =
        activeStatuses.find((s) => s.workflowKind === 'open') ||
        activeStatuses.find((s) => s.key === 'open') ||
        activeStatuses[0];
      const mediumPriority =
        activePriorities.find((p) => p.key === 'medium') || activePriorities[0];
      const preferredTypeKey = kind === 'bug' ? 'problem' : 'question';
      const preferredType =
        activeTypes.find((ty) => ty.key === preferredTypeKey) || activeTypes[0];
      const defaultGroup = groups.find((g) => g.isDefault) || groups[0];

      const base: FormState = {
        ...EMPTY_FORM,
        ticketKind: kind,
        status: openStatus?.key || 'open',
        priority: mediumPriority?.key || 'medium',
        type: preferredType?.key || preferredTypeKey,
        groupId: defaultGroup?.id || '',
        groupName: defaultGroup?.name || '',
        group: defaultGroup?.name || '',
      };

      if (!draft) return base;

      // Restore draft but never re-activate inactive taxonomy keys for a new ticket.
      const statusOk = activeStatuses.some((s) => s.key === draft.status);
      const priorityOk = activePriorities.some((p) => p.key === draft.priority);
      const typeOk = activeTypes.some((ty) => ty.key === draft.type);
      const categoryOk =
        !draft.categoryId || ticketCategories.some((c) => c.id === draft.categoryId);
      const groupOk = !draft.groupId || groups.some((g) => g.id === draft.groupId);

      return {
        ...base,
        ...draft,
        ticketKind: draft.ticketKind === 'bug' ? 'bug' : 'support',
        status: statusOk ? draft.status : base.status,
        priority: priorityOk ? draft.priority : base.priority,
        type: typeOk ? draft.type : base.type,
        categoryId: categoryOk ? draft.categoryId : '',
        categoryName: categoryOk ? draft.categoryName : '',
        categorySlug: categoryOk ? draft.categorySlug : '',
        groupId: groupOk ? draft.groupId : base.groupId,
        groupName: groupOk ? draft.groupName : base.groupName,
        group: groupOk ? draft.group || draft.groupName : base.group,
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        assignee: draft.assignee || 'unassigned',
      };
    },
    [activePriorities, activeStatuses, activeTypes, groups, ticketCategories],
  );

  // Hydrate when opening (once config is ready)
  useEffect(() => {
    if (!isOpen) {
      defaultsAppliedRef.current = false;
      return;
    }
    if (configLoading || defaultsAppliedRef.current) return;
    // Wait until at least one taxonomy list resolved (empty list is still "loaded")
    if (statusesLoading || prioritiesLoading || typesLoading) return;

    const kind = workspace === 'developer' ? 'bug' : 'support';
    const draft = readStoredDraft();
    const next = buildDefaults(kind, draft);
    resetToBaseline(next);
    setDraftSavedAt(draft ? new Date().toISOString() : null);
    defaultsAppliedRef.current = true;
  }, [
    isOpen,
    configLoading,
    statusesLoading,
    prioritiesLoading,
    typesLoading,
    workspace,
    buildDefaults,
    resetToBaseline,
  ]);

  useEffect(() => {
    if (prefetchedCompanies) {
      setCompanies(prefetchedCompanies);
      return;
    }
    return customerService.subscribeToCompanies(setCompanies);
  }, [prefetchedCompanies]);

  // Enrich CRM companies with canonical organizations.id (name / crm_company_id match).
  useEffect(() => {
    if (companies.length === 0) return;
    let cancelled = false;
    void import('axios').then(({ default: axios }) =>
      axios
        .get('/api/admin/organizations', { withCredentials: true })
        .then((res) => {
          if (cancelled) return;
          const orgs = (res.data?.organizations || []) as Array<{
            id: string;
            name?: string;
            crm_company_id?: string | null;
            domain?: string | null;
          }>;
          if (!orgs.length) return;
          setCompanies((prev) =>
            prev.map((c) => {
              const existing = String(
                (c as any).organizationId || (c as any).organization_id || '',
              ).trim();
              if (existing) return c;
              const byCrm = orgs.find((o) => o.crm_company_id && o.crm_company_id === c.id);
              const byName = orgs.find(
                (o) =>
                  String(o.name || '')
                    .trim()
                    .toLowerCase() ===
                  String(c.name || '')
                    .trim()
                    .toLowerCase(),
              );
              const byDomain =
                c.domain &&
                orgs.find(
                  (o) =>
                    o.domain &&
                    String(o.domain).trim().toLowerCase() ===
                      String(c.domain).trim().toLowerCase(),
                );
              const match = byCrm || byName || byDomain;
              if (!match) return c;
              return {
                ...c,
                organizationId: match.id,
                organization_id: match.id,
              } as Company;
            }),
          );
        })
        .catch(() => {
          /* non-fatal — server stamp still runs on create */
        }),
    );
    return () => {
      cancelled = true;
    };
    // Intentionally only when the company set size changes (initial load / prefetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies.length]);

  useEffect(() => {
    if (prefetchedAgents) {
      setAgents(prefetchedAgents);
      return;
    }
    return userService.subscribeToUsers(setAgents);
  }, [prefetchedAgents]);

  useEffect(() => {
    return groupService.subscribeToGroups(setGroups);
  }, []);

  useEffect(() => {
    if (formData.companyId) {
      return customerService.subscribeToContacts(formData.companyId, setContacts);
    }
    setContacts([]);
  }, [formData.companyId]);

  // Resolve organizationId from selected Unternehmen + load portal users.
  useEffect(() => {
    if (!formData.companyId) {
      setPortalContacts([]);
      setFormData((prev) =>
        prev.organizationId ? { ...prev, organizationId: '' } : prev,
      );
      return;
    }
    const company = companies.find((c) => c.id === formData.companyId);
    const orgId =
      String((company as any)?.organizationId || (company as any)?.organization_id || '').trim();
    if (orgId) {
      setFormData((prev) =>
        prev.organizationId === orgId ? prev : { ...prev, organizationId: orgId },
      );
    } else {
      // Ask admin orgs API / companies may still sync — clear stale org.
      setFormData((prev) =>
        prev.organizationId ? { ...prev, organizationId: '' } : prev,
      );
    }

    if (!orgId) {
      setPortalContacts([]);
      return;
    }

    let cancelled = false;
    void axios
      .get(`/api/admin/organizations/${encodeURIComponent(orgId)}/users`, {
        withCredentials: true,
      })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data?.users || []) as Array<Record<string, unknown>>;
        setPortalContacts(
          rows
            .map((u) => ({
              id: `portal:${String(u.id || '')}`,
              name: String(u.name || u.email || ''),
              email: String(u.email || '').trim(),
              source: 'portal' as const,
              userId: String(u.id || ''),
            }))
            .filter((u) => u.userId && u.email),
        );
      })
      .catch(() => {
        if (!cancelled) setPortalContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [formData.companyId, companies]);

  const contactOptions = useMemo((): ContactOption[] => {
    const byEmail = new Map<string, ContactOption>();
    for (const c of contacts) {
      const email = String(c.email || '').trim().toLowerCase();
      if (!email) continue;
      byEmail.set(email, {
        id: c.id,
        name: c.name || email,
        email: c.email,
        source: 'contact',
      });
    }
    for (const p of portalContacts) {
      const email = p.email.trim().toLowerCase();
      if (!email) continue;
      const existing = byEmail.get(email);
      if (existing) {
        byEmail.set(email, {
          ...existing,
          userId: p.userId || existing.userId,
          source: existing.source,
          // Prefer portal user id for requester linkage when available.
          id: existing.id,
        });
      } else {
        byEmail.set(email, p);
      }
    }
    return Array.from(byEmail.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'de'),
    );
  }, [contacts, portalContacts]);

  // Clear contact when it no longer belongs to the selected organization
  useEffect(() => {
    if (!formData.contactId || !formData.companyId) return;
    if (contactOptions.length === 0) return;
    if (!contactOptions.some((c) => c.id === formData.contactId)) {
      setFormData((prev) => ({
        ...prev,
        contactId: '',
        customerName: '',
        customerId: '',
        customerEmail: '',
        requesterId: '',
      }));
    }
  }, [contactOptions, formData.companyId, formData.contactId]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const [aiMeta, setAiMeta] = useState({
    sentiment: 'Neutral',
    language: 'Deutsch',
    suggestedTags: [] as string[],
  });

  useEffect(() => {
    const text = (formData.subject + ' ' + stripHtml(formData.description)).toLowerCase();
    let sentiment = 'Neutral';
    if (
      text.includes('urgent') ||
      text.includes('not working') ||
      text.includes('broken') ||
      text.includes('error') ||
      text.includes('dringend') ||
      text.includes('fehler')
    ) {
      sentiment = 'Negativ';
    } else if (
      text.includes('thanks') ||
      text.includes('happy') ||
      text.includes('danke') ||
      text.includes('super')
    ) {
      sentiment = 'Positiv';
    }

    let language = 'Deutsch';
    if (text.includes('hola') || text.includes('gracias')) language = 'Spanisch';
    else if (text.includes('bonjour') || text.includes('merci')) language = 'Französisch';
    else if (
      /\b(the|and|please|hello|issue|error)\b/.test(text) &&
      !/\b(und|bitte|hallo|fehler)\b/.test(text)
    ) {
      language = 'Englisch';
    }

    const suggested: string[] = [];
    if (text.includes('payment') || text.includes('bill') || text.includes('rechnung')) {
      suggested.push('billing');
    }
    if (text.includes('login') || text.includes('password') || text.includes('auth')) {
      suggested.push('security');
    }
    setAiMeta({ sentiment, language, suggestedTags: suggested });
  }, [formData.description, formData.subject]);

  const statusDisplay = useMemo(
    () => resolveStatusConfig(formData.status, statuses.length ? statuses : activeStatuses),
    [formData.status, statuses, activeStatuses],
  );
  const priorityDisplay = useMemo(
    () => resolvePriorityConfig(formData.priority, priorities.length ? priorities : activePriorities),
    [formData.priority, priorities, activePriorities],
  );
  const typeDisplay = useMemo(
    () => resolveTypeConfig(formData.type, types.length ? types : activeTypes),
    [formData.type, types, activeTypes],
  );

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === formData.groupId) || null,
    [groups, formData.groupId],
  );

  /** Categories allowed by the selected team's categoryIds (if configured). */
  const selectableCategories = useMemo(() => {
    const active = ticketCategories
      .filter((c) => c.isActive !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
    const allowed = selectedGroup?.categoryIds?.filter(Boolean) || [];
    if (!allowed.length) return active;
    return active.filter((c) => allowed.includes(c.id));
  }, [ticketCategories, selectedGroup]);

  const slaInfo = useMemo(() => {
    const hoursByKey: Record<string, number> = {
      low: 48,
      medium: 24,
      high: 4,
      urgent: 1,
    };
    const hours = hoursByKey[formData.priority] ?? 24;
    const target = new Date(Date.now() + hours * 60 * 60 * 1000);
    return {
      date: target.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }),
      hours,
    };
  }, [formData.priority]);

  const assigneeLabel = useMemo(() => {
    if (formData.assignee === 'unassigned' || !formData.assignee) {
      return t('tickets.unassigned', 'Nicht zugewiesen');
    }
    if (user?.uid && formData.assignee === user.uid) {
      return t('dialog.assignToMe', 'Mir zuweisen');
    }
    const agent = agents.find((a) => a.id === formData.assignee);
    return agent?.name || formData.assignee;
  }, [agents, formData.assignee, t, user?.uid]);

  const handleAddTag = (tag: string) => {
    const cleanTag = tag.trim().replace(/^#/, '');
    if (cleanTag && !formData.tags.includes(cleanTag)) {
      setFormData((prev) => ({ ...prev, tags: [...prev.tags, cleanTag] }));
    }
    setTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((x) => x !== tagToRemove),
    }));
  };

  const confirmDiscard = useCallback(() => {
    if (!isDirty) return true;
    return window.confirm(
      t(
        'dialog.discardUnsavedConfirm',
        'Ungespeicherte Änderungen verwerfen? Ein gespeicherter Entwurf bleibt erhalten, bis Sie ihn verwerfen.',
      ),
    );
  }, [isDirty, t]);

  const requestClose = useCallback(() => {
    if (!confirmDiscard()) return;
    onClose();
  }, [confirmDiscard, onClose]);

  const handleSaveDraft = useCallback(() => {
    writeStoredDraft(formData);
    setBaselineJson(JSON.stringify(formData));
    setDraftSavedAt(new Date().toISOString());
    toast.success(t('dialog.draftSaved', 'Entwurf gespeichert'));
  }, [formData, t]);

  const handleDiscard = useCallback(() => {
    if (isDirty || readStoredDraft()) {
      const ok = window.confirm(
        t(
          'dialog.discardDraftConfirm',
          'Entwurf verwerfen und Formular leeren?',
        ),
      );
      if (!ok) return;
    }
    clearStoredDraft();
    setDraftSavedAt(null);
    const kind = workspace === 'developer' ? 'bug' : 'support';
    const next = buildDefaults(kind, null);
    resetToBaseline(next);
    toast.message(t('dialog.draftDiscarded', 'Entwurf verworfen'));
    onClose();
  }, [buildDefaults, isDirty, onClose, resetToBaseline, t, workspace]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!user || loading || submitLockRef.current) return;

    if (!formData.subject.trim() || !stripHtml(formData.description)) {
      toast.error(
        t('dialog.subjectAndDescRequired', 'Betreff und Beschreibung sind erforderlich.'),
      );
      return;
    }

    submitLockRef.current = true;
    setLoading(true);
    try {
      const {
        assignee: formAssignee,
        groupId,
        groupName,
        group: _legacyGroup,
        ...restForm
      } = formData;
      const assigneeFields =
        !formAssignee || formAssignee === 'unassigned'
          ? clearAssigneePayload()
          : formAssignee === user.uid
            ? buildAssigneePayload(
                user.uid,
                user.displayName || user.email || t('tickets.assigneeYourself', 'Sie selbst'),
                user.email || null,
              )
            : buildAssigneePayload(
                formAssignee,
                agents.find((a) => a.id === formAssignee)?.name || formAssignee,
              );

      const selectedCompany = companies.find((c) => c.id === formData.companyId);
      const organizationId =
        formData.organizationId ||
        String(
          (selectedCompany as any)?.organizationId ||
            (selectedCompany as any)?.organization_id ||
            '',
        ).trim() ||
        undefined;
      const companyName = selectedCompany?.name || undefined;
      const customerEmail = formData.customerEmail.trim() || undefined;
      const requesterId = formData.requesterId.trim() || undefined;

      const createdId = await ticketService.createTicket({
        ...restForm,
        ...assigneeFields,
        groupId: groupId || undefined,
        groupName: groupName || undefined,
        companyId: formData.companyId || undefined,
        company: companyName,
        organizationId: organizationId || null,
        organization_id: organizationId || null,
        customerName: formData.customerName || undefined,
        customerEmail: customerEmail || null,
        customerId:
          formData.customerId ||
          customerEmail ||
          requesterId ||
          undefined,
        contactId: formData.contactId?.startsWith('portal:')
          ? undefined
          : formData.contactId || undefined,
        requesterId: requesterId || null,
        requester_id: requesterId || null,
        team: formData.ticketKind === 'bug' ? 'engineering' : 'support',
        ticketKind: formData.ticketKind,
        type: formData.type as any,
        categoryId: formData.categoryId || null,
        categoryName: formData.categoryName || null,
        categorySlug: formData.categorySlug || null,
        status: formData.status as any,
        priority: formData.priority as any,
        // Assignee must not mutate status — clearAssigneePayload only clears assignee fields.
        devStatus: formData.ticketKind === 'bug' ? 'backlog' : undefined,
        tags:
          formData.ticketKind === 'bug'
            ? [...new Set([...formData.tags, 'bug'])]
            : formData.tags,
        creatorId: user.uid,
        sentiment: aiMeta.sentiment.toLowerCase(),
        language: aiMeta.language,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      logAudit({
        module: 'tickets',
        action: 'CREATE_TICKET',
        details: {
          subject: formData.subject,
          description: 'Created new ticket via creation screen',
        },
      });

      clearStoredDraft();
      setDraftSavedAt(null);
      toast.success(t('dialog.ticketCreatedSuccess', 'Ticket erfolgreich erstellt'));
      const kind = workspace === 'developer' ? 'bug' : 'support';
      resetToBaseline(buildDefaults(kind, null));
      onClose();
    } catch {
      toast.error(t('dialog.failedToCreateTicket', 'Ticket konnte nicht erstellt werden.'));
    } finally {
      submitLockRef.current = false;
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) requestClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // Re-bind when open/form/loading change so submit sees latest state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, formData, loading, user]);

  const onCompanyChange = (val: string) => {
    const company = companies.find((c) => c.id === val);
    const orgId = String(
      (company as any)?.organizationId || (company as any)?.organization_id || '',
    ).trim();
    setFormData((prev) => ({
      ...prev,
      companyId: val,
      organizationId: orgId,
      contactId: '',
      customerName: '',
      customerId: '',
      customerEmail: '',
      requesterId: '',
    }));
  };

  const onGroupChange = (val: string) => {
    if (val === 'none') {
      setFormData((prev) => ({
        ...prev,
        groupId: '',
        groupName: '',
        group: '',
      }));
      return;
    }
    const g = groups.find((x) => x.id === val);
    setFormData((prev) => {
      const allowed = g?.categoryIds?.filter(Boolean) || [];
      const categoryStillOk =
        !prev.categoryId || !allowed.length || allowed.includes(prev.categoryId);
      return {
        ...prev,
        groupId: val,
        groupName: g?.name || '',
        group: g?.name || '',
        ...(categoryStillOk
          ? {}
          : { categoryId: '', categoryName: '', categorySlug: '' }),
      };
    });
  };

  const onCategoryChange = (val: string) => {
    if (val === 'none') {
      setFormData((prev) => ({
        ...prev,
        categoryId: '',
        categoryName: '',
        categorySlug: '',
      }));
      return;
    }
    const cat = ticketCategories.find((c) => c.id === val);
    setFormData((prev) => ({
      ...prev,
      categoryId: val,
      categoryName: cat?.name || '',
      categorySlug: cat?.slug || '',
    }));
  };

  const closeControl =
    presentation === 'inline' ? (
      <Button
        type="button"
        variant="ghost"
        onClick={requestClose}
        className="text-[13px] font-semibold text-slate-600 hover:bg-slate-50 gap-1.5 px-3 h-9"
        aria-label={t('tickets.detail.backToList', 'Zurück zu Tickets')}
      >
        <ChevronLeft className="w-4 h-4" aria-hidden />
        {t('tickets.detail.backToList', 'Zurück zu Tickets')}
      </Button>
    ) : (
      <button
        type="button"
        onClick={requestClose}
        className="p-1.5 sm:p-2 rounded-full hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={t('common.close', 'Schließen')}
      >
        <X className="w-4 h-4 sm:w-5 sm:h-5 text-slate-500" aria-hidden />
      </button>
    );

  const content = (
    <>
      <div className="px-4 sm:px-6 py-3 sm:py-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b bg-white z-10">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {presentation === 'inline' ? closeControl : null}
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shadow-sm border border-blue-100 shrink-0">
            <FileText className="w-5 h-5 text-blue-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-[#1F2937] tracking-tight truncate">
              {t('dialog.createNewTicket', 'Neues Ticket erstellen')}
            </h2>
            <p className="hidden md:block text-[13px] text-slate-500 font-medium truncate">
              {draftSavedAt
                ? t('dialog.draftRestoredHint', 'Gespeicherter Entwurf geladen.')
                : t(
                    'dialog.draftingNewSupport',
                    'Neues Ticket für interne oder externe Bearbeitung.',
                  )}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 sm:gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={loading}
            className="text-[12px] sm:text-[13px] font-semibold text-blue-600 border-blue-100 hover:bg-blue-50/50 rounded-lg px-3 sm:px-5 h-9 sm:h-10"
          >
            {t('dialog.saveDraft', 'Entwurf speichern')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            className="text-[12px] sm:text-[13px] font-bold bg-[#3B82F6] hover:bg-blue-600 text-white rounded-lg px-4 sm:px-6 h-9 sm:h-10 shadow-lg shadow-blue-500/20"
          >
            {loading
              ? t('dialog.publishing', 'Wird veröffentlicht…')
              : t('dialog.publishTicket', 'Ticket veröffentlichen')}
          </Button>
          {presentation !== 'inline' ? closeControl : null}
        </div>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden"
      >
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          <div className="bg-white border border-slate-200/60 rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[13px] font-bold text-blue-600 border border-blue-100/50">
                1
              </div>
              <h3 className="text-[15px] font-bold text-[#374151]">
                {t('dialog.whatIsThisAbout', 'Worum geht es?')}
              </h3>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="create-ticket-subject" className="text-sm font-semibold text-slate-700">
                  {t('dialog.subject', 'Betreff')}{' '}
                  <span className="text-rose-600" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="create-ticket-subject"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder={t('dialog.subjectPlaceholder', 'Kernanliegen kurz zusammenfassen…')}
                  required
                  className="w-full h-11 border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-blue-100 focus-visible:border-blue-400 rounded-xl text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="create-ticket-company" className="text-sm font-semibold text-slate-700">
                    {t('dialog.company', 'Unternehmen')}
                  </Label>
                  <Select value={formData.companyId || undefined} onValueChange={onCompanyChange}>
                    <SelectTrigger
                      id="create-ticket-company"
                      className="w-full h-11 border-slate-200 bg-white rounded-xl text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-slate-400" aria-hidden />
                        <SelectValue placeholder={t('dialog.selectOrg', 'Organisation wählen…')} />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-ticket-contact" className="text-sm font-semibold text-slate-700">
                    {t('dialog.contactEmployee', 'Kontaktperson / Mitarbeiter')}
                  </Label>
                  <Select
                    value={formData.contactId || undefined}
                    onValueChange={(val) => {
                      const contact = contactOptions.find((c) => c.id === val);
                      if (contact) {
                        setFormData({
                          ...formData,
                          contactId: val,
                          customerName: contact.name,
                          customerEmail: contact.email,
                          customerId: contact.userId || contact.id,
                          requesterId: contact.userId || '',
                        });
                      }
                    }}
                    disabled={!formData.companyId}
                  >
                    <SelectTrigger
                      id="create-ticket-contact"
                      className="w-full h-11 border-slate-200 bg-white rounded-xl text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <UserIcon className="w-4 h-4 text-slate-400" aria-hidden />
                        <SelectValue
                          placeholder={
                            formData.companyId
                              ? t('dialog.selectEmployee', 'Mitarbeiter wählen…')
                              : t('dialog.selectCompanyFirst', 'Zuerst Unternehmen wählen')
                          }
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {contactOptions.length === 0 ? (
                        <SelectItem value="__empty" disabled>
                          {t('dialog.noContacts', 'Keine Kontakte für dieses Unternehmen')}
                        </SelectItem>
                      ) : (
                        contactOptions.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name} ({c.email})
                            {c.source === 'portal' ? ' · Portal' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200/60 rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-[13px] font-bold text-blue-600 border border-blue-100/50">
                2
              </div>
              <h3 className="text-[15px] font-bold text-[#374151]">
                {t('dialog.describeRequest', 'Anfrage beschreiben')}{' '}
                <span className="text-rose-600 text-sm font-semibold" aria-hidden>
                  *
                </span>
              </h3>
            </div>

            <div className="space-y-3">
              <div className="relative group rounded-2xl border border-slate-200 overflow-hidden bg-white">
                <div className="absolute right-4 top-3 z-10 flex gap-2">
                  <div className="px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-lg">
                    <span className="text-[11px] font-semibold text-slate-600">
                      {aiMeta.sentiment}
                    </span>
                  </div>
                  <div className="px-2.5 py-1 bg-slate-50 border border-slate-100 rounded-lg flex items-center gap-1">
                    <span className="text-[11px] font-semibold text-slate-600">{aiMeta.language}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                  </div>
                </div>
                {isOpen ? (
                  <Suspense
                    fallback={
                      <div className="min-h-[200px] flex items-center justify-center text-sm text-slate-500">
                        {t('dialog.loadingEditor', 'Editor wird geladen…')}
                      </div>
                    }
                  >
                    <RichTextEditor
                      value={formData.description}
                      onChange={(v) => setFormData({ ...formData, description: v })}
                      placeholder={t(
                        'dialog.descriptionPlaceholder',
                        'Details, Kontext, bereits versuchte Schritte, erwartetes Ergebnis…',
                      )}
                      className="border-none shadow-none focus-within:ring-0 min-h-[200px]"
                    />
                  </Suspense>
                ) : null}
              </div>
              <p className="text-xs text-slate-500 ml-0.5">
                {t(
                  'dialog.descriptionTip',
                  'Tipp: Relevante Details beschleunigen die Bearbeitung.',
                )}
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200/60 rounded-2xl p-5 sm:p-6 shadow-sm">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100">
                <PenSquare className="w-5 h-5 text-slate-400" aria-hidden />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[#374151]">
                  {t('dialog.internalNotes', 'Interne Notizen')}{' '}
                  <span className="text-slate-400 font-normal text-sm">
                    ({t('dialog.optional', 'optional')})
                  </span>
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {t(
                    'dialog.internalNotesDesc',
                    'Nur für Agenten sichtbar — nicht für externe Kunden.',
                  )}
                </p>
              </div>
            </div>
            <Textarea
              value={formData.internalNotes}
              onChange={(e) => setFormData({ ...formData, internalNotes: e.target.value })}
              className="min-h-[100px] border-slate-100 shadow-none text-sm placeholder:text-slate-400 bg-white rounded-xl"
              placeholder={t(
                'dialog.internalNotesPlaceholder',
                'Private Agentennotizen eingeben…',
              )}
              aria-label={t('dialog.internalNotes', 'Interne Notizen')}
            />
          </div>
        </div>

        <aside className="w-full lg:w-[320px] xl:w-[340px] bg-white border-t lg:border-t-0 lg:border-l p-4 sm:p-6 space-y-6 shrink-0 lg:overflow-y-auto min-h-0">
          <div className="flex items-center gap-2.5 text-[#4B5563]">
            <Settings className="w-4 h-4" aria-hidden />
            <h3 className="text-[15px] font-bold">
              {t('dialog.ticketSettings', 'Ticket-Einstellungen')}
            </h3>
          </div>

          {configLoading ? (
            <p className="text-sm text-slate-500" role="status">
              {t('dialog.loadingConfig', 'Ticket-Konfiguration wird geladen…')}
            </p>
          ) : null}

          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('common.status', 'Status')}
              </Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData({ ...formData, status: v })}
                disabled={!activeStatuses.length}
              >
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: statusDisplay.color }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-[#374151]">
                      {statusDisplay.name}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {activeStatuses.length === 0 ? (
                    <SelectItem value={formData.status || 'open'} disabled>
                      {t('dialog.noStatuses', 'Keine aktiven Status konfiguriert')}
                    </SelectItem>
                  ) : (
                    activeStatuses.map((s) => (
                      <SelectItem key={s.id} value={s.key}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                            aria-hidden
                          />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('common.priority', 'Priorität')}
              </Label>
              <Select
                value={formData.priority}
                onValueChange={(v) => setFormData({ ...formData, priority: v })}
                disabled={!activePriorities.length}
              >
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5">
                    <Flag
                      className="w-4 h-4 shrink-0"
                      style={{ color: priorityDisplay.color }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold text-[#374151]">
                      {priorityDisplay.name}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {activePriorities.length === 0 ? (
                    <SelectItem value={formData.priority || 'medium'} disabled>
                      {t('dialog.noPriorities', 'Keine aktiven Prioritäten konfiguriert')}
                    </SelectItem>
                  ) : (
                    activePriorities.map((p) => (
                      <SelectItem key={p.id} value={p.key}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: p.color }}
                            aria-hidden
                          />
                          {p.name}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('dialog.group', 'Team')}
              </Label>
              <Select
                value={formData.groupId || 'none'}
                onValueChange={onGroupChange}
              >
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5">
                    <Users className="w-4 h-4 text-slate-400" aria-hidden />
                    <span className="text-sm font-semibold text-[#374151]">
                      {formData.groupName ||
                        t('dialog.selectTeam', 'Team wählen (optional)')}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none">
                    {t('dialog.noTeam', 'Kein Team (System-Standard)')}
                  </SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                      {g.isDefault ? ` (${t('dialog.defaultTeam', 'Standard')})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGroup?.categoryIds?.length ? (
                <p className="text-xs text-slate-500">
                  {t(
                    'dialog.teamCategoryHint',
                    'Kategorien sind auf die dem Team zugeordneten Kategorien beschränkt.',
                  )}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('dialog.category', 'Kategorie')}
              </Label>
              <Select value={formData.categoryId || 'none'} onValueChange={onCategoryChange}>
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <span className="text-sm font-semibold text-[#374151] truncate">
                      {formData.categoryName ||
                        t('dialog.selectCategory', 'Kategorie wählen')}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="none">{t('dialog.noCategory', 'Keine Kategorie')}</SelectItem>
                  {selectableCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: cat.color || '#1B6CA8' }}
                          aria-hidden
                        />
                        {cat.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {t(
                  'dialog.categoryHint',
                  'Klassifikation des Themas — unabhängig vom Tickettyp.',
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('dialog.type', 'Tickettyp')}
              </Label>
              <Select
                value={formData.type}
                onValueChange={(v) => setFormData({ ...formData, type: v })}
                disabled={!activeTypes.length}
              >
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold"
                      style={softTintStyles(typeDisplay.color)}
                    >
                      {typeDisplay.name}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {activeTypes.length === 0 ? (
                    <SelectItem value={formData.type || 'question'} disabled>
                      {t('dialog.noTypes', 'Keine aktiven Tickettypen konfiguriert')}
                    </SelectItem>
                  ) : (
                    activeTypes.map((ty) => (
                      <SelectItem key={ty.id} value={ty.key}>
                        {ty.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {t(
                  'dialog.typeHint',
                  'Aus der Ticket-Konfiguration (Frage, Vorfall, Problem, …).',
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-600">
                {t('dialog.assignee', 'Zuständig')}
              </Label>
              <Select
                value={formData.assignee}
                onValueChange={(v) => setFormData({ ...formData, assignee: v })}
              >
                <SelectTrigger className="w-full h-11 border-slate-100 rounded-xl bg-[#F9FAFB]">
                  <div className="flex items-center gap-2.5">
                    <UserIcon className="w-4 h-4 text-slate-400" aria-hidden />
                    <span className="text-sm font-semibold text-[#374151]">{assigneeLabel}</span>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="unassigned">
                    {t('tickets.unassigned', 'Nicht zugewiesen')}
                  </SelectItem>
                  {user?.uid ? (
                    <SelectItem value={user.uid}>
                      {t('dialog.assignToMe', 'Mir zuweisen')}
                    </SelectItem>
                  ) : null}
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                {t(
                  'dialog.assigneeHint',
                  '„Nicht zugewiesen“ setzt keinen Status — nur die Zuständigkeit.',
                )}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <Label htmlFor="create-ticket-tags" className="text-sm font-semibold text-slate-600">
              {t('dialog.tags', 'Tags')}
            </Label>
            <div className="relative">
              <Input
                id="create-ticket-tags"
                placeholder={t('dialog.addTags', 'Tags hinzufügen…')}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag(tagInput);
                  }
                }}
                className="w-full h-10 border-slate-100 pr-10 text-sm rounded-xl bg-[#F9FAFB]"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                onClick={() => handleAddTag(tagInput)}
                aria-label={t('dialog.addTag', 'Tag hinzufügen')}
              >
                <Plus className="w-4 h-4" aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.tags.map((tag) => (
                <div
                  key={tag}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={t('dialog.removeTag', 'Tag entfernen') + `: ${tag}`}
                    className="hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                  >
                    <X className="w-3 h-3" aria-hidden />
                  </button>
                </div>
              ))}
              {aiMeta.suggestedTags.map(
                (tag) =>
                  !formData.tags.includes(tag) && (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => handleAddTag(tag)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 rounded-lg text-xs font-semibold border border-dashed border-slate-200 hover:opacity-100 opacity-80"
                    >
                      {tag}
                      <Plus className="w-3 h-3" aria-hidden />
                    </button>
                  ),
              )}
            </div>
          </div>

          <div className="p-4 border border-slate-200/60 rounded-2xl space-y-3 bg-white">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" aria-hidden />
              <h4 className="text-sm font-bold text-slate-700">
                {t('dialog.estimatedSla', 'Geschätztes SLA')}
              </h4>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">
                  {t('dialog.targetResolution', 'Ziel-Auflösung')}
                </span>
                <span className="text-slate-800 font-semibold">{slaInfo.date}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">
                  {t('dialog.resolutionWindow', 'Zeitfenster')}
                </span>
                <span className="text-slate-800 font-semibold">
                  {t('dialog.within', 'Innerhalb')} {slaInfo.hours}h
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
              <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" aria-hidden />
              <p className="text-xs text-slate-600 leading-relaxed">
                {t('dialog.slaBasedOnPriorityPre', 'Basierend auf Priorität')}{' '}
                <strong>{priorityDisplay.name}</strong>
                {'. '}
                {t(
                  'dialog.slaHeuristicNote',
                  'Heuristik nach Prioritäts-Schlüssel — keine Live-SLA-Policy.',
                )}
              </p>
            </div>
          </div>
        </aside>
      </form>

      <div className="px-4 sm:px-6 py-3 sm:py-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t bg-white">
        <p className="text-xs text-slate-500">
          {isDirty
            ? t('dialog.unsavedChanges', 'Ungespeicherte Änderungen')
            : draftSavedAt
              ? t('dialog.draftSavedHint', 'Entwurf gespeichert')
              : t('dialog.pressHint', 'Strg+Enter zum Veröffentlichen')}
        </p>
        <div className="flex items-center gap-3 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={handleDiscard}
            disabled={loading}
            className="text-[13px] font-semibold text-slate-600 hover:bg-slate-50 px-4 rounded-lg"
          >
            {t('dialog.discardDraft', 'Entwurf verwerfen')}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            className="text-[13px] font-bold bg-[#3B82F6] hover:bg-blue-600 text-white rounded-lg px-6 h-10 shadow-lg shadow-blue-500/25"
          >
            {loading
              ? t('dialog.publishing', 'Wird veröffentlicht…')
              : t('dialog.publishTicket', 'Ticket veröffentlichen')}
          </Button>
        </div>
      </div>
    </>
  );

  if (presentation === 'inline') {
    if (!isOpen) return null;
    return <div className={cn(INLINE_CLASS)}>{content}</div>;
  }

  if (presentation === 'drawer') {
    return (
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className={`${SHELL_CLASS} w-[1100px] sm:max-w-[1100px]`}
        >
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className={SHELL_CLASS}>
        {content}
      </DialogContent>
    </Dialog>
  );
}
