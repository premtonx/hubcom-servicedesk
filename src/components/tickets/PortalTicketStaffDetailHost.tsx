/**
 * Kunden-Portal ticket detail — mounts the exact staff TicketDetailView +
 * TicketDetailContextPane. All I/O via /api/portal/tickets* (zero /api/db).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TicketDetailView } from './TicketDetailView';
import { TicketDetailContextPane } from './TicketDetailContextPane';
import { useClientPortalSession } from '../../hooks/useClientPortalSession';
import { usePortalTicketDetailAdapter } from '../../hooks/usePortalTicketDetailAdapter';
import {
  PORTAL_TICKET_DETAIL_CAPABILITIES,
  PORTAL_TICKET_DETAIL_CAPABILITIES_CLIENT_USER,
  type PortalTicketDetailPayload,
  type PortalTicketWorkspaceMeta,
  type TicketDetailWorkbenchCapabilities,
} from '../../lib/tickets/ticket-detail-workbench-adapter';
import type { Ticket as TicketType, TicketChecklistItem, Message, Contact, Company } from '../../types';
import type { AIAdapter } from '../../lib/ai/provider-adapter';
import type { TicketStatusConfig, TicketPriorityConfig } from '../../lib/ticket-config/types';
import { normalizeChecklistItems } from '../../lib/ticket-checklist-utils';

const STUB_AI = {
  improveTone: async (text: string) => text,
  translate: async (text: string) => text,
} as unknown as AIAdapter;

function emptyMeta(): PortalTicketWorkspaceMeta {
  return {
    agents: [],
    statuses: [],
    priorities: [],
    categories: [],
    ticket_types: [],
  };
}

function mapStatuses(meta: PortalTicketWorkspaceMeta): TicketStatusConfig[] {
  return (meta.statuses || []).map((s, i) => ({
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
  }));
}

function mapPriorities(meta: PortalTicketWorkspaceMeta): TicketPriorityConfig[] {
  return (meta.priorities || []).map((p, i) => ({
    id: p.id || p.key,
    key: p.key,
    name: p.name,
    description: '',
    color: p.color || '#64748b',
    sortOrder: p.sortOrder ?? i,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  }));
}

function deriveContact(payload: PortalTicketDetailPayload): Contact | null {
  const c = payload.customer;
  if (!c || typeof c !== 'object') {
    const t = payload.ticket;
    if (!t.customerName && !t.customerEmail) return null;
    return {
      id: String(t.customerId || t.requesterId || ''),
      name: String(t.customerName || ''),
      email: String(t.customerEmail || ''),
    } as Contact;
  }
  return {
    id: String((c as any).id || (c as any).userId || ''),
    name: String((c as any).name || payload.ticket.customerName || ''),
    email: String((c as any).email || payload.ticket.customerEmail || ''),
  } as Contact;
}

function deriveCompany(payload: PortalTicketDetailPayload): Company | null {
  const c = payload.customer;
  const name =
    (c && typeof c === 'object' && String((c as any).companyName || (c as any).organizationName || '')) ||
    String(payload.ticket.company || '');
  if (!name) return null;
  return { id: String((c as any)?.organizationId || ''), name } as Company;
}

function tasksToChecklist(
  tasks: PortalTicketDetailPayload['tasks'],
): TicketChecklistItem[] {
  return normalizeChecklistItems(
    (tasks || []).map((t) => ({
      id: t.id,
      task: t.task,
      completed: Boolean(t.completed),
      source: (t.source as TicketChecklistItem['source']) || 'manual',
    })),
  );
}

export function PortalTicketStaffDetailHost({
  ticketId,
  capabilities: capabilitiesProp,
}: {
  ticketId: string;
  capabilities?: TicketDetailWorkbenchCapabilities;
}) {
  const { session, isOrgWide, isClientAdmin } = useClientPortalSession();
  const isClientUser = String(session?.role || '') === 'CLIENT_USER';
  const adapter = usePortalTicketDetailAdapter({ loadMembers: isOrgWide });

  const capabilities =
    capabilitiesProp ||
    (isClientUser
      ? {
          ...PORTAL_TICKET_DETAIL_CAPABILITIES_CLIENT_USER,
          emailComposer: true,
          staffContextPane: true,
          portalPropertiesPane: false,
          portalPublicReply: false,
        }
      : {
          ...PORTAL_TICKET_DETAIL_CAPABILITIES,
          emailComposer: true,
          staffContextPane: true,
          portalPropertiesPane: false,
          portalPublicReply: false,
          canManageParticipants: isOrgWide,
          canMarkClosed: isClientAdmin || isOrgWide,
          canEditAssignee: isOrgWide,
          canEditProperties: isOrgWide,
          canUpdatePriority: isOrgWide,
          internalNotes: isOrgWide,
          aiSync: isOrgWide,
          convertToKb: isOrgWide,
        });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<PortalTicketWorkspaceMeta>(emptyMeta());
  const [aiSummary, setAiSummary] = useState('');
  const [timeEntries, setTimeEntries] = useState<Array<Record<string, unknown>>>([]);
  const [assets, setAssets] = useState<Array<Record<string, unknown>>>([]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [company, setCompany] = useState<Company | null>(null);

  const [activeDetailTab, setActiveDetailTab] = useState('conversation');
  const [isComposerExpanded, setIsComposerExpanded] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [newAgentComment, setNewAgentComment] = useState('');
  const [areNotesExpanded, setAreNotesExpanded] = useState(false);
  const [isMobilePropertiesOpen, setIsMobilePropertiesOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [linkInput, setLinkInput] = useState('');

  const reload = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await adapter.getDetail!(ticketId);
      const checklist = tasksToChecklist(payload.tasks);
      const nextTicket: TicketType = {
        ...payload.ticket,
        aiChecklist: checklist,
        aiSummary:
          payload.aiInsights?.summary ||
          payload.ticket.aiSummary ||
          '',
        aiInsights: Array.isArray(payload.aiInsights?.insights)
          ? (payload.aiInsights!.insights as string[])
          : payload.ticket.aiInsights,
        aiSuggestedDraft:
          payload.aiInsights?.suggestedReply || payload.ticket.aiSuggestedDraft,
        sentiment:
          (payload.aiInsights?.sentiment as TicketType['sentiment']) ||
          payload.ticket.sentiment,
      };
      setTicket(nextTicket);
      setMessages((payload.messages || []) as Message[]);
      setMeta(payload.meta || emptyMeta());
      setAiSummary(String(nextTicket.aiSummary || ''));
      setTimeEntries(payload.timeEntries || []);
      setAssets(payload.assets || []);
      setContact(deriveContact(payload));
      setCompany(deriveCompany(payload));
    } catch (err: any) {
      setError(err?.message || 'Ticket konnte nicht geladen werden.');
      setTicket(null);
    } finally {
      setLoading(false);
    }
  }, [adapter, ticketId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const statusConfigs = useMemo(() => mapStatuses(meta), [meta]);
  const priorityConfigs = useMemo(() => mapPriorities(meta), [meta]);

  const portalUser = useMemo(
    () =>
      session
        ? {
            uid: session.id,
            displayName: session.name || session.email,
            email: session.email,
          }
        : null,
    [session],
  );

  const ticketServiceShim = useMemo(
    () => ({
      updateTicket: async (id: string, data: Partial<TicketType>) => {
        const updated = await adapter.updateFields!(id, {
          status: data.status as any,
          priority: data.priority as any,
          assignee_id:
            data.assigneeId != null
              ? String(data.assigneeId)
              : data.agentId != null
                ? String(data.agentId)
                : undefined,
          categoryId: data.categoryId != null ? String(data.categoryId) : undefined,
          category:
            (data as any).category != null ? String((data as any).category) : undefined,
          ticket_type: (data as any).ticket_type ?? (data as any).type,
          sla_tier: data.slaTier != null ? String(data.slaTier) : undefined,
          account_health: data.accountHealth != null ? String(data.accountHealth) : undefined,
          escalated: (data as any).escalated,
          support_level:
            (data as any).support_level ??
            (data as any).supportLevel ??
            (data as any).assigned_queue ??
            (data as any).assignedQueue,
          supportLevel:
            (data as any).supportLevel ??
            (data as any).support_level ??
            (data as any).assignedQueue ??
            (data as any).assigned_queue,
        });
        if (updated) setTicket((prev) => (prev ? { ...prev, ...updated } : updated));
        return { success: true, ticket: updated || undefined };
      },
      addAgentComment: async (
        id: string,
        comment: { content: string; agentId?: string; agentName?: string },
      ) => {
        if (!capabilities.internalNotes) {
          throw new Error('Interne Notizen nicht erlaubt.');
        }
        await adapter.reply!(id, {
          content: comment.content,
          senderName: comment.agentName,
          is_internal: true,
        });
        await reload();
      },
      getTicket: async (id: string) => {
        const payload = await adapter.getDetail!(id);
        return payload.ticket;
      },
    }),
    [adapter, capabilities.internalNotes, reload],
  );

  const handleInlineUpdate = useCallback(
    async (id: string, data: Partial<TicketType>) => {
      if (!capabilities.canEditProperties && !capabilities.canUpdateStatus) return;
      try {
        await ticketServiceShim.updateTicket(id, data);
      } catch (err: any) {
        toast.error(err?.message || 'Speichern fehlgeschlagen.');
      }
    },
    [capabilities.canEditProperties, capabilities.canUpdateStatus, ticketServiceShim],
  );

  const handleChecklistUpdated = useCallback((checklist: TicketChecklistItem[]) => {
    setTicket((prev) => (prev ? { ...prev, aiChecklist: checklist } : prev));
  }, []);

  const taskApi = useMemo(
    () => ({
      toggle: async (id: string, taskId: string) => {
        const current = normalizeChecklistItems(ticket?.aiChecklist);
        const item = current.find((t) => t.id === taskId);
        const next = await adapter.updateTask!(id, taskId, {
          completed: !item?.completed,
        });
        return tasksToChecklist(next);
      },
      add: async (id: string, text: string) => {
        const next = await adapter.addTask!(id, text);
        return tasksToChecklist(next);
      },
      update: async (id: string, taskId: string, text: string) => {
        const next = await adapter.updateTask!(id, taskId, { task: text });
        return tasksToChecklist(next);
      },
      remove: async (id: string, taskId: string) => {
        const next = await adapter.deleteTask!(id, taskId);
        return tasksToChecklist(next);
      },
    }),
    [adapter, ticket?.aiChecklist],
  );

  const updateSummary = useCallback(
    async (force?: boolean) => {
      if (!capabilities.aiSync) return;
      setIsAiDrafting(true);
      try {
        const result = await adapter.aiSync!(ticketId, { forceRefresh: Boolean(force) });
        setTicket((prev) =>
          prev
            ? {
                ...prev,
                ...result.ticket,
                aiSummary: result.aiInsights?.summary || result.ticket.aiSummary || prev.aiSummary,
                aiSuggestedDraft:
                  result.aiInsights?.suggestedReply ||
                  result.ticket.aiSuggestedDraft ||
                  prev.aiSuggestedDraft,
              }
            : result.ticket,
        );
        if (result.aiInsights?.summary) setAiSummary(String(result.aiInsights.summary));
      } finally {
        setIsAiDrafting(false);
      }
    },
    [adapter, capabilities.aiSync, ticketId],
  );

  const handleSendReply = useCallback(
    async (metaSend?: { fromAddress?: string; fromChannelId?: string; cc?: string[] }) => {
      const body = replyText.trim();
      if (!body) return;
      try {
        await adapter.reply!(ticketId, {
          content: body,
          senderName: session?.name || session?.email,
          is_internal: false,
        });
        setReplyText('');
        toast.success('Antwort gesendet.');
        void metaSend;
        await reload();
      } catch (err: any) {
        toast.error(err?.message || 'Antwort fehlgeschlagen.');
      }
    },
    [adapter, reload, replyText, session, ticketId],
  );

  const handleAddTimeEntry = useCallback(
    async (payload: {
      hours: number;
      description?: string;
      date?: string;
      kuerzel?: string;
      sonderzahlung?: boolean;
    }) => {
      const entry = await adapter.addTimeEntry!(ticketId, payload);
      setTimeEntries((prev) => [...prev, entry]);
      return entry;
    },
    [adapter, ticketId],
  );

  if (loading && !ticket) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        Ticket wird geladen…
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium text-slate-600">{error || 'Ticket nicht gefunden.'}</p>
        <button
          type="button"
          className="text-sm font-bold text-sky-700 hover:text-sky-900"
          onClick={() => adapter.openBack?.()}
        >
          Zurück zur Liste
        </button>
      </div>
    );
  }

  const showAi = capabilities.aiSync;
  const showKb = capabilities.convertToKb;

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-row overflow-hidden">
      <TicketDetailView
        portalMode
        portalCapabilities={capabilities}
        statusConfigs={statusConfigs}
        priorityConfigs={priorityConfigs}
        taskApi={taskApi}
        portalTimeEntries={timeEntries}
        portalAssets={assets}
        onAddPortalTimeEntry={handleAddTimeEntry}
        selectedTicket={ticket}
        ticketContact={contact}
        ticketCompany={company}
        contactSchema={[]}
        messages={messages}
        allTickets={[ticket]}
        activeDetailTab={activeDetailTab}
        setActiveDetailTab={setActiveDetailTab}
        isAiReady={showAi}
        isAiDrafting={isAiDrafting}
        isTranslating={false}
        translatedTicket={null}
        aiSummary={aiSummary}
        aiSources={[]}
        suggestedNeuralLinks={[]}
        isFindingNeuralLinks={false}
        linkInput={linkInput}
        setLinkInput={setLinkInput}
        isComposerExpanded={isComposerExpanded}
        setIsComposerExpanded={setIsComposerExpanded}
        replyText={replyText}
        setReplyText={setReplyText}
        newAgentComment={newAgentComment}
        setNewAgentComment={setNewAgentComment}
        areNotesExpanded={areNotesExpanded}
        setAreNotesExpanded={setAreNotesExpanded}
        user={portalUser}
        ticketService={ticketServiceShim}
        setAllTickets={() => undefined}
        setSelectedTicketId={() => undefined}
        updateSummary={updateSummary}
        handleChecklistUpdated={handleChecklistUpdated}
        handleInlineUpdate={handleInlineUpdate}
        findNeuralLinks={() => undefined}
        linkTicket={() => undefined}
        unlinkTicket={() => undefined}
        generateAiReply={() => undefined}
        handleSendReply={handleSendReply}
        acceptGhostDraft={() => undefined}
        ghostDraft={null}
        isGhostDrafting={false}
        legalViolation={null}
        setLegalViolation={() => undefined}
        isValidatingLegal={false}
        aiDraftMeta={null}
        ai={STUB_AI}
        translationMood=""
        closeFullTicketView={() => adapter.openBack?.()}
        isMobilePropertiesOpen={isMobilePropertiesOpen}
        setIsMobilePropertiesOpen={setIsMobilePropertiesOpen}
        onConvertToKB={
          showKb
            ? () => adapter.openConvertToKb?.(ticket)
            : undefined
        }
        isKbDrafting={false}
      />
      {capabilities.staffContextPane ? (
        <TicketDetailContextPane
          portalMode
          portalMeta={meta}
          portalCapabilities={capabilities}
          selectedTicket={ticket}
          ticketContact={contact}
          ticketCompany={company}
          isMobilePropertiesOpen={isMobilePropertiesOpen}
          setIsMobilePropertiesOpen={setIsMobilePropertiesOpen}
          isAiReady={showAi}
          isAiDrafting={isAiDrafting}
          generateAiReply={() => undefined}
          handleConvertToKB={() => {
            if (showKb) adapter.openConvertToKb?.(ticket);
          }}
          suggestedNeuralLinks={[]}
          linkTicket={() => undefined}
          unlinkTicket={() => undefined}
          newTagInput={newTagInput}
          setNewTagInput={setNewTagInput}
          initiateHandoff={() => undefined}
          suggestedTags={[]}
          allTickets={[ticket]}
          handleInlineUpdate={handleInlineUpdate}
        />
      ) : null}
    </div>
  );
}

export default PortalTicketStaffDetailHost;
