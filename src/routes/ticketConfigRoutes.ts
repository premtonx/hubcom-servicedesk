/**
 * Admin APIs for configurable ticket statuses, priorities, and types.
 * GET is available to authenticated staff; mutations require SYSTEM_ADMIN.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware.js';
import { routeParam } from '../lib/route-params.js';
import {
  createTicketPriority,
  createTicketStatus,
  createTicketType,
  deleteTicketPriority,
  deleteTicketStatus,
  deleteTicketType,
  getTicketPriority,
  getTicketStatus,
  getTicketType,
  getUsageForItem,
  listTicketPriorities,
  listTicketStatuses,
  listTicketTypes,
  updateTicketPriority,
  updateTicketStatus,
  updateTicketType,
} from '../lib/ticket-config/store.js';
import { STATUS_WORKFLOW_KINDS } from '../lib/ticket-config/types.js';

const router = Router();

const workflowEnum = z.enum(['open', 'in_progress', 'waiting', 'closed']);

const statusSchema = z.object({
  name: z.string().min(1).max(120),
  key: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  workflowKind: workflowEnum.optional(),
  replacementKey: z.string().max(64).optional(),
});

const prioritySchema = z.object({
  name: z.string().min(1).max(120),
  key: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  replacementKey: z.string().max(64).optional(),
});

const typeSchema = z.object({
  name: z.string().min(1).max(120),
  key: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  replacementKey: z.string().max(64).optional(),
});

function sendStoreError(res: Response, err: any, fallback: string) {
  const status = err?.code === 'REPLACEMENT_REQUIRED' ? 409 : 400;
  return res.status(status).json({
    error: err?.message || fallback,
    code: err?.code || undefined,
    usageCount: err?.usageCount,
  });
}

router.get('/meta', authenticate, (_req: Request, res: Response) => {
  res.json({
    workflowKinds: STATUS_WORKFLOW_KINDS,
    surfaces: [
      'Ticket-Formular (Erstellen)',
      'Ticketliste & Filter',
      'Ticket-Detail / Sidebar',
      'Bulk-Aktionen',
    ],
  });
});

// ── Statuses ────────────────────────────────────────────────────────────────

router.get('/statuses', authenticate, async (req: Request, res: Response) => {
  const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
  const statuses = await listTicketStatuses({ activeOnly });
  const withUsage = await Promise.all(
    statuses.map(async (s) => ({
      ...s,
      usageCount: await getUsageForItem('status', s.key),
    })),
  );
  res.json({ statuses: withUsage });
});

router.post(
  '/statuses',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = statusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const status = await createTicketStatus(parsed.data);
      res.status(201).json({ status });
    } catch (err: any) {
      sendStoreError(res, err, 'Anlegen fehlgeschlagen.');
    }
  },
);

router.patch(
  '/statuses/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = statusSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const status = await updateTicketStatus(routeParam(req.params.id), parsed.data);
      res.json({ status });
    } catch (err: any) {
      sendStoreError(res, err, 'Aktualisierung fehlgeschlagen.');
    }
  },
);

router.delete(
  '/statuses/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const replacementKey =
        typeof req.query.replacementKey === 'string'
          ? req.query.replacementKey
          : typeof req.body?.replacementKey === 'string'
            ? req.body.replacementKey
            : undefined;
      const result = await deleteTicketStatus(routeParam(req.params.id), replacementKey);
      res.json(result);
    } catch (err: any) {
      sendStoreError(res, err, 'Löschen fehlgeschlagen.');
    }
  },
);

router.get('/statuses/:id', authenticate, async (req: Request, res: Response) => {
  const status = await getTicketStatus(routeParam(req.params.id));
  if (!status) return res.status(404).json({ error: 'Status nicht gefunden.' });
  const usageCount = await getUsageForItem('status', status.key);
  res.json({ status: { ...status, usageCount } });
});

// ── Priorities ──────────────────────────────────────────────────────────────

router.get('/priorities', authenticate, async (req: Request, res: Response) => {
  const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
  const priorities = await listTicketPriorities({ activeOnly });
  const withUsage = await Promise.all(
    priorities.map(async (p) => ({
      ...p,
      usageCount: await getUsageForItem('priority', p.key),
    })),
  );
  res.json({ priorities: withUsage });
});

router.post(
  '/priorities',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = prioritySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const priority = await createTicketPriority(parsed.data);
      res.status(201).json({ priority });
    } catch (err: any) {
      sendStoreError(res, err, 'Anlegen fehlgeschlagen.');
    }
  },
);

router.patch(
  '/priorities/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = prioritySchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const priority = await updateTicketPriority(routeParam(req.params.id), parsed.data);
      res.json({ priority });
    } catch (err: any) {
      sendStoreError(res, err, 'Aktualisierung fehlgeschlagen.');
    }
  },
);

router.delete(
  '/priorities/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const replacementKey =
        typeof req.query.replacementKey === 'string'
          ? req.query.replacementKey
          : typeof req.body?.replacementKey === 'string'
            ? req.body.replacementKey
            : undefined;
      const result = await deleteTicketPriority(routeParam(req.params.id), replacementKey);
      res.json(result);
    } catch (err: any) {
      sendStoreError(res, err, 'Löschen fehlgeschlagen.');
    }
  },
);

router.get('/priorities/:id', authenticate, async (req: Request, res: Response) => {
  const priority = await getTicketPriority(routeParam(req.params.id));
  if (!priority) return res.status(404).json({ error: 'Priorität nicht gefunden.' });
  const usageCount = await getUsageForItem('priority', priority.key);
  res.json({ priority: { ...priority, usageCount } });
});

// ── Types ───────────────────────────────────────────────────────────────────

router.get('/types', authenticate, async (req: Request, res: Response) => {
  const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
  const types = await listTicketTypes({ activeOnly });
  const withUsage = await Promise.all(
    types.map(async (t) => ({
      ...t,
      usageCount: await getUsageForItem('type', t.key),
    })),
  );
  res.json({ types: withUsage });
});

router.post(
  '/types',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = typeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const type = await createTicketType(parsed.data);
      res.status(201).json({ type });
    } catch (err: any) {
      sendStoreError(res, err, 'Anlegen fehlgeschlagen.');
    }
  },
);

router.patch(
  '/types/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = typeSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const type = await updateTicketType(routeParam(req.params.id), parsed.data);
      res.json({ type });
    } catch (err: any) {
      sendStoreError(res, err, 'Aktualisierung fehlgeschlagen.');
    }
  },
);

router.delete(
  '/types/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const replacementKey =
        typeof req.query.replacementKey === 'string'
          ? req.query.replacementKey
          : typeof req.body?.replacementKey === 'string'
            ? req.body.replacementKey
            : undefined;
      const result = await deleteTicketType(routeParam(req.params.id), replacementKey);
      res.json(result);
    } catch (err: any) {
      sendStoreError(res, err, 'Löschen fehlgeschlagen.');
    }
  },
);

router.get('/types/:id', authenticate, async (req: Request, res: Response) => {
  const type = await getTicketType(routeParam(req.params.id));
  if (!type) return res.status(404).json({ error: 'Ticket-Typ nicht gefunden.' });
  const usageCount = await getUsageForItem('type', type.key);
  res.json({ type: { ...type, usageCount } });
});

export default router;
