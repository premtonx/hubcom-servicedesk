/**
 * Kunden-Portal KB adapter — KnowledgeBaseWorkbench ↔ /api/portal/kb* only.
 * Never calls staff DB/KB analytics or AI endpoints — portal KB REST only.
 */

import { useMemo } from 'react';
import axios from 'axios';
import type { KbWorkbenchAdapter } from '../lib/kb/kb-workbench-adapter';
import type { KBArticle } from '../types';
import type { KBCategoryDto } from '../services/kbDashboardApi';

const PORTAL_KB = '/api/portal/kb';
const PORTAL_KB_CATEGORIES = '/api/portal/kb/categories';
const POLL_MS = 20_000;

type PortalWorkspaceSnapshot = {
  publishedCount?: number;
  draftCount?: number;
  reviewsCount?: number;
  kbHealthScore?: number;
  monthlyViews?: number;
  missingTagsCount?: number;
  outdatedCount?: number;
  aiInsights?: {
    reviewNeeded?: number;
    missingTags?: number;
    outdated?: number;
    recommendations?: number;
  };
  popularArticles?: Array<{ id: string; title: string }>;
  missingArticles?: Array<{ id: string; title: string }>;
  staleArticles?: Array<{ id: string; title: string }>;
};

let cachedWorkspace: PortalWorkspaceSnapshot | null = null;

function toKbArticle(row: Record<string, unknown>): KBArticle {
  const views =
    typeof row.views === 'number'
      ? row.views
      : typeof row.view_count === 'number'
        ? row.view_count
        : 0;
  const helpful =
    typeof row.helpfulCount === 'number'
      ? row.helpfulCount
      : typeof row.helpful_count === 'number'
        ? row.helpful_count
        : 0;
  return {
    id: String(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    category: String(row.category || row.category_id || 'uncategorized'),
    subCategory: String(row.subCategory || ''),
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)) : [],
    visibility: (row.visibility as KBArticle['visibility']) || 'organization',
    organizationId: (row.organizationId as string | null | undefined) ?? null,
    organization_id: (row.organizationId as string | null | undefined) ?? null,
    status: String(row.status || 'Published'),
    owner: String(row.owner || row.author_name || ''),
    authorId: row.authorId != null ? String(row.authorId) : undefined,
    views,
    helpfulCount: helpful,
    language: String(row.language || 'de'),
    createdAt: (row.createdAt || row.created_at) as any,
    updatedAt: (row.updatedAt || row.updated_at) as any,
    index_in_rag: row.index_in_rag !== false,
  } as KBArticle;
}

function buildPortalCoverageFromArticles(articles: KBArticle[], workspace: PortalWorkspaceSnapshot | null) {
  const byCategory = new Map<string, { total: number; published: number; draft: number; untagged: number }>();
  for (const a of articles) {
    const key = String(a.category || 'uncategorized');
    const row = byCategory.get(key) || { total: 0, published: 0, draft: 0, untagged: 0 };
    row.total += 1;
    if (String(a.status || '').toLowerCase() === 'published') row.published += 1;
    if (String(a.status || '').toLowerCase() === 'draft') row.draft += 1;
    if (!a.tags || a.tags.length === 0) row.untagged += 1;
    byCategory.set(key, row);
  }
  const categories = Array.from(byCategory.entries()).map(([categoryId, stats]) => ({
    categoryId,
    categoryName: categoryId,
    expected: Math.max(stats.total, 1),
    existingMatched: stats.published,
    missing: stats.untagged + stats.draft,
    coverage:
      stats.total === 0 ? 0 : Math.round((stats.published / Math.max(stats.total, 1)) * 100),
  }));
  const total = articles.length;
  const published = articles.filter((a) => String(a.status || '').toLowerCase() === 'published').length;
  const missing = workspace?.missingArticles?.length ?? articles.filter((a) => !a.tags?.length).length;
  const overallPercentage =
    typeof workspace?.kbHealthScore === 'number'
      ? workspace.kbHealthScore
      : total === 0
        ? 0
        : Math.round((published / total) * 100);
  return {
    overallPercentage,
    overallCoverage: overallPercentage,
    totalExpected: total,
    totalExistingMatched: published,
    totalMissing: missing,
    healthStatus: overallPercentage >= 70 ? 'Healthy' : overallPercentage >= 40 ? 'Fair' : 'Empty',
    health: overallPercentage >= 70 ? 'Healthy' : overallPercentage >= 40 ? 'Fair' : 'Empty',
    categories,
    aiSuggestions: (workspace?.missingArticles || [])
      .slice(0, 8)
      .map((a) => ({ title: a.title, reason: 'Fehlende Tags / Lücke', id: a.id })),
    criticalGaps: (workspace?.staleArticles || [])
      .slice(0, 8)
      .map((a) => ({ title: a.title, id: a.id })),
  };
}

async function fetchPortalList(): Promise<{
  articles: KBArticle[];
  workspace: PortalWorkspaceSnapshot | null;
}> {
  const res = await axios.get(PORTAL_KB, {
    params: { scope: 'all' },
    withCredentials: true,
  });
  const rows = Array.isArray(res.data?.articles) ? res.data.articles : [];
  const workspace =
    res.data?.workspace && typeof res.data.workspace === 'object'
      ? (res.data.workspace as PortalWorkspaceSnapshot)
      : {
          publishedCount: res.data?.publishedCount,
          draftCount: res.data?.draftCount,
          reviewsCount: res.data?.reviewsCount,
          kbHealthScore: res.data?.kbHealthScore,
          monthlyViews: res.data?.monthlyViews,
          aiInsights: res.data?.aiInsights,
          popularArticles: res.data?.popularArticles,
          missingArticles: res.data?.missingArticles,
          staleArticles: res.data?.staleArticles,
        };
  cachedWorkspace = workspace;
  return {
    articles: rows.map((row: Record<string, unknown>) => toKbArticle(row)),
    workspace,
  };
}

export function usePortalKbAdapter(): KbWorkbenchAdapter {
  return useMemo(() => {
    const listeners = new Set<(articles: KBArticle[]) => void>();
    let latestArticles: KBArticle[] = [];

    const notify = (articles: KBArticle[]) => {
      latestArticles = articles;
      listeners.forEach((cb) => cb(articles));
    };

    const refresh = async () => {
      const { articles } = await fetchPortalList();
      notify(articles);
      return articles;
    };

    const adapter: KbWorkbenchAdapter = {
      subscribeArticles(callback) {
        listeners.add(callback);
        let cancelled = false;
        void (async () => {
          try {
            const { articles } = await fetchPortalList();
            if (!cancelled) notify(articles);
          } catch {
            if (!cancelled) notify([]);
          }
        })();
        const timer = setInterval(() => {
          void refresh().catch(() => undefined);
        }, POLL_MS);
        return () => {
          cancelled = true;
          listeners.delete(callback);
          clearInterval(timer);
        };
      },

      async createArticle(article) {
        const category = String(article.category || '').trim();
        const res = await axios.post(
          PORTAL_KB,
          {
            title: article.title,
            content: article.content,
            category: category && category !== 'All' ? category : 'uncategorized',
            tags: article.tags || [],
            status: article.status || 'Published',
            index_in_rag: article.index_in_rag === true,
          },
          { withCredentials: true },
        );
        await refresh();
        return res.data?.article?.id ? String(res.data.article.id) : undefined;
      },

      async updateArticle(id, patch) {
        const body: Record<string, unknown> = {};
        if (patch.title !== undefined) body.title = patch.title;
        if (patch.content !== undefined) body.content = patch.content;
        if (patch.category !== undefined) body.category = patch.category;
        if (patch.tags !== undefined) body.tags = patch.tags;
        if (patch.status !== undefined) body.status = patch.status;
        if (patch.index_in_rag !== undefined) body.index_in_rag = patch.index_in_rag;
        const reason =
          (patch as any).outdated_reason ?? (patch as any).outdatedReason;
        if (typeof reason === 'string') body.outdated_reason = reason;
        const res = await axios.patch(`${PORTAL_KB}/${encodeURIComponent(id)}`, body, {
          withCredentials: true,
        });
        if (res.data?.error) {
          throw new Error(String(res.data.error));
        }
        await refresh();
        return res.data?.article;
      },

      async deleteArticle(id) {
        await axios.delete(`${PORTAL_KB}/${encodeURIComponent(id)}`, {
          withCredentials: true,
        });
        await refresh();
      },

      async deleteArticles(items) {
        for (const item of items) {
          await axios.delete(`${PORTAL_KB}/${encodeURIComponent(item.id)}`, {
            withCredentials: true,
          });
        }
        await refresh();
      },

      async listCategories() {
        const res = await axios.get(PORTAL_KB_CATEGORIES, { withCredentials: true });
        return (res.data?.categories || []) as KBCategoryDto[];
      },

      async createCategory(payload) {
        const res = await axios.post(
          PORTAL_KB_CATEGORIES,
          { name: payload.name, desc: payload.desc, order: payload.order, iconName: payload.iconName },
          { withCredentials: true },
        );
        return res.data.category as KBCategoryDto;
      },

      async updateCategory(id, payload) {
        const res = await axios.patch(
          `${PORTAL_KB_CATEGORIES}/${encodeURIComponent(id)}`,
          payload,
          { withCredentials: true },
        );
        return res.data.category as KBCategoryDto;
      },

      async removeCategory(id, strategy) {
        const res = await axios.delete(`${PORTAL_KB_CATEGORIES}/${encodeURIComponent(id)}`, {
          withCredentials: true,
          data: { strategy },
        });
        return res.data as { success: boolean; strategy: string; affectedCount: number };
      },

      async getGlobalSettings() {
        const health = cachedWorkspace?.kbHealthScore;
        if (typeof health === 'number') {
          return { healthScore: health };
        }
        return null;
      },

      async setIndexInRag(articleId, indexInRag) {
        await axios.patch(
          `${PORTAL_KB}/${encodeURIComponent(articleId)}`,
          { index_in_rag: indexInRag },
          { withCredentials: true },
        );
        await refresh();
      },

      async listPortalOrganizations() {
        return [];
      },

      async listAssignableUsers() {
        return [];
      },

      async importCsvArticles(payload) {
        const res = await axios.post(
          `${PORTAL_KB}/import`,
          {
            category: payload.category,
            publishImmediately: payload.publishImmediately,
            csv: payload.csv,
            articles: payload.articles,
            dryRun: payload.dryRun,
          },
          { withCredentials: true },
        );
        await refresh();
        return {
          imported: Number(res.data?.imported || 0),
          skipped: Number(res.data?.skipped || 0),
          errors: Array.isArray(res.data?.errors) ? res.data.errors.map(String) : [],
          attachmentSharePointIds: Array.isArray(res.data?.attachmentSharePointIds)
            ? res.data.attachmentSharePointIds.map(String)
            : [],
          summary: String(res.data?.summary || ''),
        };
      },

      /** Analytik — derived from portal workspace (never staff coverage routes). */
      async fetchCoverage() {
        if (!latestArticles.length) {
          try {
            await refresh();
          } catch {
            /* ignore */
          }
        }
        return buildPortalCoverageFromArticles(latestArticles, cachedWorkspace);
      },

      async recalculateCoverage() {
        await refresh();
        return buildPortalCoverageFromArticles(latestArticles, cachedWorkspace);
      },

      isAiSearchConfigured() {
        return true;
      },

      async askPortalAi(query) {
        const res = await axios.post(
          `${PORTAL_KB}/ai-ask`,
          { query },
          { withCredentials: true },
        );
        const snippets = Array.isArray(res.data?.snippets)
          ? res.data.snippets.map((s: Record<string, unknown>) => ({
              text: String(s.text || ''),
              sourceTitle: String(s.sourceTitle || ''),
              source: String(s.source || 'Knowledge Base'),
              sourceId: s.sourceId != null ? String(s.sourceId) : undefined,
            }))
          : [];
        return {
          answer: String(res.data?.answer || ''),
          snippets,
        };
      },

      async generatePortalArticle(payload) {
        const res = await axios.post(
          `${PORTAL_KB}/ai-generate`,
          {
            subject: payload.subject,
            description: payload.description || '',
          },
          { withCredentials: true },
        );
        return {
          title: String(res.data?.title || payload.subject),
          content: String(res.data?.content || ''),
        };
      },

      async answerKnowledgeQuery(query) {
        const result = await adapter.askPortalAi?.(query);
        return result?.answer || '';
      },

      findRelevantContext() {
        return [];
      },
    };

    return adapter;
  }, []);
}
