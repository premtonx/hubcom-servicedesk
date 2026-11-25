/**
 * Kunden-Portal Knowledge Base API — strict multi-tenant isolation.
 *
 * GET  /api/portal/kb          — list visible articles
 * POST /api/portal/kb/import-csv — CLIENT_ADMIN|SUPPORTER SharePoint CSV import (own org)
 * GET  /api/portal/kb/:id      — read one (404 if internal/other-org)
 * POST /api/portal/kb          — CLIENT_ADMIN|SUPPORTER create (forced org visibility)
 * PATCH /api/portal/kb/:id     — CLIENT_ADMIN|SUPPORTER update own-org articles
 * DELETE /api/portal/kb/:id    — CLIENT_ADMIN|SUPPORTER delete own-org articles
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  attachClientOrganizationContext,
  requireClientPortalRole,
} from '../middleware/clientPortalMiddleware.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  articleOrganizationId,
  assertPortalKbWriteRole,
  isKbArticleVisibleToPortal,
  matchesPortalKbScope,
  normalizeKbVisibility,
  sanitizeKbArticleForPortal,
  type PortalKbScopeFilter,
} from '../lib/client-portal/kb-visibility.js';
import {
  formatKbCsvImportSummary,
  importKbCsvArticles,
} from '../lib/kb/kb-csv-import-service.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';

const KB_COLLECTION = 'kb_articles';
const router = Router();

// Session must be populated before requireClientPortalRole — otherwise every
// /api/portal/kb* call returns 401 { error: 'Unauthorized.' } (toast on /portal/kb).
router.use(authenticate, attachClientOrganizationContext);

function sessionOrg(req: Request): string | null {
  return resolveOrganizationIdFromUser(req.user!);
}

const portalCsvImportSchema = z
  .object({
    // Spoof fields ignored server-side — session org + organization visibility win.
    organizationId: z.string().max(120).optional(),
    visibility: z.string().max(40).optional(),
    category: z.string().max(200).optional(),
    publishImmediately: z.boolean().optional().default(true),
    csv: z.string().max(8_000_000).optional(),
    articles: z
      .array(
        z.object({
          title: z.string().min(1).max(500),
          content: z.string().min(1).max(500_000),
          sharePointId: z.string().max(80).optional(),
          matchcode: z.string().max(500).optional(),
          hasAttachments: z.boolean().optional(),
          category: z.string().max(200).optional(),
        }),
      )
      .max(5_000)
      .optional(),
    dryRun: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.csv?.trim()) || (Array.isArray(b.articles) && b.articles.length > 0), {
    message: 'csv or articles[] required',
  });

/** SharePoint CSV import — locked to session organization + visibility=organization. */
router.post(
  '/import-csv',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!assertPortalKbWriteRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const parsed = portalCsvImportSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Ungültige Import-Daten.', details: parsed.error.flatten() });
      }
      // Cross-org spoof → still locked to session org (never trust body.organizationId).
      const body = parsed.data;
      const result = await importKbCsvArticles({
        organizationId,
        visibility: 'organization',
        category: body.category,
        publishImmediately: body.publishImmediately,
        csv: body.csv,
        articles: body.articles,
        dryRun: body.dryRun,
        authorId: req.user!.id,
        authorName: req.user!.name || req.user!.email || req.user!.id,
      });
      return res.json({
        success: true,
        ...result,
        summary: formatKbCsvImportSummary(result),
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] import-csv failed', err?.message || err);
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'CSV-Import fehlgeschlagen') });
    }
  },
);

router.get(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

      const scopeRaw = String(req.query.scope || 'all').toLowerCase();
      const scope: PortalKbScopeFilter =
        scopeRaw === 'organization' || scopeRaw === 'shared_portal' ? scopeRaw : 'all';
      const q = String(req.query.q || '')
        .trim()
        .toLowerCase();
      const category = String(req.query.category || '')
        .trim()
        .toLowerCase();

      const rows = await getDocsDirect(KB_COLLECTION, []);
      const articles = rows
        .filter((row) => matchesPortalKbScope(row, organizationId, scope))
        .filter((row) => {
          if (!category || category === 'all') return true;
          return String(row.category || '')
            .toLowerCase()
            .includes(category);
        })
        .filter((row) => {
          if (!q) return true;
          const hay = `${row.title || ''} ${row.content || ''} ${(row.tags || []).join(' ')}`.toLowerCase();
          return hay.includes(q);
        })
        .map((row) => sanitizeKbArticleForPortal(row))
        .sort((a, b) => {
          const aT = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
          const bT = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
          return bT - aT;
        });

      return res.json({ articles });
    } catch (err: any) {
      safeLog('error', '[portal/kb] list failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnten nicht geladen werden') });
    }
  },
);

router.get(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const article = await getDocDirect(KB_COLLECTION, id);
      if (!article || !isKbArticleVisibleToPortal(article, organizationId)) {
        return res.status(404).json({ error: 'Artikel nicht gefunden.' });
      }
      // Best-effort view bump (never leak on failure).
      void updateDocDirect(KB_COLLECTION, id, {
        views: Number(article.views || 0) + 1,
      }).catch(() => undefined);
      return res.json({ article: sanitizeKbArticleForPortal(article) });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnte nicht geladen werden') });
    }
  },
);

router.post(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!assertPortalKbWriteRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

      const title = String((req.body as any)?.title || '').trim();
      const content = String((req.body as any)?.content || '').trim();
      if (!title || !content) {
        return res.status(400).json({ error: 'Titel und Inhalt sind erforderlich.' });
      }

      const tags = Array.isArray((req.body as any)?.tags)
        ? (req.body as any).tags.map((t: unknown) => String(t).trim()).filter(Boolean)
        : [];

      const rawCategory = String((req.body as any)?.category || '')
        .trim();
      const category =
        !rawCategory || rawCategory === 'All' || rawCategory.toLowerCase() === 'allgemein'
          ? 'uncategorized'
          : rawCategory;
      const statusRaw = String((req.body as any)?.status || 'Published').trim();
      const status = statusRaw === 'Draft' ? 'Draft' : 'Published';

      const now = new Date().toISOString();
      const created = await addDocDirect(KB_COLLECTION, {
        title,
        content,
        category,
        // Portal editor does not expose subcategory / owner / reviewer — server stamps author.
        subCategory: '',
        tags,
        authorId: req.user!.id,
        owner: req.user!.name || req.user!.email || req.user!.id,
        reviewer: '',
        // Server-enforced tenant fields — never trust client spoof.
        visibility: 'organization',
        organizationId,
        organization_id: organizationId,
        status,
        views: 0,
        index_in_rag: false,
        language: 'de',
        createdAt: now,
        updatedAt: now,
      });

      const article = await getDocDirect(KB_COLLECTION, created.id);
      return res.status(201).json({ article: sanitizeKbArticleForPortal(article || { id: created.id }) });
    } catch (err: any) {
      safeLog('error', '[portal/kb] create failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnte nicht erstellt werden') });
    }
  },
);

router.patch(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!assertPortalKbWriteRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const existing = await getDocDirect(KB_COLLECTION, id);
      if (!existing) return res.status(404).json({ error: 'Artikel nicht gefunden.' });

      // Clients may only edit their own organization articles — never shared Hubcom guides.
      if (
        normalizeKbVisibility(existing.visibility) !== 'organization' ||
        articleOrganizationId(existing) !== organizationId
      ) {
        return res.status(404).json({ error: 'Artikel nicht gefunden.' });
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
        // Re-stamp tenant fields on every write.
        visibility: 'organization',
        organizationId,
        organization_id: organizationId,
      };
      const body = req.body as Record<string, unknown>;
      if (typeof body.title === 'string') updates.title = body.title.trim();
      if (typeof body.content === 'string') updates.content = body.content;
      // Accept `category` (preferred) or alias `category_id` from older clients.
      const categoryRaw =
        typeof body.category === 'string'
          ? body.category
          : typeof body.category_id === 'string'
            ? body.category_id
            : null;
      if (typeof categoryRaw === 'string') {
        const cat = categoryRaw.trim();
        updates.category =
          !cat || cat === 'All' || cat.toLowerCase() === 'allgemein' ? 'uncategorized' : cat;
      }
      // Ignore client owner/reviewer/subCategory — author stays the creator; portal UI dropped these.
      if (Array.isArray(body.tags)) {
        updates.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
      }
      if (typeof body.status === 'string') {
        updates.status = body.status === 'Draft' ? 'Draft' : 'Published';
      }

      await updateDocDirect(KB_COLLECTION, id, updates);
      const article = await getDocDirect(KB_COLLECTION, id);
      return res.json({ article: sanitizeKbArticleForPortal(article || { id }) });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnte nicht gespeichert werden') });
    }
  },
);

router.delete(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      if (!assertPortalKbWriteRole(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const existing = await getDocDirect(KB_COLLECTION, id);
      if (!existing) return res.status(404).json({ error: 'Artikel nicht gefunden.' });
      if (
        normalizeKbVisibility(existing.visibility) !== 'organization' ||
        articleOrganizationId(existing) !== organizationId
      ) {
        return res.status(404).json({ error: 'Artikel nicht gefunden.' });
      }
      await deleteDocDirect(KB_COLLECTION, id);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnte nicht gelöscht werden') });
    }
  },
);

export default router;
