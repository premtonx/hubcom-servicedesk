/**
 * Kundenportal-API (/api/portal/*) — nur für role === "customer".
 * Scope: eigene Tickets + Firmen-Tickets; keine internen Notizen/KI/Zeiterfassung.
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
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import {
  customerCanAccessTicket,
  isPublicPortalMessage,
  resolveCustomerContext,
  sanitizeMessageForPortal,
  sanitizeTicketForPortal,
  type CustomerContext,
} from '../lib/portal/access.js';
import { toPortalStatusGroup } from '../lib/portal/status.js';
import { listTicketCategories } from '../lib/ticket-categories/store.js';

const router = Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

function requireCustomer(req: Request, res: Response, next: NextFunction): any {
  const role = String((req as any).user?.role || '').toLowerCase();
  if (role !== 'customer') {
    return res.status(403).json({
      error: 'Forbidden: Dieses Portal ist nur für Kundenkonten verfügbar.',
    });
  }
  next();
}

function customerCtx(req: Request): CustomerContext {
  return resolveCustomerContext((req as any).user || {});
}

function parseAttachments(raw: unknown): Array<{
  filename: string;
  contentType: string;
  size: number;
  contentBase64?: string;
  omitted?: boolean;
  reason?: string;
}> {
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

async function listAccessibleTickets(ctx: CustomerContext): Promise<any[]> {
  const all = await getDocsDirect('tickets', []);
  return all
    .filter((t) => customerCanAccessTicket(t, ctx))
    .filter((t) => {
      const s = String(t.status || '').toLowerCase();
      return s !== 'deleted' && s !== 'trash' && s !== 'spam';
    })
    .sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
}

router.use(authenticate, requireCustomer);

/** Profil + Firmenzuordnung für das Portal. */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const ctx = customerCtx(req);
    res.json({
      user: {
        id: ctx.userId,
        name: ctx.name,
        email: ctx.email,
        role: 'customer',
        companyId: ctx.companyId,
        contactId: ctx.contactId,
        customerCompany: ctx.customerCompany,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Profil konnte nicht geladen werden') });
  }
});

/** Aktive Ticket-Kategorien für das Erstellformular. */
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await listTicketCategories({ activeOnly: true });
    res.json({ categories });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Kategorien konnten nicht geladen werden') });
  }
});

/**
 * GET /api/portal/tickets?status=&q=
 */
router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const ctx = customerCtx(req);
    const statusFilter = String(req.query.status || 'all').toLowerCase();
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();

    let tickets = await listAccessibleTickets(ctx);

    if (statusFilter && statusFilter !== 'all') {
      tickets = tickets.filter((t) => toPortalStatusGroup(t.status) === statusFilter);
    }

    if (q) {
      tickets = tickets.filter((t) => {
        const hay = [
          t.subject,
          t.customId,
          t.id,
          t.categoryName,
          t.description,
        ]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        return hay.includes(q);
      });
    }

    res.json({
      tickets: tickets.map(sanitizeTicketForPortal),
    });
  } catch (err: any) {
    safeLog('error', '[portal] list tickets failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Tickets konnten nicht geladen werden') });
  }
});

/**
 * GET /api/portal/tickets/:id
 */
router.get('/tickets/:id', async (req: Request, res: Response) => {
  try {
    const ctx = customerCtx(req);
    const id = routeParam(req.params.id);
    const ticket = await getDocDirect('tickets', id);
    if (!ticket || !customerCanAccessTicket(ticket, ctx)) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }

    const rawMessages = await getDocsDirect(`tickets/${id}/messages`, []);
    const messages = rawMessages
      .filter((m) => isPublicPortalMessage(m))
      .sort((a, b) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        return ta - tb;
      })
      .map(sanitizeMessageForPortal);

    res.json({
      ticket: sanitizeTicketForPortal(ticket),
      messages,
    });
  } catch (err: any) {
    safeLog('error', '[portal] get ticket failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht geladen werden') });
  }
});

const createSchema = z.object({
  subject: z.string().trim().min(3).max(500),
  description: z.string().trim().min(1).max(100_000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  categoryId: z.string().trim().max(128).optional().nullable(),
  attachments: z.array(z.any()).max(MAX_ATTACHMENTS).optional(),
});

/**
 * POST /api/portal/tickets — neues Ticket in der Agenten-Warteschlange.
 */
router.post('/tickets', async (req: Request, res: Response) => {
  try {
    const ctx = customerCtx(req);
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    let categoryName: string | null = null;
    let categorySlug: string | null = null;
    let categoryId: string | null = data.categoryId || null;

    if (categoryId) {
      const cat = await getDocDirect('ticket_categories', categoryId);
      if (cat && cat.isActive !== false) {
        categoryName = cat.name || null;
        categorySlug = cat.slug || null;
      } else {
        categoryId = null;
      }
    }

    const now = new Date().toISOString();
    const customId = await nextPortalCustomId();
    const attachments = parseAttachments(data.attachments);

    const ticketPayload = {
      subject: data.subject,
      description: data.description,
      status: 'open',
      priority: data.priority,
      team: 'support',
      channel: 'portal',
      customId,
      categoryId,
      categoryName,
      categorySlug,
      companyId: ctx.companyId || '',
      company: ctx.customerCompany || '',
      contactId: ctx.contactId || '',
      customerName: ctx.name,
      customerEmail: ctx.email,
      customerId: ctx.email,
      from_email: ctx.email,
      creatorId: ctx.userId,
      createdBy: ctx.userId,
      portalUserId: ctx.userId,
      attachments,
      tags: ['portal'],
      include_in_rag: true,
      createdAt: now,
      updatedAt: now,
    };

    const created = await addDocDirect('tickets', ticketPayload);

    if (attachments.length > 0) {
      await addDocDirect(`tickets/${created.id}/messages`, {
        ticketId: created.id,
        senderId: ctx.userId,
        senderType: 'customer',
        senderName: ctx.name,
        content: data.description,
        attachments,
        createdAt: now,
        updatedAt: now,
      });
    }

    safeLog('info', '[portal] ticket created', created.id, ctx.email);

    res.status(201).json({
      success: true,
      ticket: sanitizeTicketForPortal({ id: created.id, ...ticketPayload }),
    });
  } catch (err: any) {
    safeLog('error', '[portal] create ticket failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Ticket konnte nicht erstellt werden') });
  }
});

const replySchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  attachments: z.array(z.any()).max(MAX_ATTACHMENTS).optional(),
});

/**
 * POST /api/portal/tickets/:id/replies
 * Kundenantwort; bei waiting_customer → open.
 */
router.post('/tickets/:id/replies', async (req: Request, res: Response) => {
  try {
    const ctx = customerCtx(req);
    const id = routeParam(req.params.id);
    const parsed = replySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Eingabe',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const ticket = await getDocDirect('tickets', id);
    if (!ticket || !customerCanAccessTicket(ticket, ctx)) {
      return res.status(404).json({ error: 'Ticket nicht gefunden.' });
    }

    const now = new Date().toISOString();
    const attachments = parseAttachments(parsed.data.attachments);

    const messageRecord = await addDocDirect(`tickets/${id}/messages`, {
      ticketId: id,
      senderId: ctx.userId,
      senderType: 'customer',
      senderName: ctx.name,
      content: parsed.data.content,
      attachments,
      deliveryStatus: 'delivered',
      createdAt: now,
      updatedAt: now,
    });

    const prevStatus = String(ticket.status || '').toLowerCase();
    const ticketPatch: Record<string, unknown> = {
      updatedAt: now,
      lastReplyAt: now,
      lastReplyBy: 'customer',
    };
    if (prevStatus === 'waiting_customer') {
      ticketPatch.status = 'open';
    }

    await updateDocDirect('tickets', id, ticketPatch);

    const updated = await getDocDirect('tickets', id);

    res.status(200).json({
      success: true,
      status: updated?.status || ticketPatch.status || ticket.status,
      message: sanitizeMessageForPortal({
        id: messageRecord.id,
        ticketId: id,
        senderId: ctx.userId,
        senderType: 'customer',
        senderName: ctx.name,
        content: parsed.data.content,
        attachments,
        createdAt: now,
      }),
      ticket: sanitizeTicketForPortal(updated || { ...ticket, ...ticketPatch, id }),
    });
  } catch (err: any) {
    safeLog('error', '[portal] reply failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Antwort konnte nicht gespeichert werden') });
  }
});

export default router;
