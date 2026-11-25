/**
 * Portal KB categories — strict org isolation.
 * Mounted at /api/portal/kb/categories (separate from article /:id routes).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  attachClientOrganizationContext,
  requireClientPortalRole,
} from '../middleware/clientPortalMiddleware.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  setDocDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import {
  categoryOrganizationId,
  evaluatePortalKbCategoryWriteAccess,
  KB_CATEGORIES_COLLECTION,
  portalCategoryId,
  UNCATEGORIZED_CATEGORY_ID,
} from '../lib/kb/kb-categories.js';
import { articleOrganizationId, normalizeKbVisibility } from '../lib/client-portal/kb-visibility.js';

const router = Router();
const COLLECTION = KB_CATEGORIES_COLLECTION;
const ARTICLES = 'kb_articles';

router.use(authenticate, attachClientOrganizationContext);

function sessionOrg(req: Request): string | null {
  return resolveOrganizationIdFromUser(req.user!);
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  desc: z.string().max(1000).optional(),
  order: z.number().optional(),
  iconName: z.string().max(60).optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    desc: z.string().max(1000).optional(),
    order: z.number().optional(),
    iconName: z.string().max(60).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: 'No fields to update.' });

const deleteSchema = z.object({
  strategy: z.enum(['purge', 'reassign']).optional(),
});

router.get(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const rows = await getDocsDirect(COLLECTION, []);
      const categories = rows
        .filter((row) => categoryOrganizationId(row) === organizationId)
        .map((row) => ({
          id: row.id,
          name: row.name,
          desc: row.desc || '',
          iconName: row.iconName || 'BookOpen',
          order: row.order,
          organizationId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }))
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      return res.json({ categories });
    } catch (err: any) {
      safeLog('error', '[portal/kb/categories] list failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Kategorien konnten nicht geladen werden') });
    }
  },
);

router.post(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      const gate = evaluatePortalKbCategoryWriteAccess({
        role: req.user?.role,
        sessionOrgId: organizationId,
      });
      if (gate.ok === false) {
        return res.status(gate.status).json({
          error:
            String(req.user?.role || '') === 'CLIENT_USER'
              ? 'Forbidden: CLIENT_USER cannot manage categories.'
              : 'Forbidden.',
        });
      }
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

      const parsed = createSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Kategoriename ist erforderlich.' });
      }
      const name = parsed.data.name.trim();
      const id = portalCategoryId(organizationId, name);
      if (id.endsWith(`__${UNCATEGORIZED_CATEGORY_ID}`)) {
        return res.status(400).json({ error: 'Ungültiger Kategoriename.' });
      }

      const existing = await getDocDirect(COLLECTION, id);
      if (existing && categoryOrganizationId(existing) === organizationId) {
        return res.status(409).json({ error: 'Eine Kategorie mit diesem Namen existiert bereits.' });
      }

      const now = new Date().toISOString();
      const payload = {
        name,
        desc: parsed.data.desc || '',
        owner: '',
        subCategory: '',
        iconName: parsed.data.iconName || 'BookOpen',
        order: typeof parsed.data.order === 'number' ? parsed.data.order : Date.now(),
        organizationId,
        organization_id: organizationId,
        createdAt: now,
        updatedAt: now,
      };
      await setDocDirect(COLLECTION, id, payload);
      return res.status(201).json({ category: { id, ...payload } });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Kategorie konnte nicht erstellt werden') });
    }
  },
);

router.patch(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      const id = routeParam(req.params.id);
      const existing = await getDocDirect(COLLECTION, id);
      const targetOrg = categoryOrganizationId(existing);
      const gate = evaluatePortalKbCategoryWriteAccess({
        role: req.user?.role,
        sessionOrgId: organizationId,
        targetOrgId: targetOrg,
      });
      if (gate.ok === false) {
        return res.status(gate.status).json({
          error:
            String(req.user?.role || '') === 'CLIENT_USER'
              ? 'Forbidden: CLIENT_USER cannot manage categories.'
              : gate.status === 404
                ? 'Kategorie nicht gefunden.'
                : 'Forbidden.',
        });
      }
      if (!existing || targetOrg !== organizationId) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
      }

      const parsed = updateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Keine Felder zum Aktualisieren.' });
      }
      const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (typeof parsed.data.name === 'string' && parsed.data.name.trim()) {
        patch.name = parsed.data.name.trim();
      }
      if (typeof parsed.data.desc === 'string') patch.desc = parsed.data.desc;
      if (typeof parsed.data.order === 'number') patch.order = parsed.data.order;
      if (typeof parsed.data.iconName === 'string') patch.iconName = parsed.data.iconName;

      await updateDocDirect(COLLECTION, id, patch);

      if (typeof patch.name === 'string') {
        const articles = await getDocsDirect(ARTICLES, []);
        const oldName = String(existing.name || '');
        for (const article of articles) {
          if (articleOrganizationId(article) !== organizationId) continue;
          if (normalizeKbVisibility(article.visibility) !== 'organization') continue;
          if (article.category === id || article.category === oldName) {
            await updateDocDirect(ARTICLES, article.id, {
              category: id,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      const updated = await getDocDirect(COLLECTION, id);
      return res.json({
        category: {
          ...updated,
          id,
          organizationId,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Kategorie konnte nicht gespeichert werden') });
    }
  },
);

router.delete(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      const id = routeParam(req.params.id);
      if (id === UNCATEGORIZED_CATEGORY_ID || id.endsWith(`__${UNCATEGORIZED_CATEGORY_ID}`)) {
        return res.status(400).json({ error: 'Diese Kategorie kann nicht gelöscht werden.' });
      }
      const existing = await getDocDirect(COLLECTION, id);
      const targetOrg = categoryOrganizationId(existing);
      const gate = evaluatePortalKbCategoryWriteAccess({
        role: req.user?.role,
        sessionOrgId: organizationId,
        targetOrgId: targetOrg,
      });
      if (gate.ok === false) {
        return res.status(gate.status).json({
          error:
            String(req.user?.role || '') === 'CLIENT_USER'
              ? 'Forbidden: CLIENT_USER cannot manage categories.'
              : gate.status === 404
                ? 'Kategorie nicht gefunden.'
                : 'Forbidden.',
        });
      }
      if (!existing || targetOrg !== organizationId) {
        return res.status(404).json({ error: 'Kategorie nicht gefunden.' });
      }

      const parsedDelete = deleteSchema.safeParse(req.body || {});
      const strategy =
        parsedDelete.success && parsedDelete.data.strategy === 'purge' ? 'purge' : 'reassign';

      const articles = await getDocsDirect(ARTICLES, []);
      const affected = articles.filter((a) => {
        if (articleOrganizationId(a) !== organizationId) return false;
        if (normalizeKbVisibility(a.visibility) !== 'organization') return false;
        return a.category === id || a.category === existing.name;
      });

      if (strategy === 'purge') {
        for (const article of affected) {
          await deleteDocDirect(ARTICLES, article.id);
        }
      } else {
        for (const article of affected) {
          await updateDocDirect(ARTICLES, article.id, {
            category: UNCATEGORIZED_CATEGORY_ID,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      await deleteDocDirect(COLLECTION, id);
      return res.json({ success: true, strategy, affectedCount: affected.length });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Kategorie konnte nicht gelöscht werden') });
    }
  },
);

export default router;
