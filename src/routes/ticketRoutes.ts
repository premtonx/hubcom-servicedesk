import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { attachClientOrganizationContext } from '../middleware/clientPortalMiddleware.js';
import { getDocDirect, updateDocDirect } from '../lib/postgres-backend.js';
import { routeParam } from '../lib/route-params.js';
import { safeLog } from '../lib/safe-log.js';
import { resolveTenantFromRequest, documentBelongsToTenant } from '../lib/tenant-context.js';
import { isClientPortalRole } from '../lib/client-portal/roles.js';
import {
  clientCanMutateTicket,
  resolveOrganizationIdFromUser,
  sanitizeTicketForClient,
  stripClientSpoofFields,
} from '../lib/client-portal/ticket-visibility.js';
import { normalizeAssigneePatchForWrite } from '../lib/ticketAssignee.js';
import { stampStaffTicketOrganizationFields } from '../lib/client-portal/stamp-ticket-organization.js';
import {
  getHardwareReturnByTicketId,
  sanitizeHardwareReturnForClient,
  upsertHardwareReturn,
} from '../lib/client-portal/hardware-returns.js';
import { getOrganization } from '../lib/client-portal/organizations.js';
import { ticketOrganizationId } from '../lib/client-portal/ticket-visibility.js';
import {
  buildSupportLevelPatch,
  normalizeTicketSupportLevel,
} from '../lib/client-portal/second-level-notify.js';
import { maybeNotifySecondLevelAfterTicketPatch } from '../lib/client-portal/second-level-notify-hook.js';

const router = Router();

const ASSIGNEE_FIELDS = ['agentId', 'agentName', 'assignedTo', 'assigneeId', 'assignedToEmail'] as const;

const ticketStatusSchema = z.enum([
  'open', 'pending', 'in_progress', 'resolved', 'closed', 'deleted', 'spam', 'merged', 'trash',
  'qs', 'paused', 'on-hold', 'on_hold', 'waiting_customer', 'waiting_dev', 'waiting_vendor',
]);

const ticketPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

/** Fields that may be set even when not previously present on the ticket. */
const ALLOWED_NEW_FIELDS = new Set([
  'agentId', 'agentName', 'assignedTo', 'assigneeId', 'assignedToEmail',
  'status', 'priority', 'type', 'tags', 'groupId', 'groupName',
  'categoryId', 'categoryName', 'categorySlug',
  'internalNotes', 'include_in_rag', 'resolvedAt', 'mergedIntoId',
  'linkedTicketIds', 'isMasterTicket', 'masterTicketId',
  'aiSummary', 'aiInsights', 'aiRootCause', 'aiChecklist', 'aiSentiment',
  'accountHealth', 'slaTier', 'isHelpRequested',
  'aiSuggestedDraft', 'aiDraftRaw', 'aiConfidenceScore', 'aiCritiqueLog',
  'aiExecutionStatus', 'updatedAt',
  // 2nd-Level-Support queue / escalation target
  'support_level', 'supportLevel', 'assigned_queue', 'assignedQueue',
  'escalated', 'isEscalated',
  'activityLog', 'activity_log',
  // Portal visibility + Kunde tab — must be storable even on legacy tickets.
  'organizationId', 'organization_id',
  'companyId', 'company_id', 'company',
  'requesterId', 'requester_id',
  'customerEmail', 'customerName', 'customerId', 'contactId',
]);

/**
 * PATCH /api/tickets/:id
 * Update a ticket (assignee, status, priority, …) directly on the PostgreSQL
 * backend. Persists agentId/agentName plus the alias fields (assignedTo,
 * assigneeId, assignedToEmail) so every consumer sees the same assignee.
 * Returns the updated ticket: { success: true, ticket }.
 */
router.patch('/:id', authenticate, attachClientOrganizationContext, async (req: Request, res: Response): Promise<any> => {
  const ticketId = routeParam(req.params.id);
  if (!ticketId) return res.status(400).json({ error: 'Ticket id is required.' });

  const body = (
    isClientPortalRole(req.user?.role)
      ? stripClientSpoofFields((req.body || {}) as Record<string, unknown>)
      : (req.body || {})
  ) as Record<string, unknown>;
  const hardwareReturnInput =
    body.hardwareReturn !== undefined && body.hardwareReturn !== null
      ? (body.hardwareReturn as Record<string, unknown>)
      : body.hardwareReturn === null
        ? null
        : undefined;
  delete body.hardwareReturn;

  // Canonical assignee patch: null / '' / sentinels clear all five fields;
  // never invent a pseudo-user or touch status here.
  const data: Record<string, unknown> = {};
  const assigneePatch = normalizeAssigneePatchForWrite(body);
  if (assigneePatch) {
    for (const field of ASSIGNEE_FIELDS) {
      if (assigneePatch[field] !== undefined) {
        data[field] = assigneePatch[field];
      }
    }
  }

  // Accept status/priority with validation.
  if (body.status !== undefined) {
    const parsedStatus = ticketStatusSchema.safeParse(body.status);
    if (!parsedStatus.success) {
      return res.status(400).json({ error: `Invalid status: ${String(body.status)}` });
    }
    data.status = parsedStatus.data;
  }

  if (body.priority !== undefined) {
    const parsedPriority = ticketPrioritySchema.safeParse(body.priority);
    if (!parsedPriority.success) {
      return res.status(400).json({ error: `Invalid priority: ${String(body.priority)}` });
    }
    data.priority = parsedPriority.data;
  }

  // Remaining fields: allow any key that is already present on the stored
  // ticket, plus the curated ALLOWED_NEW_FIELDS set. This keeps arbitrary
  // key injection out while letting every existing UI update path work.
  const existing = await getDocDirect('tickets', ticketId);
  if (!existing) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  for (const [key, value] of Object.entries(body)) {
    if (data[key] !== undefined) continue; // already handled above
    if (value === undefined) continue;
    if (key in existing || ALLOWED_NEW_FIELDS.has(key)) {
      data[key] = value;
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided.' });
  }

  try {
    // Tenant isolation: the caller may only mutate tickets in their own tenant.
    const tenantId = resolveTenantFromRequest(req);
    if (!documentBelongsToTenant(existing, tenantId)) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    if (isClientPortalRole(req.user?.role)) {
      const canMutate = await clientCanMutateTicket(
        {
          id: String(req.user!.id),
          role: String(req.user!.role),
          organizationId: resolveOrganizationIdFromUser(req.user!),
        },
        { ...existing, id: ticketId },
      );
      if (!canMutate) {
        return res.status(404).json({ error: 'Ticket not found.' });
      }
      // Clients must never flip internal notes / Hubcom analysis into payloads.
      delete data.internalNotes;
      delete data.internal_notes;
      delete data.agentComments;
      delete data.agent_comments;
      delete data.is_internal;
      delete data.isInternal;
      delete data.organizationId;
      delete data.organization_id;
      delete data.requesterId;
      delete data.requester_id;
      delete data.aiSummary;
      delete data.aiInsights;
      delete data.aiRootCause;
      delete data.aiChecklist;
      delete data.aiSentiment;
    } else if (
      data.companyId ||
      data.organizationId ||
      data.organization_id ||
      data.company ||
      data.customerEmail
    ) {
      // Hubcom staff: stamp canonical organizations.id when linking Unternehmen / Kontakt.
      const stamped = await stampStaffTicketOrganizationFields({ ...existing, ...data });
      if (stamped.organizationId) {
        data.organizationId = stamped.organizationId;
        data.organization_id = stamped.organization_id || stamped.organizationId;
      }
      if (typeof stamped.company === 'string' && stamped.company) data.company = stamped.company;
      if (typeof stamped.companyId === 'string' && stamped.companyId) data.companyId = stamped.companyId;
      if (typeof stamped.customerEmail === 'string' && stamped.customerEmail) {
        data.customerEmail = stamped.customerEmail;
      }
      if (typeof stamped.requesterId === 'string' && stamped.requesterId) {
        data.requesterId = stamped.requesterId;
        data.requester_id = stamped.requester_id || stamped.requesterId;
      }
    }

    const now = new Date().toISOString();
    data.updatedAt = now;

    // Normalize support-level / assigned_queue aliases into a consistent patch.
    const supportRaw =
      data.support_level !== undefined
        ? data.support_level
        : data.supportLevel !== undefined
          ? data.supportLevel
          : data.assigned_queue !== undefined
            ? data.assigned_queue
            : data.assignedQueue;
    if (supportRaw !== undefined) {
      const level = normalizeTicketSupportLevel(supportRaw);
      Object.assign(data, buildSupportLevelPatch(level));
    }

    await updateDocDirect('tickets', ticketId, data, { tenantId });

    const updated = await getDocDirect('tickets', ticketId);
    const nextTicket = { id: ticketId, ...(updated || existing), ...data };
    const ticketPayload = isClientPortalRole(req.user?.role)
      ? sanitizeTicketForClient(nextTicket)
      : nextTicket;

    // Best-effort 2nd-Level notify on transition; never fails PATCH.
    void maybeNotifySecondLevelAfterTicketPatch({
      previousTicket: existing as Record<string, unknown>,
      nextTicket: nextTicket as Record<string, unknown>,
      ticketId,
      assignedByName: String(req.user?.name || req.user?.email || 'Agent'),
      organizationId:
        ticketOrganizationId(nextTicket as any) ||
        ticketOrganizationId(existing as any),
    });

    let hardwareReturn = undefined as any;
    if (hardwareReturnInput !== undefined) {
      const orgId =
        ticketOrganizationId({ ...(updated || existing), id: ticketId } as any) ||
        ticketOrganizationId(existing as any);
      if (!orgId) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht verfügbar.' });
      }
      const org = await getOrganization(orgId);
      if (!org?.hardware_returns_enabled) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
      }
      if (isClientPortalRole(req.user?.role) && String(req.user!.role) === 'CLIENT_USER') {
        return res.status(403).json({
          error: 'Forbidden: CLIENT_USER cannot update hardware-return fields.',
        });
      }
      hardwareReturn = sanitizeHardwareReturnForClient(
        await upsertHardwareReturn({
          ticketId,
          organizationId: orgId,
          input: (hardwareReturnInput || {}) as any,
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
        }),
      );
    }

    return res.status(200).json({
      success: true,
      ticket: ticketPayload,
      ...(hardwareReturn !== undefined ? { hardwareReturn } : {}),
    });
  } catch (e: any) {
    safeLog('error', '[tickets] PATCH /api/tickets/:id failed', e?.message || e);
    return res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

/**
 * GET /api/tickets/:id/hardware-return
 * Staff or portal — only when the ticket's organization has the module enabled.
 */
router.get(
  '/:id/hardware-return',
  authenticate,
  attachClientOrganizationContext,
  async (req: Request, res: Response): Promise<any> => {
    const ticketId = routeParam(req.params.id);
    try {
      const ticket = await getDocDirect('tickets', ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      const orgId = ticketOrganizationId(ticket as any);
      if (!orgId) return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht verfügbar.' });
      const org = await getOrganization(orgId);
      if (!org?.hardware_returns_enabled) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
      }
      if (isClientPortalRole(req.user?.role)) {
        const sessionOrg = resolveOrganizationIdFromUser(req.user!);
        if (!sessionOrg || sessionOrg !== orgId) {
          return res.status(404).json({ error: 'Ticket not found.' });
        }
      }
      const hw = await getHardwareReturnByTicketId(ticketId);
      return res.json({
        hardwareReturn: hw ? sanitizeHardwareReturnForClient(hw) : null,
        enabledModules: { hardwareReturns: true },
        config: org.hardware_returns_config,
      });
    } catch (e: any) {
      safeLog('error', '[tickets] GET hardware-return failed', e?.message || e);
      return res.status(500).json({ error: 'Failed to load hardware return.' });
    }
  },
);

/**
 * PUT /api/tickets/:id/hardware-return
 * Upsert module fields when org flag is enabled.
 */
router.put(
  '/:id/hardware-return',
  authenticate,
  attachClientOrganizationContext,
  async (req: Request, res: Response): Promise<any> => {
    const ticketId = routeParam(req.params.id);
    try {
      const ticket = await getDocDirect('tickets', ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
      const orgId = ticketOrganizationId(ticket as any);
      if (!orgId) return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht verfügbar.' });
      const org = await getOrganization(orgId);
      if (!org?.hardware_returns_enabled) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
      }

      if (isClientPortalRole(req.user?.role)) {
        const sessionOrg = resolveOrganizationIdFromUser(req.user!);
        if (!sessionOrg || sessionOrg !== orgId) {
          return res.status(404).json({ error: 'Ticket not found.' });
        }
        const role = String(req.user!.role);
        if (role === 'CLIENT_USER') {
          return res.status(403).json({
            error: 'Forbidden: CLIENT_USER cannot update hardware-return fields.',
          });
        }
        const canMutate = await clientCanMutateTicket(
          {
            id: String(req.user!.id),
            role,
            organizationId: sessionOrg,
          },
          { ...ticket, id: ticketId },
        );
        if (!canMutate) return res.status(404).json({ error: 'Ticket not found.' });
      }

      const hardwareReturn = sanitizeHardwareReturnForClient(
        await upsertHardwareReturn({
          ticketId,
          organizationId: orgId,
          input: (req.body || {}) as any,
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
        }),
      );
      return res.json({ success: true, hardwareReturn });
    } catch (e: any) {
      if (e?.status === 403) {
        return res.status(403).json({ error: e.message });
      }
      safeLog('error', '[tickets] PUT hardware-return failed', e?.message || e);
      return res.status(500).json({ error: 'Failed to save hardware return.' });
    }
  },
);

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(500),
  updates: z.object({
    agentId: z.string().max(200).nullable().optional(),
    agentName: z.string().max(200).nullable().optional(),
    assignedTo: z.string().max(200).nullable().optional(),
    assigneeId: z.string().max(200).nullable().optional(),
    assignedToEmail: z.string().max(320).nullable().optional(),
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    type: z.string().max(80).optional(),
    tags: z.array(z.string().max(120)).max(50).optional(),
    groupId: z.string().max(200).optional(),
    groupName: z.string().max(200).optional(),
    internalNotes: z.string().max(100_000).optional(),
    include_in_rag: z.boolean().optional(),
    resolvedAt: z.union([z.string(), z.null()]).optional(),
    mergedIntoId: z.string().max(200).nullable().optional(),
    linkedTicketIds: z.array(z.string().max(200)).max(100).optional(),
    isMasterTicket: z.boolean().optional(),
    masterTicketId: z.string().max(200).nullable().optional(),
    aiSummary: z.string().max(50_000).optional(),
    aiInsights: z.array(z.string().max(5_000)).max(50).optional(),
    aiRootCause: z.string().max(20_000).optional(),
    aiChecklist: z.array(z.unknown()).max(200).optional(),
    aiSentiment: z.string().max(50).optional(),
    accountHealth: z.string().max(80).nullable().optional(),
    slaTier: z.string().max(80).nullable().optional(),
    isHelpRequested: z.boolean().optional(),
  }),
});

/**
 * POST /api/tickets/bulk-update
 * Apply the same update to many tickets. Each update is tenant-scoped and
 * persisted via updateDocDirect; returns per-ticket results.
 */
router.post('/bulk-update', authenticate, attachClientOrganizationContext, async (req: Request, res: Response): Promise<any> => {
  if (isClientPortalRole(req.user?.role)) {
    return res.status(403).json({
      error: 'Forbidden: Client portal accounts cannot bulk-update tickets.',
    });
  }

  const parsed = bulkUpdateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid bulk update payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  const { ids, updates } = parsed.data;

  const data: Record<string, unknown> = {};
  const assigneePatch = normalizeAssigneePatchForWrite(updates as Record<string, unknown>);
  if (assigneePatch) {
    for (const field of ASSIGNEE_FIELDS) {
      if (assigneePatch[field] !== undefined) {
        data[field] = assigneePatch[field];
      }
    }
  }

  // Copy every remaining validated update field.
  const restFields: (keyof typeof updates)[] = [
    'status', 'priority', 'type', 'tags', 'groupId', 'groupName', 'internalNotes',
    'include_in_rag', 'resolvedAt', 'mergedIntoId', 'linkedTicketIds',
    'isMasterTicket', 'masterTicketId', 'aiSummary', 'aiInsights', 'aiRootCause',
    'aiChecklist', 'aiSentiment', 'accountHealth', 'slaTier', 'isHelpRequested',
  ];
  for (const field of restFields) {
    const value = updates[field];
    if (value !== undefined) data[field] = value;
  }
  const results: { id: string; success: boolean; error?: string }[] = [];
  let updatedCount = 0;
  const tenantId = resolveTenantFromRequest(req);

  try {
    for (const ticketId of ids) {
      try {
        const existing = await getDocDirect('tickets', ticketId);
        if (!existing || !documentBelongsToTenant(existing, tenantId)) {
          results.push({ id: ticketId, success: false, error: 'Ticket not found.' });
          continue;
        }
        await updateDocDirect('tickets', ticketId, data, { tenantId });
        results.push({ id: ticketId, success: true });
        updatedCount += 1;
      } catch (innerErr: any) {
        safeLog('error', `[tickets] bulk-update failed for ${ticketId}`, innerErr?.message || innerErr);
        results.push({ id: ticketId, success: false, error: innerErr?.message || 'Update failed.' });
      }
    }

    const failures = results.filter((r) => !r.success);
    const status = failures.length === ids.length ? 500 : 200;
    return res.status(status).json({
      success: failures.length === 0,
      updated: updatedCount,
      failed: failures.length,
      results,
      tickets: await Promise.all(
        ids
          .filter((ticketId) => results.find((r) => r.id === ticketId)?.success)
          .map(async (ticketId) => {
            const ticket = await getDocDirect('tickets', ticketId, { tenantId });
            return { id: ticketId, ...ticket };
          }),
      ),
    });
  } catch (e: any) {
    safeLog('error', '[tickets] POST /api/tickets/bulk-update failed', e?.message || e);
    return res.status(500).json({ error: 'Failed to perform bulk update.' });
  }
});

export default router;
