/**
 * CLIENT_* Kunden-Portal ticket API — org-isolated, no /api/db.
 *
 * Mounted at /api/portal. Non-CLIENT roles call next('router') so legacy
 * role=customer handlers in portalRoutes.ts still work.
 *
 * GET    /tickets
 * GET    /tickets/meta         — Eigenschaften dropdowns (agents/statuses/…)
 * GET    /tickets/:id          — full workspace detail (tabs + meta)
 * POST   /tickets
 * POST   /tickets/:id/messages — public reply or Interne Notiz (org-wide)
 * PATCH  /tickets/:id          — Eigenschaften fields (org-scoped)
 * POST   /tickets/:id/ai-sync
 * POST|PATCH|DELETE /tickets/:id/tasks[/:taskId]
 * POST   /tickets/:id/time-entries
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  addDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { isClientOrgWideTicketRole, isClientPortalRole } from '../lib/client-portal/roles.js';
import {
  clientCanMutateTicket,
  resolveOrganizationIdFromUser,
  sanitizeTicketForClient,
  stripClientSpoofFields,
} from '../lib/client-portal/ticket-visibility.js';
import {
  assertPortalTicketAccess,
  buildPortalTicketCounts,
  filterPortalTicketsByScope,
  listVisiblePortalTickets,
  loadPortalTicketParticipants,
  type PortalTicketScope,
} from '../lib/client-portal/portal-ticket-api.js';
import {
  buildSupportLevelPatch,
  normalizeTicketSupportLevel,
} from '../lib/client-portal/second-level-notify.js';
import { maybeNotifySecondLevelAfterTicketPatch } from '../lib/client-portal/second-level-notify-hook.js';
import {
  addPortalTicketTask,
  addPortalTimeEntry,
  buildPortalTicketWorkspaceDetail,
  deletePortalTicketTask,
  loadPortalTicketMeta,
  patchPortalTicketTask,
  portalCanSeeInternalNotes,
  runPortalTicketAiSync,
} from '../lib/client-portal/portal-ticket-workspace.js';
import { listTicketIdsForParticipant } from '../lib/client-portal/ticket-participants.js';
import {
  getHardwareReturnByTicketId,
  sanitizeHardwareReturnForClient,
  upsertHardwareReturn,
} from '../lib/client-portal/hardware-returns.js';
import { getOrganization } from '../lib/client-portal/organizations.js';
import { ticketMatchesPortalStatusFilter } from '../lib/portal/status.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { listTicketCategories } from '../lib/ticket-categories/store.js';
import { normalizeAccountHealth } from '../lib/account-health.js';
import {
  MAX_TICKET_ATTACHMENTS,
  parseAndGuardTicketAttachments,
  sanitizeTicketTextFields,
} from '../lib/security/parse-ticket-attachments.js';
import { getTrustedClientIp } from '../lib/security/client-ip.js';

const router = Router();

const MAX_ATTACHMENTS = MAX_TICKET_ATTACHMENTS;

function onlyClientPortal(req: Request, res: Response, next: NextFunction): void {
  if (isClientPortalRole(req.user?.role)) {
    next();
    return;
  }
  next('router');
}

function sessionCtx(req: Request) {
  return {
    id: String(req.user!.id),
    role: String(req.user!.role),
    organizationId: resolveOrganizationIdFromUser(req.user!),
  };
}

async function nextPortalCustomId(): Promise<string> {
  const tickets = await getDocsDirect('tickets', []);
  let max = 0;
  for (const ticket of tickets) {
    const raw = String(ticket.customId || '');
    const match = raw.match(/(\d+)\s*$/);
    const n = match ? parseInt(match[1], 10) : 0;
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `HC-${String(max + 1).padStart(5, '0')}`;
}

router.use(authenticate, onlyClientPortal);

router.get('/tickets', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }

    const scopeRaw = String(req.query.scope || '').toLowerCase();
    const scope: PortalTicketScope =
      scopeRaw === 'all' && isClientOrgWideTicketRole(session.role) ? 'all' : 'mine';
    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();

    const all = await getDocsDirect('tickets', []);
    const visible = await listVisiblePortalTickets(session, all);
    const participantIds = new Set(await listTicketIdsForParticipant(session.id));

    const scoped = filterPortalTicketsByScope(session, visible, scope, participantIds);
    const allScopeCounts = buildPortalTicketCounts(visible);
    allScopeCounts.mine = filterPortalTicketsByScope(
      session,
      visible,
      'mine',
      participantIds,
    ).length;

    let tickets = scoped;
    if (statusFilter && statusFilter !== 'all') {
      tickets = tickets.filter((t) =>
        ticketMatchesPortalStatusFilter(String(t.status || ''), statusFilter),
      );
    }
    if (q) {
      tickets = tickets.filter((t) => {
        const hay = [t.subject, t.customId, t.id, t.categoryName, t.description, t.customerName]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        return hay.includes(q);
      });
    }

    const counts = buildPortalTicketCounts(scoped);
    counts.mine = allScopeCounts.mine;
    counts.all = scoped.length;

    return res.json({
      tickets: tickets.map((t) => sanitizeTicketForClient(t)),
      counts: {
        ...counts,
        companyAll: visible.length,
        companyOpen: allScopeCounts.open,
        companyInProgress: allScopeCounts.in_progress,
        companyWaiting: allScopeCounts.waiting,
        companyResolved: allScopeCounts.resolved + allScopeCounts.closed,
      },
      scope,
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] list failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Tickets konnten nicht geladen werden') });
  }
});

/** GET /api/portal/tickets/meta — Eigenschaften dropdowns (org agents + global taxonomies). */
router.get('/tickets/meta', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const meta = await loadPortalTicketMeta(session.organizationId);
    return res.json({ meta });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] meta failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket-Metadaten konnten nicht geladen werden') });
  }
});

router.get('/tickets/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }

    const [rawMessages, participants] = await Promise.all([
      getDocsDirect(`tickets/${id}/messages`, []),
      loadPortalTicketParticipants(id),
    ]);

    const workspace = await buildPortalTicketWorkspaceDetail({
      session,
      ticket: access.ticket,
      messages: rawMessages as Array<Record<string, unknown>>,
      participants,
    });

    const org = await getOrganization(session.organizationId);
    let hardwareReturn = null;
    if (org?.hardware_returns_enabled) {
      const hw = await getHardwareReturnByTicketId(id);
      hardwareReturn = hw ? sanitizeHardwareReturnForClient(hw) : null;
    }

    return res.json({
      ...workspace,
      hardwareReturn,
      enabledModules: { hardwareReturns: Boolean(org?.hardware_returns_enabled) },
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] get failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht geladen werden') });
  }
});

const hardwareReturnSchema = z.record(z.string(), z.unknown()).optional().nullable();

const createSchema = z.object({
  subject: z.string().trim().min(3).max(500),
  description: z.string().trim().min(1).max(100_000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  category: z.string().trim().max(128).optional().nullable(),
  categoryId: z.string().trim().max(128).optional().nullable(),
  requesterId: z.string().trim().max(128).optional().nullable(),
  participantIds: z.array(z.string().trim().max(128)).max(50).optional(),
  attachments: z.array(z.any()).max(MAX_ATTACHMENTS).optional(),
  customerName: z.string().trim().max(255).optional().nullable(),
  customerEmail: z.string().trim().max(255).optional().nullable(),
  hardwareReturn: hardwareReturnSchema,
});

router.post('/tickets', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const parsed = createSchema.safeParse(stripClientSpoofFields((req.body || {}) as Record<string, unknown>));
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    let categoryName: string | null = data.category || null;
    let categorySlug: string | null = null;
    let categoryId: string | null = data.categoryId || null;

    if (categoryId) {
      const cat = await getDocDirect('ticket_categories', categoryId);
      if (cat && cat.isActive !== false) {
        categoryName = cat.name || categoryName;
        categorySlug = cat.slug || null;
      } else {
        categoryId = null;
      }
    } else if (categoryName) {
      const cats = await listTicketCategories({ activeOnly: true });
      const match = cats.find(
        (c) => String(c.name || '').toLowerCase() === categoryName!.toLowerCase(),
      );
      if (match) {
        categoryId = match.id;
        categorySlug = match.slug || null;
        categoryName = match.name;
      }
    }

    const requesterId =
      isClientOrgWideTicketRole(session.role) && data.requesterId
        ? data.requesterId
        : session.id;

    const now = new Date().toISOString();
    const customId = await nextPortalCustomId();
    const guarded = await parseAndGuardTicketAttachments(data.attachments, {
      ip: getTrustedClientIp(req),
      userId: session.id,
      path: '/api/portal/tickets',
    });
    if (guarded.ok === false) {
      return res.status(guarded.status).json({ error: guarded.error });
    }
    const attachments = guarded.attachments;
    const text = sanitizeTicketTextFields({
      subject: data.subject,
      description: data.description,
    });

    const ticketPayload = {
      subject: text.subject || data.subject,
      description: text.description || data.description,
      html_content: text.description || data.description,
      status: 'open',
      priority: data.priority,
      team: 'support',
      channel: 'portal',
      customId,
      categoryId,
      categoryName,
      categorySlug,
      organizationId: session.organizationId,
      organization_id: session.organizationId,
      customerName: data.customerName || req.user!.name || '',
      customerEmail: data.customerEmail || req.user!.email || '',
      customerId: data.customerEmail || req.user!.email || '',
      from_email: data.customerEmail || req.user!.email || '',
      requesterId,
      requester_id: requesterId,
      creatorId: session.id,
      createdBy: session.id,
      portalUserId: session.id,
      attachments,
      tags: ['client-portal', 'portal'],
      include_in_rag: true,
      is_internal: false,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    };

    const created = await addDocDirect('tickets', ticketPayload);

    if (attachments.length > 0 || data.description) {
      await addDocDirect(`tickets/${created.id}/messages`, {
        ticketId: created.id,
        senderId: session.id,
        senderType: 'customer',
        senderName: req.user!.name || req.user!.email || 'Kunde',
        content: text.description || data.description,
        attachments,
        organizationId: session.organizationId,
        organization_id: session.organizationId,
        is_internal: false,
        isInternal: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Optional participants (org-wide roles only; enforced by /api/tickets participants too).
    if (isClientOrgWideTicketRole(session.role) && Array.isArray(data.participantIds)) {
      const { addTicketParticipant } = await import('../lib/client-portal/ticket-participants.js');
      for (const userId of data.participantIds) {
        if (!userId || userId === requesterId) continue;
        try {
          await addTicketParticipant({
            ticketId: created.id,
            userId,
            addedBy: session.id,
          });
        } catch {
          /* non-fatal */
        }
      }
    }

    safeLog('info', '[portal/tickets] created', created.id, session.id);

    let hardwareReturn = null;
    const org = await getOrganization(session.organizationId);
    if (
      org?.hardware_returns_enabled &&
      isClientOrgWideTicketRole(session.role) &&
      data.hardwareReturn &&
      typeof data.hardwareReturn === 'object'
    ) {
      hardwareReturn = sanitizeHardwareReturnForClient(
        await upsertHardwareReturn({
          ticketId: created.id,
          organizationId: session.organizationId,
          input: data.hardwareReturn as any,
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
        }),
      );
    }

    return res.status(201).json({
      success: true,
      ticket: sanitizeTicketForClient({ id: created.id, ...ticketPayload }),
      hardwareReturn,
      enabledModules: { hardwareReturns: Boolean(org?.hardware_returns_enabled) },
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] create failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht erstellt werden') });
  }
});

const replySchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  attachments: z.array(z.any()).max(MAX_ATTACHMENTS).optional(),
  senderName: z.string().trim().max(255).optional(),
  is_internal: z.boolean().optional(),
  isInternal: z.boolean().optional(),
});

async function handlePortalReply(req: Request, res: Response): Promise<any> {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const parsed = replySchema.safeParse(stripClientSpoofFields((req.body || {}) as Record<string, unknown>));
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }

    const canMutate = await clientCanMutateTicket(session, access.ticket);
    if (!canMutate) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }

    const wantsInternal =
      parsed.data.is_internal === true || parsed.data.isInternal === true;
    if (wantsInternal && !portalCanSeeInternalNotes(session.role)) {
      return res.status(403).json({
        error: 'Forbidden: Interne Notizen nur für CLIENT_ADMIN / CLIENT_SUPPORTER.',
      });
    }

    const now = new Date().toISOString();
    let attachments: Array<{
      filename: string;
      contentType: string;
      size: number;
      contentBase64?: string;
      omitted?: boolean;
      reason?: string;
    }> = [];
    if (!wantsInternal) {
      const guarded = await parseAndGuardTicketAttachments(parsed.data.attachments, {
        ip: getTrustedClientIp(req),
        userId: session.id,
        path: `/api/portal/tickets/${id}/messages`,
      });
      if (guarded.ok === false) {
        return res.status(guarded.status).json({ error: guarded.error });
      }
      attachments = guarded.attachments;
    }
    const text = sanitizeTicketTextFields({ content: parsed.data.content });
    const messageRecord = await addDocDirect(`tickets/${id}/messages`, {
      ticketId: id,
      senderId: session.id,
      senderType: wantsInternal ? 'internal' : 'customer',
      senderName: parsed.data.senderName || req.user!.name || req.user!.email || 'Kunde',
      content: text.content || parsed.data.content,
      attachments,
      organizationId: session.organizationId,
      organization_id: session.organizationId,
      deliveryStatus: wantsInternal ? 'internal' : 'delivered',
      is_internal: wantsInternal,
      isInternal: wantsInternal,
      type: wantsInternal ? 'internal_note' : 'reply',
      createdAt: now,
      updatedAt: now,
    });

    if (!wantsInternal) {
      const prevStatus = String(access.ticket.status || '').toLowerCase();
      const ticketPatch: Record<string, unknown> = {
        updatedAt: now,
        lastReplyAt: now,
        lastReplyBy: 'customer',
      };
      if (prevStatus === 'waiting_customer' || prevStatus === 'waiting' || prevStatus === 'on_hold') {
        ticketPatch.status = 'open';
      }
      await updateDocDirect('tickets', id, ticketPatch);
    } else {
      await updateDocDirect('tickets', id, { updatedAt: now });
    }

    return res.status(201).json({
      success: true,
      message: {
        id: messageRecord.id,
        ...messageRecord,
        is_internal: wantsInternal,
        isInternal: wantsInternal,
      },
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] reply failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Antwort konnte nicht gesendet werden') });
  }
}

router.post('/tickets/:id/messages', handlePortalReply);
router.post('/tickets/:id/replies', handlePortalReply);

const patchSchema = z.object({
  status: z
    .enum(['open', 'pending', 'in_progress', 'resolved', 'closed', 'waiting_customer', 'on_hold', 'paused'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assignee_id: z.string().trim().max(128).optional().nullable(),
  assigneeId: z.string().trim().max(128).optional().nullable(),
  category: z.string().trim().max(128).optional().nullable(),
  categoryId: z.string().trim().max(128).optional().nullable(),
  categoryName: z.string().trim().max(128).optional().nullable(),
  ticket_type: z.string().trim().max(128).optional().nullable(),
  type: z.string().trim().max(128).optional().nullable(),
  sla_tier: z.string().trim().max(64).optional().nullable(),
  slaTier: z.string().trim().max(64).optional().nullable(),
  account_health: z.string().trim().max(32).optional().nullable(),
  accountHealth: z.string().trim().max(32).optional().nullable(),
  escalated: z.boolean().optional(),
  support_level: z
    .enum(['first_level', 'second_level'])
    .optional()
    .nullable(),
  supportLevel: z
    .enum(['first_level', 'second_level'])
    .optional()
    .nullable(),
  assigned_queue: z
    .enum(['first_level', 'second_level'])
    .optional()
    .nullable(),
  assignedQueue: z
    .enum(['first_level', 'second_level'])
    .optional()
    .nullable(),
  hardwareReturn: hardwareReturnSchema,
});

router.patch('/tickets/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const parsed = patchSchema.safeParse(stripClientSpoofFields((req.body || {}) as Record<string, unknown>));
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    const canMutate = await clientCanMutateTicket(session, access.ticket);
    if (!canMutate) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }

    const data = parsed.data;
    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (data.status) patch.status = data.status;
    if (data.priority) patch.priority = data.priority;
    if (data.status === 'resolved' || data.status === 'closed') {
      patch.resolvedAt = new Date().toISOString();
    }

    const assigneeRaw =
      data.assignee_id !== undefined ? data.assignee_id : data.assigneeId;
    if (assigneeRaw !== undefined) {
      if (!isClientOrgWideTicketRole(session.role)) {
        return res.status(403).json({ error: 'Forbidden: Bearbeiter nur für Kunden-Admin/Supporter.' });
      }
      const assigneeId = assigneeRaw ? String(assigneeRaw).trim() : null;
      if (assigneeId) {
        const meta = await loadPortalTicketMeta(session.organizationId);
        const allowed = meta.agents.some((a) => a.id === assigneeId);
        if (!allowed) {
          return res.status(400).json({
            error: 'assignee_id must be a CLIENT_ADMIN or CLIENT_SUPPORTER in your organization.',
          });
        }
      }
      patch.assigneeId = assigneeId;
      patch.assignee_id = assigneeId;
      patch.assignedTo = assigneeId;
    }

    if (data.categoryId !== undefined || data.category !== undefined || data.categoryName !== undefined) {
      let categoryId = data.categoryId ?? null;
      let categoryName = data.categoryName ?? data.category ?? null;
      let categorySlug: string | null = null;
      if (categoryId) {
        const cat = await getDocDirect('ticket_categories', categoryId);
        if (cat && cat.isActive !== false) {
          categoryName = String(cat.name || categoryName || '');
          categorySlug = cat.slug || null;
        } else {
          categoryId = null;
        }
      } else if (categoryName) {
        const cats = await listTicketCategories({ activeOnly: true });
        const match = cats.find(
          (c) => String(c.name || '').toLowerCase() === String(categoryName).toLowerCase(),
        );
        if (match) {
          categoryId = match.id;
          categorySlug = match.slug || null;
          categoryName = match.name;
        }
      }
      patch.categoryId = categoryId;
      patch.categoryName = categoryName;
      patch.categorySlug = categorySlug;
      patch.category = categoryName;
    }

    const typeRaw = data.ticket_type !== undefined ? data.ticket_type : data.type;
    if (typeRaw !== undefined) {
      patch.type = typeRaw;
      patch.ticket_type = typeRaw;
    }

    const slaRaw = data.sla_tier !== undefined ? data.sla_tier : data.slaTier;
    if (slaRaw !== undefined) {
      patch.slaTier = slaRaw;
      patch.sla_tier = slaRaw;
    }

    const healthRaw =
      data.account_health !== undefined ? data.account_health : data.accountHealth;
    if (healthRaw !== undefined) {
      const normalized = healthRaw ? normalizeAccountHealth(String(healthRaw)) : null;
      patch.accountHealth = normalized;
      patch.account_health = normalized;
    }

    if (data.escalated !== undefined) {
      patch.escalated = Boolean(data.escalated);
      patch.isEscalated = Boolean(data.escalated);
    }

    const supportRaw =
      data.support_level !== undefined
        ? data.support_level
        : data.supportLevel !== undefined
          ? data.supportLevel
          : data.assigned_queue !== undefined
            ? data.assigned_queue
            : data.assignedQueue;
    if (supportRaw !== undefined) {
      if (!isClientOrgWideTicketRole(session.role)) {
        return res.status(403).json({
          error: 'Forbidden: Support-Level nur für Kunden-Admin/Supporter.',
        });
      }
      const level = normalizeTicketSupportLevel(supportRaw);
      Object.assign(patch, buildSupportLevelPatch(level));
    }

    if (Object.keys(patch).length > 1) {
      await updateDocDirect('tickets', id, patch);
    }

    let hardwareReturn = null;
    const org = await getOrganization(session.organizationId);
    if (data.hardwareReturn !== undefined) {
      if (!org?.hardware_returns_enabled) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen sind für diese Organisation nicht aktiv.' });
      }
      if (!isClientOrgWideTicketRole(session.role)) {
        return res.status(403).json({ error: 'Forbidden: Nur Kunden-Admin/Supporter dürfen Hardware-Felder ändern.' });
      }
      hardwareReturn = sanitizeHardwareReturnForClient(
        await upsertHardwareReturn({
          ticketId: id,
          organizationId: session.organizationId,
          input: (data.hardwareReturn || {}) as any,
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
        }),
      );
    } else if (org?.hardware_returns_enabled) {
      const hw = await getHardwareReturnByTicketId(id);
      hardwareReturn = hw ? sanitizeHardwareReturnForClient(hw) : null;
    }

    const updated = await getDocDirect('tickets', id);
    const nextTicket = { ...(updated || access.ticket), id, ...patch };

    // Best-effort: only fires on transition into second_level; never fails PATCH.
    void maybeNotifySecondLevelAfterTicketPatch({
      previousTicket: access.ticket as Record<string, unknown>,
      nextTicket: nextTicket as Record<string, unknown>,
      ticketId: id,
      assignedByName: String(req.user?.name || req.user?.email || 'Portal'),
      organizationId: session.organizationId,
    });

    const { sanitizeTicketForPortalWorkspace } = await import(
      '../lib/client-portal/portal-ticket-workspace.js'
    );
    return res.json({
      success: true,
      ticket: sanitizeTicketForPortalWorkspace(nextTicket),
      hardwareReturn,
      enabledModules: { hardwareReturns: Boolean(org?.hardware_returns_enabled) },
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] patch failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht aktualisiert werden') });
  }
});

const aiSyncSchema = z.object({
  forceRefresh: z.boolean().optional(),
});

router.post('/tickets/:id/ai-sync', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const parsed = aiSyncSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe' });
    }

    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    const canMutate = await clientCanMutateTicket(session, access.ticket);
    if (!canMutate) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }

    const messages = (await getDocsDirect(`tickets/${id}/messages`, [])) as Array<
      Record<string, unknown>
    >;
    const result = await runPortalTicketAiSync({
      session,
      ticket: access.ticket,
      messages,
      forceRefresh: parsed.data.forceRefresh === true,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] ai-sync failed', err?.message || err);
    return res.status(500).json({
      error: safeErrorMessage(err, 'KI-Sync fehlgeschlagen'),
    });
  }
});

const taskCreateSchema = z.object({
  task: z.string().trim().min(1).max(2000),
});
const taskPatchSchema = z.object({
  task: z.string().trim().min(1).max(2000).optional(),
  completed: z.boolean().optional(),
});

router.post('/tickets/:id/tasks', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const parsed = taskCreateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
    }
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const tasks = await addPortalTicketTask(access.ticket, parsed.data.task);
    return res.status(201).json({ success: true, tasks });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Aufgabe konnte nicht angelegt werden') });
  }
});

router.patch('/tickets/:id/tasks/:taskId', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const taskId = routeParam(req.params.taskId);
    const parsed = taskPatchSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
    }
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const tasks = await patchPortalTicketTask(access.ticket, taskId, parsed.data);
    return res.json({ success: true, tasks });
  } catch (err: any) {
    const msg = err?.message || '';
    const status = msg.includes('nicht gefunden') ? 404 : 500;
    return res.status(status).json({ error: safeErrorMessage(err, 'Aufgabe konnte nicht aktualisiert werden') });
  }
});

router.delete('/tickets/:id/tasks/:taskId', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const taskId = routeParam(req.params.taskId);
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const tasks = await deletePortalTicketTask(access.ticket, taskId);
    return res.json({ success: true, tasks });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Aufgabe konnte nicht gelöscht werden') });
  }
});

/** PATCH /tickets/:id/tasks — body must include taskId (alias without path param). */
router.patch('/tickets/:id/tasks', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const taskId = String((req.body as any)?.taskId || (req.body as any)?.id || '').trim();
    if (!taskId) return res.status(400).json({ error: 'taskId is required.' });
    const parsed = taskPatchSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
    }
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const tasks = await patchPortalTicketTask(access.ticket, taskId, parsed.data);
    return res.json({ success: true, tasks });
  } catch (err: any) {
    const msg = err?.message || '';
    const status = msg.includes('nicht gefunden') ? 404 : 500;
    return res.status(status).json({ error: safeErrorMessage(err, 'Aufgabe konnte nicht aktualisiert werden') });
  }
});

router.delete('/tickets/:id/tasks', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const taskId = String((req.body as any)?.taskId || (req.body as any)?.id || req.query.taskId || '').trim();
    if (!taskId) return res.status(400).json({ error: 'taskId is required.' });
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const tasks = await deletePortalTicketTask(access.ticket, taskId);
    return res.json({ success: true, tasks });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Aufgabe konnte nicht gelöscht werden') });
  }
});

const timeEntrySchema = z.object({
  hours: z.number().positive().max(24),
  kuerzel: z.string().trim().max(16).optional(),
  description: z.string().trim().max(2000).optional(),
  date: z.string().trim().max(32).optional(),
  sonderzahlung: z.boolean().optional(),
});

router.post('/tickets/:id/time-entries', async (req: Request, res: Response): Promise<any> => {
  try {
    const session = sessionCtx(req);
    if (!session.organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const id = routeParam(req.params.id);
    const parsed = timeEntrySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
    }
    const raw = await getDocDirect('tickets', id);
    const access = await assertPortalTicketAccess(session, raw, id);
    if (access.ok === false) {
      return res.status(access.status).json({ error: 'Ticket nicht gefunden.' });
    }
    if (!(await clientCanMutateTicket(session, access.ticket))) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }
    const entry = await addPortalTimeEntry({
      ticket: access.ticket,
      session,
      agentName: req.user!.name || req.user!.email || session.id,
      input: {
        ticketId: id,
        hours: parsed.data.hours,
        kuerzel: parsed.data.kuerzel || 'XX',
        description: parsed.data.description,
        date: parsed.data.date,
        sonderzahlung: parsed.data.sonderzahlung,
      },
    });
    return res.status(201).json({ success: true, entry });
  } catch (err: any) {
    return res.status(400).json({ error: safeErrorMessage(err, 'Zeiteintrag konnte nicht gespeichert werden') });
  }
});

export default router;
