/**
 * CLIENT_* Kunden-Portal ticket API — org-isolated, no /api/db.
 *
 * Mounted at /api/portal. Non-CLIENT roles call next('router') so legacy
 * role=customer handlers in portalRoutes.ts still work.
 *
 * GET    /tickets
 * GET    /tickets/:id          — ticket + public messages + participants
 * POST   /tickets
 * POST   /tickets/:id/messages — alias: /tickets/:id/replies
 * PATCH  /tickets/:id          — status close/reopen (limited fields)
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
  buildPortalTicketDetailResponse,
  filterPortalTicketsByScope,
  listVisiblePortalTickets,
  loadPortalTicketParticipants,
  type PortalTicketScope,
} from '../lib/client-portal/portal-ticket-api.js';
import { listTicketIdsForParticipant } from '../lib/client-portal/ticket-participants.js';
import { ticketMatchesPortalStatusFilter } from '../lib/portal/status.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { listTicketCategories } from '../lib/ticket-categories/store.js';

const router = Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

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

function parseAttachments(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ATTACHMENTS).map((item: any) => {
    const filename = String(item?.filename || 'anhang').slice(0, 255);
    const contentType = String(item?.contentType || 'application/octet-stream').slice(0, 120);
    const contentBase64 = typeof item?.contentBase64 === 'string' ? item.contentBase64 : '';
    const size =
      Number(item?.size) ||
      (contentBase64 ? Math.floor((contentBase64.length * 3) / 4) : 0);
    if (size > MAX_ATTACHMENT_BYTES) {
      return { filename, contentType, size, omitted: true, reason: 'exceeds_size_limit' };
    }
    return {
      filename,
      contentType,
      size,
      contentBase64: contentBase64 || undefined,
    };
  });
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

    const payload = buildPortalTicketDetailResponse({
      ticket: access.ticket,
      messages: rawMessages as Array<Record<string, unknown>>,
      participants,
    });

    return res.json(payload);
  } catch (err: any) {
    safeLog('error', '[portal/tickets] get failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht geladen werden') });
  }
});

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
    const attachments = parseAttachments(data.attachments);

    const ticketPayload = {
      subject: data.subject,
      description: data.description,
      html_content: data.description,
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
        content: data.description,
        attachments,
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

    return res.status(201).json({
      success: true,
      ticket: sanitizeTicketForClient({ id: created.id, ...ticketPayload }),
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

    const now = new Date().toISOString();
    const attachments = parseAttachments(parsed.data.attachments);
    const messageRecord = await addDocDirect(`tickets/${id}/messages`, {
      ticketId: id,
      senderId: session.id,
      senderType: 'customer',
      senderName: parsed.data.senderName || req.user!.name || req.user!.email || 'Kunde',
      content: parsed.data.content,
      attachments,
      deliveryStatus: 'delivered',
      is_internal: false,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    });

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

    return res.status(201).json({
      success: true,
      message: sanitizeTicketForClient({
        id: messageRecord.id,
        ...messageRecord,
        is_internal: false,
        isInternal: false,
      } as any),
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

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.status) patch.status = parsed.data.status;
    if (parsed.data.priority) patch.priority = parsed.data.priority;
    if (parsed.data.status === 'resolved' || parsed.data.status === 'closed') {
      patch.resolvedAt = new Date().toISOString();
    }

    await updateDocDirect('tickets', id, patch);
    const updated = await getDocDirect('tickets', id);
    return res.json({
      success: true,
      ticket: sanitizeTicketForClient({ ...(updated || access.ticket), id, ...patch }),
    });
  } catch (err: any) {
    safeLog('error', '[portal/tickets] patch failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht aktualisiert werden') });
  }
});

export default router;
