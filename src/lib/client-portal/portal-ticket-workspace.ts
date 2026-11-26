/**
 * Full Kunden-Portal ticket workspace payload + mutation helpers.
 * Org-scoped; never uses /api/db. Used by /api/portal/tickets* only.
 */

import {
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../postgres-backend.js';
import {
  buildTicketDeepDivePrompt,
  buildTicketMessagesText,
  parseTicketAnalysisOutput,
  ticketAnalysisPatch,
} from '../ticket-ai-analysis.js';
import {
  createChecklistTask,
  normalizeChecklistItems,
} from '../ticket-checklist-utils.js';
import {
  listTicketCategories,
} from '../ticket-categories/store.js';
import {
  listTicketPriorities,
  listTicketStatuses,
  listTicketTypes,
} from '../ticket-config/store.js';
import { createTimeEntry, listTimeEntriesByTicket, summarizeEntries } from '../time-tracking/store.js';
import type { TimeEntryInput } from '../time-tracking/types.js';
import type { TicketChecklistItem } from '../../types/index.js';
import { getOrganization } from './organizations.js';
import { isClientOrgWideTicketRole } from './roles.js';
import { listOrganizationUsers } from './team-service.js';
import {
  filterMessagesForClient,
  isInternalMessage,
  sanitizeTicketForClient,
  ticketOrganizationId,
  type ClientSessionContext,
} from './ticket-visibility.js';
import {
  sortMessagesOldestFirst,
  sanitizeMessageForClientPortal,
} from './portal-ticket-api.js';

export function portalCanSeeInternalNotes(role: string): boolean {
  return isClientOrgWideTicketRole(role);
}

/** Ticket fields for portal Eigenschaften + workspace tabs (AI included). */
export function sanitizeTicketForPortalWorkspace(
  ticket: Record<string, unknown>,
): Record<string, unknown> {
  const base = sanitizeTicketForClient(ticket) as Record<string, unknown>;
  // Re-attach workspace AI / Eigenschaften fields stripped by list sanitizer.
  const aiSummary = ticket.aiSummary ?? ticket.ai_summary ?? null;
  const aiInsights = ticket.aiInsights ?? ticket.ai_insights ?? null;
  const aiRootCause = ticket.aiRootCause ?? ticket.ai_root_cause ?? null;
  const aiChecklist = ticket.aiChecklist ?? ticket.ai_checklist ?? null;
  const aiSentiment = ticket.aiSentiment ?? ticket.ai_sentiment ?? null;
  const suggestedReply =
    ticket.aiSuggestedDraft ?? ticket.suggested_reply ?? ticket.suggestedReply ?? null;
  const accountHealth = ticket.accountHealth ?? ticket.account_health ?? null;
  const slaTier = ticket.slaTier ?? ticket.sla_tier ?? null;
  const assigneeId =
    ticket.assigneeId ?? ticket.assignee_id ?? ticket.assignedTo ?? ticket.assigned_to ?? null;
  const ticketType = ticket.type ?? ticket.ticket_type ?? ticket.ticketType ?? null;
  const escalated = ticket.escalated === true || ticket.isEscalated === true;
  const supportLevel =
    ticket.support_level ?? ticket.supportLevel ?? ticket.assigned_queue ?? ticket.assignedQueue ?? null;

  return {
    ...base,
    aiSummary,
    ai_summary: aiSummary,
    aiInsights,
    ai_insights: aiInsights,
    aiRootCause,
    ai_root_cause: aiRootCause,
    aiChecklist: normalizeChecklistItems(
      Array.isArray(aiChecklist) ? (aiChecklist as TicketChecklistItem[]) : [],
    ),
    ai_checklist: normalizeChecklistItems(
      Array.isArray(aiChecklist) ? (aiChecklist as TicketChecklistItem[]) : [],
    ),
    aiSentiment,
    ai_sentiment: aiSentiment,
    suggested_reply: suggestedReply ? String(suggestedReply) : null,
    suggestedReply: suggestedReply ? String(suggestedReply) : null,
    accountHealth,
    account_health: accountHealth,
    slaTier,
    sla_tier: slaTier,
    assigneeId: assigneeId ? String(assigneeId) : null,
    assignee_id: assigneeId ? String(assigneeId) : null,
    ticket_type: ticketType ? String(ticketType) : null,
    type: ticketType ? String(ticketType) : base.type ?? null,
    escalated,
    support_level: supportLevel ? String(supportLevel) : null,
    supportLevel: supportLevel ? String(supportLevel) : null,
    assigned_queue: supportLevel ? String(supportLevel) : null,
    assignedQueue: supportLevel ? String(supportLevel) : null,
    category: base.categoryName ?? base.category ?? ticket.category ?? null,
    categoryId: base.categoryId ?? ticket.categoryId ?? null,
    categoryName: base.categoryName ?? ticket.categoryName ?? null,
  };
}

export function filterMessagesForPortalRole(
  messages: Array<Record<string, unknown>>,
  role: string,
): Array<Record<string, unknown>> {
  const sorted = sortMessagesOldestFirst(messages);
  if (portalCanSeeInternalNotes(role)) {
    return sorted.map((m) => {
      const clone = { ...m };
      const internal = isInternalMessage(m);
      clone.is_internal = internal;
      clone.isInternal = internal;
      delete clone.aiCritiqueLog;
      return clone;
    });
  }
  return filterMessagesForClient(sorted).map(sanitizeMessageForClientPortal);
}

export function buildPortalCustomerSummary(params: {
  ticket: Record<string, unknown>;
  organization: Awaited<ReturnType<typeof getOrganization>> | null;
}) {
  const t = params.ticket;
  const org = params.organization;
  return {
    name: String(t.customerName || t.customer_name || '').trim() || null,
    email: String(t.customerEmail || t.customer_email || t.from_email || '').trim() || null,
    customerId: String(t.customerId || t.customer_id || '').trim() || null,
    requesterId: String(t.requesterId || t.requester_id || t.creatorId || '').trim() || null,
    organization: org
      ? {
          id: org.id,
          name: org.name,
          slug: org.slug,
          domain: org.domain,
          tier: org.tier,
          sla: org.sla,
          industry: org.industry,
          website: org.website,
        }
      : null,
  };
}

export function buildPortalVerlauf(params: {
  ticket: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  includeInternalNotes: boolean;
}) {
  const events: Array<Record<string, unknown>> = [];
  const createdAt = String(params.ticket.createdAt || params.ticket.created_at || '');
  if (createdAt) {
    events.push({
      id: 'created',
      kind: 'ticket_created',
      at: createdAt,
      label: 'Ticket erstellt',
      actor: params.ticket.customerName || params.ticket.creatorId || null,
    });
  }

  for (const msg of params.messages) {
    const internal = isInternalMessage(msg);
    if (internal && !params.includeInternalNotes) continue;
    events.push({
      id: String(msg.id || `msg-${events.length}`),
      kind: internal ? 'internal_note' : 'message',
      at: String(msg.createdAt || msg.created_at || ''),
      label: internal ? 'Interne Notiz' : 'Nachricht',
      actor: msg.senderName || msg.senderId || null,
      contentPreview: String(msg.content || '').slice(0, 240),
      is_internal: internal,
    });
  }

  const activityRaw =
    params.ticket.activityLog ?? params.ticket.activity_log ?? params.ticket.ticketActivity;
  if (Array.isArray(activityRaw)) {
    for (const entry of activityRaw) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      events.push({
        id: String(e.id || `act-${events.length}`),
        kind: String(e.kind || 'note'),
        at: String(e.at || e.createdAt || ''),
        label: String(e.label || e.message || ''),
        actor: e.actor != null ? String(e.actor) : null,
        meta: e.meta && typeof e.meta === 'object' ? e.meta : undefined,
      });
    }
  }

  const resolvedAt = String(params.ticket.resolvedAt || params.ticket.resolved_at || '');
  if (resolvedAt) {
    events.push({
      id: 'resolved',
      kind: 'status',
      at: resolvedAt,
      label: 'Gelöst / geschlossen',
      actor: null,
      status: params.ticket.status || null,
    });
  }

  return events.sort(
    (a, b) =>
      new Date(String(a.at || 0)).getTime() - new Date(String(b.at || 0)).getTime(),
  );
}

export async function loadPortalTicketAssets(
  ticketId: string,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const items = await getDocsDirect('vault_items', []);
  return items
    .filter((item) => {
      const meta = (item.metadata || {}) as Record<string, unknown>;
      const related =
        String(meta.relatedTicketId || meta.related_ticket_id || item.relatedTicketId || '') ===
        ticketId;
      if (!related) return false;
      const org =
        String(
          item.organizationId ||
            item.organization_id ||
            meta.organizationId ||
            meta.organization_id ||
            '',
        ).trim() || null;
      // Prefer explicit org match; allow legacy rows without org if ticket-linked.
      return !org || org === organizationId;
    })
    .map((item) => ({
      id: String(item.id),
      name: item.name || item.title || item.label || 'Asset',
      type: item.type || item.category || null,
      createdAt: item.createdAt || item.created_at || null,
      metadata: {
        relatedTicketId: ticketId,
      },
    }));
}

export async function loadPortalNeuralLinks(
  ticket: Record<string, unknown>,
  organizationId: string,
): Promise<Array<Record<string, unknown>>> {
  const rawIds = Array.isArray(ticket.linkedTicketIds)
    ? ticket.linkedTicketIds
    : Array.isArray(ticket.related_tickets)
      ? ticket.related_tickets
      : [];
  const ids = rawIds.map((v) => String(v || '').trim()).filter(Boolean);
  if (ids.length === 0) return [];

  const links: Array<Record<string, unknown>> = [];
  for (const id of ids) {
    const other = await getDocDirect('tickets', id);
    if (!other) continue;
    if (ticketOrganizationId(other) !== organizationId) continue;
    links.push({
      id,
      subject: other.subject || null,
      status: other.status || null,
      priority: other.priority || null,
      customId: other.customId || other.custom_id || null,
      updatedAt: other.updatedAt || other.updated_at || null,
    });
  }
  return links;
}

export async function loadPortalTicketMeta(organizationId: string) {
  const [members, statuses, priorities, categories, ticketTypes] = await Promise.all([
    listOrganizationUsers(organizationId),
    listTicketStatuses({ activeOnly: true }),
    listTicketPriorities({ activeOnly: true }),
    listTicketCategories({ activeOnly: true }),
    listTicketTypes({ activeOnly: true }),
  ]);

  const agents = members
    .filter((m) => m.isActive && (m.role === 'CLIENT_ADMIN' || m.role === 'CLIENT_SUPPORTER'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
    }));

  return {
    agents,
    statuses: statuses.map((s) => ({
      id: s.id,
      key: s.key,
      name: s.name,
      color: s.color,
      workflowKind: s.workflowKind,
      sortOrder: s.sortOrder,
    })),
    priorities: priorities.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      color: p.color,
      sortOrder: p.sortOrder,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      color: (c as any).color || null,
    })),
    ticket_types: ticketTypes.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      color: t.color,
      sortOrder: t.sortOrder,
    })),
  };
}

export async function buildPortalTicketWorkspaceDetail(params: {
  session: ClientSessionContext;
  ticket: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  participants: Array<{
    ticket_id: string;
    user_id: string;
    added_by: string | null;
    created_at: string;
  }>;
}) {
  const { session, ticket, messages, participants } = params;
  const includeInternal = portalCanSeeInternalNotes(session.role);
  const orgId = session.organizationId!;
  const ticketId = String(ticket.id);

  const [organization, assets, neuralLinks, timeEntries, meta] = await Promise.all([
    getOrganization(orgId),
    loadPortalTicketAssets(ticketId, orgId),
    loadPortalNeuralLinks(ticket, orgId),
    listTimeEntriesByTicket(ticketId),
    loadPortalTicketMeta(orgId),
  ]);

  const workspaceTicket = sanitizeTicketForPortalWorkspace({ ...ticket, id: ticketId });
  const visibleMessages = filterMessagesForPortalRole(messages, session.role);
  const tasks = normalizeChecklistItems(
    Array.isArray(workspaceTicket.aiChecklist)
      ? (workspaceTicket.aiChecklist as TicketChecklistItem[])
      : [],
  );
  const verlauf = buildPortalVerlauf({
    ticket,
    messages: visibleMessages,
    includeInternalNotes: includeInternal,
  });
  const customer = buildPortalCustomerSummary({ ticket, organization });
  const aiInsights = {
    summary: workspaceTicket.aiSummary || null,
    insights: Array.isArray(workspaceTicket.aiInsights) ? workspaceTicket.aiInsights : [],
    rootCause: workspaceTicket.aiRootCause || null,
    sentiment: workspaceTicket.aiSentiment || null,
    suggestedReply: workspaceTicket.suggested_reply || null,
    accountHealth: workspaceTicket.accountHealth || null,
  };

  return {
    ticket: workspaceTicket,
    messages: visibleMessages,
    participants,
    attachments: Array.isArray(workspaceTicket.attachments) ? workspaceTicket.attachments : [],
    customer,
    verlauf,
    activity_log: verlauf,
    aiInsights,
    ai_insights: aiInsights,
    assets,
    neuralLinks,
    related_tickets: neuralLinks,
    tasks,
    timeEntries,
    time_entries: timeEntries,
    timeSummary: summarizeEntries(timeEntries),
    meta,
  };
}

export async function runPortalTicketAiSync(params: {
  session: ClientSessionContext;
  ticket: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
  forceRefresh?: boolean;
}): Promise<{ ticket: Record<string, unknown>; aiInsights: Record<string, unknown> }> {
  const ticketId = String(params.ticket.id);
  const publicMessages = filterMessagesForClient(params.messages);
  const messagesText = buildTicketMessagesText(
    publicMessages.map((m) => ({
      senderName: String(m.senderName || ''),
      senderType: String(m.senderType || ''),
      content: String(m.content || ''),
    })),
  );
  let prompt = buildTicketDeepDivePrompt(
    {
      subject: String(params.ticket.subject || ''),
      description: String(params.ticket.description || ''),
      sentiment: String(params.ticket.sentiment || params.ticket.aiSentiment || ''),
    },
    messagesText,
  );

  // Strict per-org RAG grounding — never search another customer's vectors.
  const organizationId = String(params.session.organizationId || '').trim();
  if (organizationId) {
    try {
      const { resolveTenantIdForOrganization } = await import('./portal-kb-workspace.js');
      const { getOrganization } = await import('./organizations.js');
      const { resolveIncludeSharedKbInRag } = await import('../ai/rag-org-scope.js');
      const { hybridSearchKnowledge } = await import('../ai/ki-orchestrator.js');
      const org = await getOrganization(organizationId);
      const includeSharedKb = resolveIncludeSharedKbInRag(org);
      const ragTenantId = resolveTenantIdForOrganization(organizationId);
      const hits = await hybridSearchKnowledge({
        query: `${params.ticket.subject || ''} ${params.ticket.description || ''}`.slice(0, 4000),
        tenantId: ragTenantId,
        organizationId,
        includeSharedKb,
        limit: 5,
        sourceTypes: ['KB_ARTICLE'],
      });
      if (hits.length > 0) {
        const ragBlock = hits
          .map(
            (h, idx) =>
              `[KB ${idx + 1}] ${h.title} (id=${h.sourceId})\n${String(h.chunkContent || '').slice(0, 800)}`,
          )
          .join('\n\n');
        prompt = `${prompt}\n\n--- Org-scoped Wissensdatenbank (RAG) ---\n${ragBlock}`;
      }
    } catch {
      /* RAG optional — AI sync still runs without vectors */
    }
  }

  const { executeAiFeatureRequest, requireLifecycleOutput } = await import(
    '../ai-orchestrator-service.js'
  );
  const result = await executeAiFeatureRequest({
    workspaceId: 'default',
    feature: 'ticket_summarization',
    prompt,
    userId: params.session.id,
    ticketId,
    customerId: params.session.organizationId || undefined,
    customerScope: params.session.organizationId || undefined,
    metadata: {
      source: 'portal_ai_sync',
      organizationId: params.session.organizationId,
    },
    forceRefresh: params.forceRefresh === true,
    skipCache: params.forceRefresh === true,
  } as any);

  const output = requireLifecycleOutput(result);
  const parsed = parseTicketAnalysisOutput(output, {
    subject: String(params.ticket.subject || ''),
    description: String(params.ticket.description || ''),
  });
  const patch = {
    ...ticketAnalysisPatch(parsed),
    updatedAt: new Date().toISOString(),
  };
  await updateDocDirect('tickets', ticketId, patch);
  const updated = (await getDocDirect('tickets', ticketId)) || { ...params.ticket, ...patch };
  const workspaceTicket = sanitizeTicketForPortalWorkspace({ ...updated, id: ticketId });
  return {
    ticket: workspaceTicket,
    aiInsights: {
      summary: workspaceTicket.aiSummary || null,
      insights: Array.isArray(workspaceTicket.aiInsights) ? workspaceTicket.aiInsights : [],
      rootCause: workspaceTicket.aiRootCause || null,
      sentiment: workspaceTicket.aiSentiment || null,
      suggestedReply: workspaceTicket.suggested_reply || null,
      accountHealth: workspaceTicket.accountHealth || null,
    },
  };
}

export function readTicketChecklist(ticket: Record<string, unknown>): TicketChecklistItem[] {
  return normalizeChecklistItems(
    Array.isArray(ticket.aiChecklist)
      ? (ticket.aiChecklist as TicketChecklistItem[])
      : Array.isArray(ticket.ai_checklist)
        ? (ticket.ai_checklist as TicketChecklistItem[])
        : [],
  );
}

export async function persistTicketChecklist(
  ticketId: string,
  items: TicketChecklistItem[],
): Promise<TicketChecklistItem[]> {
  const normalized = normalizeChecklistItems(items);
  await updateDocDirect('tickets', ticketId, {
    aiChecklist: normalized,
    updatedAt: new Date().toISOString(),
  });
  return normalized;
}

export async function addPortalTicketTask(
  ticket: Record<string, unknown>,
  taskText: string,
): Promise<TicketChecklistItem[]> {
  const items = readTicketChecklist(ticket);
  items.push(createChecklistTask(taskText, 'manual'));
  return persistTicketChecklist(String(ticket.id), items);
}

export async function patchPortalTicketTask(
  ticket: Record<string, unknown>,
  taskId: string,
  patch: { task?: string; completed?: boolean },
): Promise<TicketChecklistItem[]> {
  const items = readTicketChecklist(ticket);
  const idx = items.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error('Aufgabe nicht gefunden.');
  const next = { ...items[idx] };
  if (patch.task !== undefined) next.task = String(patch.task).trim();
  if (patch.completed !== undefined) next.completed = Boolean(patch.completed);
  items[idx] = next;
  return persistTicketChecklist(String(ticket.id), items);
}

export async function deletePortalTicketTask(
  ticket: Record<string, unknown>,
  taskId: string,
): Promise<TicketChecklistItem[]> {
  const items = readTicketChecklist(ticket).filter((t) => t.id !== taskId);
  return persistTicketChecklist(String(ticket.id), items);
}

export async function addPortalTimeEntry(params: {
  ticket: Record<string, unknown>;
  session: ClientSessionContext;
  agentName: string;
  input: TimeEntryInput;
}) {
  return createTimeEntry({
    input: {
      ...params.input,
      ticketId: String(params.ticket.id),
      ticketNumber: String(
        params.ticket.customId || params.ticket.custom_id || params.ticket.id || '',
      ),
      ticketSubject: String(params.ticket.subject || ''),
      customerCompany: String(
        params.ticket.customerName || params.ticket.company || params.ticket.customerCompany || '',
      ),
    },
    userId: params.session.id,
    agentName: params.agentName,
  });
}
