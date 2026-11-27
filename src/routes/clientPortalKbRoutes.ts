/**
 * Kunden-Portal Knowledge Base API — strict multi-tenant isolation.
 *
 * GET    /api/portal/kb              — list + workspace metrics (org-scoped)
 * GET    /api/portal/kb/suggest      — ticket deflection (published, org-scoped)
 * GET    /api/portal/kb/:id          — full article detail (404 if internal/other-org)
 * POST   /api/portal/kb/:id/deflect  — increment deflected_count (ticket prevented)
 * POST   /api/portal/kb              — CLIENT_ADMIN|SUPPORTER create
 * PATCH  /api/portal/kb/:id          — edit + index_in_rag / outdated lifecycle
 * DELETE /api/portal/kb/:id          — delete own-org articles
 * POST   /api/portal/kb/import-csv   — SharePoint CSV import
 * POST   /api/portal/kb/import       — Dokumente importieren (CSV/Markdown alias)
 * POST   /api/portal/kb/ai-generate  — KI generieren (writers)
 * POST   /api/portal/kb/ai-ask       — Hubcom KI fragen (org-scoped RAG)
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
  normalizeKbVisibility,
  sanitizeKbArticleForPortal,
  type PortalKbScopeFilter,
} from '../lib/client-portal/kb-visibility.js';
import {
  computePortalKbWorkspace,
  extractPortalKbToc,
  filterPortalVisibleArticles,
  portalKbKeywordSearch,
  resolveTenantIdForOrganization,
} from '../lib/client-portal/portal-kb-workspace.js';
import {
  formatKbCsvImportSummary,
  importKbCsvArticles,
} from '../lib/kb/kb-csv-import-service.js';
import {
  categoryOrganizationId,
  KB_CATEGORIES_COLLECTION,
} from '../lib/kb/kb-categories.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { stampTenantId } from '../lib/tenant-context.js';
import {
  deleteEmbeddingsForSource,
  enqueueKbArticleIndex,
} from '../lib/ai/vector-queue.js';
import { getOrganization } from '../lib/client-portal/organizations.js';
import {
  filterArticlesForPortalSuggest,
  mergeSuggestWithHybridBoost,
  PORTAL_KB_SUGGEST_LIMIT,
  PORTAL_KB_SUGGEST_MIN_QUERY,
  scorePortalKbSuggest,
  incrementDeflectedCount,
} from '../lib/kb/portal-kb-suggest.js';
import {
  KB_RAG_BLOCKED_STATUS_ERROR,
  resolveKbLifecycleUpdate,
  statusBlocksRag,
} from '../lib/kb/kb-article-lifecycle.js';

const KB_COLLECTION = 'kb_articles';
const router = Router();

// Session must be populated before requireClientPortalRole — otherwise every
// /api/portal/kb* call returns 401 { error: 'Unauthorized.' } (toast on /portal/kb).
router.use(authenticate, attachClientOrganizationContext);

function sessionOrg(req: Request): string | null {
  return resolveOrganizationIdFromUser(req.user!);
}

async function loadCategoryNameMap(organizationId: string): Promise<Map<string, string>> {
  const rows = await getDocsDirect(KB_CATEGORIES_COLLECTION, []);
  const map = new Map<string, string>();
  for (const row of rows) {
    if (categoryOrganizationId(row) !== organizationId) continue;
    map.set(String(row.id), String(row.name || row.id));
    if (row.name) map.set(String(row.name).toLowerCase(), String(row.name));
  }
  return map;
}

function resolveCategoryName(
  category: unknown,
  map: Map<string, string>,
): string | null {
  const raw = String(category || '').trim();
  if (!raw) return null;
  return map.get(raw) || map.get(raw.toLowerCase()) || raw;
}

function sanitizeWithMeta(
  article: Record<string, unknown>,
  categoryMap: Map<string, string>,
) {
  const toc = extractPortalKbToc(article.content);
  const categoryName = resolveCategoryName(article.category || article.category_id, categoryMap);
  return sanitizeKbArticleForPortal(article, { categoryName, toc });
}

const portalCsvImportSchema = z
  .object({
    // Spoof fields ignored server-side — session org + organization visibility win.
    organizationId: z.string().max(120).optional(),
    visibility: z.string().max(40).optional(),
    category: z.string().max(200).optional(),
    publishImmediately: z.boolean().optional().default(true),
    csv: z.string().max(8_000_000).optional(),
    markdown: z.string().max(2_000_000).optional(),
    title: z.string().max(500).optional(),
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
  .refine(
    (b) =>
      Boolean(b.csv?.trim()) ||
      Boolean(b.markdown?.trim()) ||
      (Array.isArray(b.articles) && b.articles.length > 0),
    { message: 'csv, markdown, or articles[] required' },
  );

async function runPortalCsvImport(req: Request, res: Response): Promise<any> {
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
    const body = parsed.data;
    const ragTenantId = resolveTenantIdForOrganization(organizationId);

    // Markdown single-doc import → one article payload.
    let articles = body.articles;
    if (!articles?.length && body.markdown?.trim()) {
      articles = [
        {
          title: String(body.title || 'Importiertes Dokument').trim() || 'Importiertes Dokument',
          content: body.markdown,
          category: body.category,
        },
      ];
    }

    const result = await importKbCsvArticles({
      organizationId,
      visibility: 'organization',
      category: body.category,
      publishImmediately: body.publishImmediately,
      csv: body.csv,
      articles,
      dryRun: body.dryRun,
      authorId: req.user!.id,
      authorName: req.user!.name || req.user!.email || req.user!.id,
    });

    // Stamp org RAG tenant on created articles (best-effort; never trust body tenant).
    if (!body.dryRun && Array.isArray(result.importedIds)) {
      for (const id of result.importedIds) {
        await updateDocDirect(
          KB_COLLECTION,
          id,
          stampTenantId({ organizationId, organization_id: organizationId }, ragTenantId),
        ).catch(() => undefined);
      }
    }

    return res.json({
      success: true,
      ...result,
      ragTenantId,
      summary: formatKbCsvImportSummary(result),
    });
  } catch (err: any) {
    safeLog('error', '[portal/kb] import failed', err?.message || err);
    return res
      .status(err?.status || 500)
      .json({ error: safeErrorMessage(err, 'Import fehlgeschlagen') });
  }
}

/** SharePoint CSV import — locked to session organization + visibility=organization. */
router.post(
  '/import-csv',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  runPortalCsvImport,
);

/** Dokumente importieren — CSV / Markdown / articles[] (same org lock). */
router.post(
  '/import',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER']),
  runPortalCsvImport,
);

const aiGenerateSchema = z.object({
  subject: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  threadHistory: z.array(z.string().max(5_000)).max(40).optional(),
});

/** KI generieren — writers only; never uses staff /api/db. */
router.post(
  '/ai-generate',
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
      const orgForAi = await getOrganization(organizationId);
      const {
        isOrgAiEnabled,
        normalizeOrgAiSettings,
        ORG_AI_DISABLED_ERROR,
      } = await import('../lib/ai/org-ai-settings.js');
      if (!isOrgAiEnabled(normalizeOrgAiSettings(orgForAi))) {
        return res.status(403).json({ error: ORG_AI_DISABLED_ERROR });
      }
      const parsed = aiGenerateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'subject required', details: parsed.error.flatten() });
      }
      const { executeAiFeatureRequest, requireLifecycleOutput } = await import(
        '../lib/ai-orchestrator-service.js'
      );
      const { buildLlmPromptWithUntrustedData } = await import('../lib/security/sanitize.js');
      const prompt = buildLlmPromptWithUntrustedData({
        systemRules: `You are a technical writer. Convert the following support ticket into a structured Knowledge Base article.
Follow this format:
1. Title: A concise, searchable title.
2. Problem: A brief description of the issue.
3. Solution: Step-by-step instructions to resolve.
IMPORTANT: DO NOT include any PII. Return ONLY JSON with "title" and "content".`,
        untrustedBlocks: [
          {
            kind: 'ticket_content',
            content: `SUBJECT: ${parsed.data.subject}\nDESCRIPTION: ${parsed.data.description || ''}`,
          },
          {
            kind: 'thread_history',
            content: (parsed.data.threadHistory || []).join('\n') || 'No history.',
          },
        ],
        task: 'Return JSON with title and content.',
      });
      let title = `KB: ${parsed.data.subject}`;
      let content = `### Summary\n${parsed.data.description || parsed.data.subject}`;
      try {
        const result = await executeAiFeatureRequest({
          feature: 'kb_generation',
          prompt,
          customerId: organizationId,
          metadata: { organizationId, source: 'portal_kb_ai_generate' },
        } as any);
        const output = requireLifecycleOutput(result);
        const body = JSON.parse(output);
        if (body.title) title = String(body.title);
        if (body.content) content = String(body.content);
      } catch (genErr: any) {
        safeLog('warn', '[portal/kb] ai-generate LLM fallback', genErr?.message || genErr);
      }
      return res.json({
        title,
        content,
        organizationId,
        ragTenantId: resolveTenantIdForOrganization(organizationId),
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] ai-generate failed', err?.message || err);
      return res
        .status(500)
        .json({ error: safeErrorMessage(err, 'KI-Generierung fehlgeschlagen') });
    }
  },
);

const aiAskSchema = z.object({
  query: z.string().min(1).max(2_000),
  limit: z.number().int().min(1).max(20).optional(),
});

/**
 * Hubcom KI fragen — RAG retrieval strictly filtered by org tenant_id.
 * Falls back to keyword search over portal-visible articles when vectors are empty.
 */
router.post(
  '/ai-ask',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const parsed = aiAskSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'query required', details: parsed.error.flatten() });
      }
      const ragTenantId = resolveTenantIdForOrganization(organizationId);
      const limit = parsed.data.limit ?? 5;
      const org = await getOrganization(organizationId);
      const {
        isOrgAiEnabled,
        normalizeOrgAiSettings,
        ORG_AI_DISABLED_ERROR,
      } = await import('../lib/ai/org-ai-settings.js');
      if (!isOrgAiEnabled(normalizeOrgAiSettings(org))) {
        return res.status(403).json({ error: ORG_AI_DISABLED_ERROR });
      }
      const { resolveIncludeSharedKbInRag } = await import('../lib/ai/rag-org-scope.js');
      const includeSharedKb = resolveIncludeSharedKbInRag(org);

      // Vector hits — exclusively this org's tenant + organization_id (never other orgs).
      let vectorHits: Array<{
        sourceId: string;
        sourceTitle: string;
        text: string;
        score?: number;
        organizationId?: string | null;
      }> = [];
      try {
        const { hybridSearchKnowledge } = await import('../lib/ai/ki-orchestrator.js');
        const hits = await hybridSearchKnowledge({
          query: parsed.data.query,
          tenantId: ragTenantId,
          organizationId,
          includeSharedKb,
          limit,
          sourceTypes: ['KB_ARTICLE'],
        });
        vectorHits = hits.map((h) => ({
          sourceId: String(h.sourceId || ''),
          sourceTitle: String(
            h.title || (h.metadata && h.metadata.title) || h.sourceId || '',
          ),
          text: String(h.chunkContent || '').slice(0, 1200),
          score: h.hybridScore,
          organizationId: h.organizationId ?? null,
        }));
      } catch (err: any) {
        safeLog('warn', '[portal/kb] ai-ask vector search unavailable', err?.message || err);
      }

      // Always load org-visible articles for keyword fallback + answer grounding.
      const rows = await getDocsDirect(KB_COLLECTION, []);
      const visible = filterPortalVisibleArticles(rows, organizationId, 'all');
      const keywordHits = portalKbKeywordSearch(parsed.data.query, visible, limit);

      // Drop any vector hit whose source article is not portal-visible, or whose
      // organization_id does not match this org (defense in depth — never leak OtherOrg).
      const visibleIds = new Set(visible.map((a) => String(a.id)));
      const safeVectorHits = vectorHits.filter((h) => {
        if (!visibleIds.has(h.sourceId)) return false;
        if (!includeSharedKb) {
          const hitOrg = String(h.organizationId || '').trim();
          if (hitOrg && hitOrg !== organizationId) return false;
        }
        return true;
      });

      const snippets =
        safeVectorHits.length > 0
          ? safeVectorHits.map((h) => ({
              sourceTitle: h.sourceTitle,
              source: 'Knowledge Base',
              text: h.text,
              sourceId: h.sourceId,
            }))
          : keywordHits.map((h) => ({
              sourceTitle: h.sourceTitle,
              source: 'Knowledge Base',
              text: h.text,
              sourceId: h.sourceId,
            }));

      let answer = '';
      try {
        const { executeAiFeatureRequest, requireLifecycleOutput } = await import(
          '../lib/ai-orchestrator-service.js'
        );
        const contextBlock =
          snippets.length > 0
            ? snippets
                .map((s) => `[${s.source}: ${s.sourceTitle}]\n${s.text}`)
                .join('\n\n')
            : 'No matching documentation found.';
        const prompt = `Answer using ONLY the provided documentation excerpts. If insufficient, say so clearly.
USER QUESTION: ${parsed.data.query}

DOCUMENTATION:
${contextBlock}`;
        const result = await executeAiFeatureRequest({
          feature: 'kb_assistant',
          prompt,
          customerId: organizationId,
          metadata: {
            organizationId,
            source: 'portal_kb_ai_ask',
            entityId: `portal-kb-ask-${organizationId}-${parsed.data.query.slice(0, 48)}`,
          },
        } as any);
        answer = requireLifecycleOutput(result);
      } catch (err: any) {
        safeLog('warn', '[portal/kb] ai-ask LLM fallback', err?.message || err);
        answer =
          snippets.length > 0
            ? `Basierend auf Ihrer Dokumentation:\n\n${snippets
                .map((s) => `• ${s.sourceTitle}: ${s.text.slice(0, 200)}…`)
                .join('\n')}`
            : 'In Ihrer Organisations-Wissensdatenbank wurden keine passenden Artikel gefunden.';
      }

      return res.json({
        answer,
        snippets,
        ragTenantId,
        organizationId,
        source: safeVectorHits.length > 0 ? 'vector' : 'keyword',
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] ai-ask failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'KI-Suche fehlgeschlagen') });
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

      const [rows, categoryMap] = await Promise.all([
        getDocsDirect(KB_COLLECTION, []),
        loadCategoryNameMap(organizationId),
      ]);

      const scoped = filterPortalVisibleArticles(rows, organizationId, scope)
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
        .sort((a, b) => {
          const aT = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
          const bT = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
          return bT - aT;
        });

      // Workspace metrics always over full org-visible set (scope=all), not the list filter.
      const allVisible = filterPortalVisibleArticles(rows, organizationId, 'all');
      const workspace = computePortalKbWorkspace(allVisible, organizationId);

      const articles = scoped.map((row) => sanitizeWithMeta(row, categoryMap));

      return res.json({
        articles,
        workspace,
        // Aliases for staff-parity consumers
        publishedCount: workspace.publishedCount,
        draftCount: workspace.draftCount,
        reviewsCount: workspace.reviewsCount,
        kbHealthScore: workspace.kbHealthScore,
        monthlyViews: workspace.monthlyViews,
        recentActivity: workspace.recentActivity,
        topContributors: workspace.topContributors,
        aiInsights: workspace.aiInsights,
        popularArticles: workspace.popularArticles,
        recentlyUpdatedArticles: workspace.recentlyUpdatedArticles,
        mostViewedArticles: workspace.mostViewedArticles,
        missingArticles: workspace.missingArticles,
        staleArticles: workspace.staleArticles,
        ragTenantId: workspace.ragTenantId,
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] list failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnten nicht geladen werden') });
    }
  },
);

/**
 * GET /api/portal/kb/suggest?q=… — ticket deflection (≤3 published org articles).
 * Never uses /api/db; never leaks other organizations.
 */
router.get(
  '/suggest',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organisation fehlt.' });
      }
      const q = String(req.query.q || '').trim();
      if (q.length < PORTAL_KB_SUGGEST_MIN_QUERY) {
        return res.json({
          articles: [],
          query: q,
          organizationId,
          minQueryLength: PORTAL_KB_SUGGEST_MIN_QUERY,
        });
      }

      const [rows, categoryMap] = await Promise.all([
        getDocsDirect(KB_COLLECTION, []),
        loadCategoryNameMap(organizationId),
      ]);

      const eligible = filterArticlesForPortalSuggest(
        rows.map((row) => ({
          ...row,
          category_name: resolveCategoryName(row.category || row.category_id, categoryMap),
        })),
        organizationId,
      );

      let hits = scorePortalKbSuggest(q, eligible, PORTAL_KB_SUGGEST_LIMIT);

      // Optional hybrid boost (fast fail — never blocks deflection).
      try {
        const { resolveIncludeSharedKbInRag } = await import('../lib/ai/rag-org-scope.js');
        const { hybridSearchKnowledge } = await import('../lib/ai/ki-orchestrator.js');
        const org = await getOrganization(organizationId);
        const includeSharedKb = resolveIncludeSharedKbInRag(org);
        const ragTenantId = resolveTenantIdForOrganization(organizationId);
        const vectorHits = await hybridSearchKnowledge({
          query: q,
          tenantId: ragTenantId,
          organizationId,
          includeSharedKb,
          limit: PORTAL_KB_SUGGEST_LIMIT,
          sourceTypes: ['KB_ARTICLE'],
        });
        const eligibleIds = new Set(eligible.map((a) => String(a.id || '')));
        const hybridIds = vectorHits
          .map((h) => String(h.sourceId || ''))
          .filter((id) => eligibleIds.has(id));
        hits = mergeSuggestWithHybridBoost(hits, hybridIds, PORTAL_KB_SUGGEST_LIMIT);
      } catch {
        /* keyword-only is fine */
      }

      return res.json({
        articles: hits.map(({ id, title, snippet, category_name }) => ({
          id,
          title,
          snippet,
          category_name,
        })),
        query: q,
        organizationId,
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] suggest failed', err?.message || err);
      return res
        .status(500)
        .json({ error: safeErrorMessage(err, 'Vorschläge konnten nicht geladen werden') });
    }
  },
);

/**
 * POST /api/portal/kb/:id/deflect — user resolved via KB (ticket prevented).
 */
router.post(
  '/:id/deflect',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organisation fehlt.' });
      }
      const id = routeParam(req.params.id);
      const existing = await getDocDirect(KB_COLLECTION, id);
      if (!existing || !isKbArticleVisibleToPortal(existing, organizationId)) {
        return res.status(404).json({ error: 'Artikel nicht gefunden.' });
      }
      const nextCount = incrementDeflectedCount(existing.deflected_count);
      await updateDocDirect(KB_COLLECTION, id, {
        deflected_count: nextCount,
        updatedAt: new Date().toISOString(),
      });
      return res.json({
        success: true,
        id,
        deflected_count: nextCount,
        organizationId,
      });
    } catch (err: any) {
      safeLog('error', '[portal/kb] deflect failed', err?.message || err);
      return res.status(500).json({
        error: safeErrorMessage(err, 'Rückmeldung konnte nicht gespeichert werden'),
      });
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

      const categoryMap = await loadCategoryNameMap(organizationId);
      return res.json({
        article: sanitizeWithMeta(article, categoryMap),
        ragTenantId: resolveTenantIdForOrganization(organizationId),
      });
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

      const { sanitizeUserHtml, sanitizePlainTextField } = await import(
        '../lib/security/sanitize.js'
      );
      const title = sanitizePlainTextField(String((req.body as any)?.title || '').trim(), 500);
      const content = sanitizeUserHtml(String((req.body as any)?.content || '').trim());
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
      const status = statusRaw === 'Draft' || statusRaw === 'draft' ? 'Draft' : 'Published';
      const indexInRag = (req.body as any)?.index_in_rag === true;
      const ragTenantId = resolveTenantIdForOrganization(organizationId);

      const now = new Date().toISOString();
      const payload = stampTenantId(
        {
          title,
          content,
          category,
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
          helpfulCount: 0,
          index_in_rag: indexInRag,
          language: 'de',
          createdAt: now,
          updatedAt: now,
        },
        ragTenantId,
      );
      const created = await addDocDirect(KB_COLLECTION, payload);

      if (indexInRag) {
        try {
          const { getRagPipelineConfig } = await import('../lib/rag-pipeline-config.js');
          const { drainVectorQueue } = await import('../lib/ai/vector-queue.js');
          const ragConfig = await getRagPipelineConfig(ragTenantId);
          if (ragConfig.indexNewKbArticles) {
            await enqueueKbArticleIndex(created.id, ragTenantId);
            void drainVectorQueue();
          }
        } catch (err: any) {
          safeLog('warn', '[portal/kb] create RAG enqueue skipped', err?.message || err);
        }
      }

      const article = await getDocDirect(KB_COLLECTION, created.id);
      const categoryMap = await loadCategoryNameMap(organizationId);
      return res.status(201).json({
        article: sanitizeWithMeta(article || { id: created.id }, categoryMap),
        ragTenantId,
      });
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

      const ragTenantId = resolveTenantIdForOrganization(organizationId);
      const updates: Record<string, unknown> = stampTenantId(
        {
          updatedAt: new Date().toISOString(),
          // Re-stamp tenant fields on every write.
          visibility: 'organization',
          organizationId,
          organization_id: organizationId,
        },
        ragTenantId,
      );
      const body = req.body as Record<string, unknown>;
      if (typeof body.title === 'string') updates.title = body.title.trim();
      if (typeof body.content === 'string') updates.content = body.content;
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
      if (Array.isArray(body.tags)) {
        updates.tags = body.tags.map((t) => String(t).trim()).filter(Boolean);
      }

      const lifecycle = resolveKbLifecycleUpdate({
        existingStatus: String(existing.status || 'Published'),
        existingIndexInRag: existing.index_in_rag !== false,
        nextStatusRaw: typeof body.status === 'string' ? body.status : null,
        nextIndexInRag: typeof body.index_in_rag === 'boolean' ? body.index_in_rag : null,
        outdatedReason:
          typeof body.outdated_reason === 'string'
            ? body.outdated_reason
            : typeof body.outdatedReason === 'string'
              ? body.outdatedReason
              : null,
        actorId: String(req.user?.id || ''),
      });
      if (lifecycle.ok === false) {
        return res.status(400).json({
          error: lifecycle.error || KB_RAG_BLOCKED_STATUS_ERROR,
        });
      }
      Object.assign(updates, lifecycle.patch);

      await updateDocDirect(KB_COLLECTION, id, updates);

      // RAG sync scoped to org tenant — never default Hubcom tenant.
      try {
        const nextStatus = String(updates.status || existing.status || 'Published');
        if (lifecycle.purgeRag || statusBlocksRag(nextStatus) || updates.index_in_rag === false) {
          await deleteEmbeddingsForSource(ragTenantId, 'KB_ARTICLE', id);
        } else if (
          typeof updates.index_in_rag === 'boolean' ||
          updates.content !== undefined ||
          updates.title !== undefined
        ) {
          const { getRagPipelineConfig } = await import('../lib/rag-pipeline-config.js');
          const { drainVectorQueue } = await import('../lib/ai/vector-queue.js');
          const ragConfig = await getRagPipelineConfig(ragTenantId);
          const nextIndexed =
            typeof updates.index_in_rag === 'boolean'
              ? updates.index_in_rag
              : existing.index_in_rag !== false;
          if (ragConfig.indexNewKbArticles && nextIndexed && !statusBlocksRag(nextStatus)) {
            await enqueueKbArticleIndex(id, ragTenantId);
            void drainVectorQueue();
          }
        }
      } catch (err: any) {
        safeLog('warn', '[portal/kb] PATCH RAG sync skipped', err?.message || err);
      }

      const article = await getDocDirect(KB_COLLECTION, id);
      const categoryMap = await loadCategoryNameMap(organizationId);
      return res.json({
        article: sanitizeWithMeta(article || { id }, categoryMap),
        ragTenantId,
      });
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
      const ragTenantId = resolveTenantIdForOrganization(organizationId);
      try {
        await deleteEmbeddingsForSource(ragTenantId, 'KB_ARTICLE', id);
      } catch (err: any) {
        safeLog('warn', '[portal/kb] delete RAG purge skipped', err?.message || err);
      }
      await deleteDocDirect(KB_COLLECTION, id);
      return res.json({ ok: true, ragTenantId });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Artikel konnte nicht gelöscht werden') });
    }
  },
);

export default router;
