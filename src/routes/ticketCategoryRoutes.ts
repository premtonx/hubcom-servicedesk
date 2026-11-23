import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware.js';
import { routeParam } from '../lib/route-params.js';
import {
  createTicketCategory,
  deleteTicketCategory,
  getTicketCategory,
  listTicketCategories,
  updateTicketCategory,
} from '../lib/ticket-categories/store.js';

const router = Router();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  color: z.string().max(32).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  slug: z.string().max(120).optional(),
});

const updateSchema = createSchema.partial();

/** GET /api/ticket-categories — alle authentifizierten Nutzer */
router.get('/', authenticate, async (req: Request, res: Response) => {
  const activeOnly = req.query.activeOnly === '1' || req.query.activeOnly === 'true';
  const categories = await listTicketCategories({ activeOnly });
  res.json({ categories });
});

/** GET /api/ticket-categories/:id */
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const category = await getTicketCategory(routeParam(req.params.id));
  if (!category) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
  res.json({ category });
});

/** POST /api/ticket-categories — Admin */
router.post(
  '/',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const category = await createTicketCategory(parsed.data);
      res.status(201).json({ category });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Anlegen fehlgeschlagen.' });
    }
  },
);

/** PATCH /api/ticket-categories/:id — Admin */
router.patch(
  '/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
    }
    try {
      const category = await updateTicketCategory(routeParam(req.params.id), parsed.data);
      res.json({ category });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Aktualisierung fehlgeschlagen.' });
    }
  },
);

/** DELETE /api/ticket-categories/:id — Admin */
router.delete(
  '/:id',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const id = routeParam(req.params.id);
    const existing = await getTicketCategory(id);
    if (!existing) return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
    await deleteTicketCategory(id);
    res.json({ ok: true });
  },
);

export default router;
