/**
 * Portal ticket-deflection KB suggestions — org-scoped, published-only (pure).
 */

import { isPublishedStatus } from '../kb-dashboard-metrics.js';
import { isKbArticleVisibleToPortal } from '../client-portal/kb-visibility.js';
import { portalKbKeywordSearch } from '../client-portal/portal-kb-workspace.js';

export const PORTAL_KB_SUGGEST_MIN_QUERY = 4;
export const PORTAL_KB_SUGGEST_LIMIT = 3;

export type PortalKbSuggestArticleLike = {
  id?: string;
  title?: string;
  content?: string;
  status?: string;
  category?: string;
  category_id?: string;
  categoryName?: string | null;
  category_name?: string | null;
  tags?: string[];
  organizationId?: string | null;
  organization_id?: string | null;
  visibility?: string | null;
  deflected_count?: number | null;
};

export type PortalKbSuggestHit = {
  id: string;
  title: string;
  snippet: string;
  category_name: string | null;
  score: number;
};

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Articles eligible for deflection: published + visible to this portal org. */
export function filterArticlesForPortalSuggest(
  articles: PortalKbSuggestArticleLike[],
  organizationId: string,
): PortalKbSuggestArticleLike[] {
  const orgId = String(organizationId || '').trim();
  if (!orgId) return [];
  return articles.filter((a) => {
    if (!isPublishedStatus(a.status)) return false;
    return isKbArticleVisibleToPortal(a as Record<string, unknown>, orgId);
  });
}

export function scorePortalKbSuggest(
  query: string,
  articles: PortalKbSuggestArticleLike[],
  limit = PORTAL_KB_SUGGEST_LIMIT,
): PortalKbSuggestHit[] {
  const q = String(query || '').trim();
  if (q.length < PORTAL_KB_SUGGEST_MIN_QUERY) return [];

  const scored = portalKbKeywordSearch(q, articles as any, Math.max(limit, 8));
  const byId = new Map(articles.map((a) => [String(a.id || ''), a]));

  return scored
    .map((row) => {
      const article = byId.get(row.sourceId);
      const category_name =
        (article &&
          (article.category_name ||
            article.categoryName ||
            (article.category && article.category !== 'uncategorized'
              ? String(article.category)
              : null))) ||
        null;
      return {
        id: row.sourceId,
        title: row.sourceTitle || String(article?.title || 'Artikel'),
        snippet: stripHtml(row.text).slice(0, 220),
        category_name: category_name ? String(category_name) : null,
        score: row.score,
      };
    })
    .filter((h) => h.id)
    .slice(0, limit);
}

/** Merge optional vector/hybrid sourceIds as a score boost (pure). */
export function mergeSuggestWithHybridBoost(
  keywordHits: PortalKbSuggestHit[],
  hybridSourceIds: string[],
  limit = PORTAL_KB_SUGGEST_LIMIT,
): PortalKbSuggestHit[] {
  const boost = new Set(hybridSourceIds.map((id) => String(id).trim()).filter(Boolean));
  const ranked = keywordHits
    .map((h) => ({
      ...h,
      score: h.score + (boost.has(h.id) ? 10 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  // Prefer hybrid-first ids that weren't in keyword set only if we have article titles already —
  // keywordHits already cover published org articles; boost reorders.
  return ranked.slice(0, limit);
}

export function incrementDeflectedCount(current: unknown): number {
  const n = Number(current);
  return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
}

/** Assert suggest results never include other-org or non-published articles. */
export function assertSuggestHitsIsolated(
  hits: PortalKbSuggestHit[],
  articles: PortalKbSuggestArticleLike[],
  organizationId: string,
): boolean {
  const byId = new Map(articles.map((a) => [String(a.id || ''), a]));
  return hits.every((h) => {
    const a = byId.get(h.id);
    if (!a) return false;
    if (!isPublishedStatus(a.status)) return false;
    return isKbArticleVisibleToPortal(a as Record<string, unknown>, organizationId);
  });
}
