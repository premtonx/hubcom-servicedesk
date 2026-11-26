/**
 * Pure portal KB workspace helpers — metrics, smart lists, TOC, org RAG tenant.
 * Used by /api/portal/kb* and unit-tested in portal-isolation (no Express I/O).
 */

import {
  computeDashboardMetrics,
  getArticleTimestamp,
  isDraftStatus,
  isOutdatedStatus,
  isPublishedStatus,
  isReviewStatus,
  resolveArticleAuthorName,
  type KBDashboardMetrics,
} from '../kb-dashboard-metrics.js';
import {
  isKbArticleVisibleToPortal,
  matchesPortalKbScope,
  type PortalKbScopeFilter,
} from './kb-visibility.js';

export const PORTAL_KB_TENANT_PREFIX = 'org:';

/** Stable RAG / vector tenant id for a Kunden-Portal organization. */
export function resolveTenantIdForOrganization(organizationId: string): string {
  const id = String(organizationId || '').trim();
  if (!id) return 'default';
  if (id.startsWith(PORTAL_KB_TENANT_PREFIX)) return id;
  return `${PORTAL_KB_TENANT_PREFIX}${id}`;
}

/** Extract organization UUID from an org-scoped RAG tenant id (or null). */
export function organizationIdFromPortalKbTenant(tenantId: string): string | null {
  const raw = String(tenantId || '').trim();
  if (!raw.startsWith(PORTAL_KB_TENANT_PREFIX)) return null;
  const orgId = raw.slice(PORTAL_KB_TENANT_PREFIX.length).trim();
  return orgId || null;
}

export type PortalKbArticleLike = {
  id?: string;
  title?: string;
  content?: string;
  status?: string;
  views?: number;
  tags?: string[];
  trustScore?: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  owner?: string;
  author?: string;
  authorName?: string;
  authorId?: string;
  category?: string;
  visibility?: string;
  organizationId?: string | null;
  organization_id?: string | null;
  helpfulCount?: number;
  helpful_count?: number;
  index_in_rag?: boolean;
};

export type PortalKbTocHeading = {
  id: string;
  text: string;
  level: number;
};

/** Lightweight TOC from HTML/markdown headings (no DOM). */
export function extractPortalKbToc(content: unknown): PortalKbTocHeading[] {
  const raw = String(content || '');
  if (!raw.trim()) return [];
  const headings: PortalKbTocHeading[] = [];
  const htmlRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = htmlRe.exec(raw)) !== null) {
    const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    headings.push({
      id: slug || `heading-${i}`,
      text,
      level: Number(match[1]) || 2,
    });
    i += 1;
    if (headings.length >= 40) break;
  }
  if (headings.length > 0) return headings;

  const mdRe = /^(#{1,6})\s+(.+)$/gm;
  while ((match = mdRe.exec(raw)) !== null) {
    const text = match[2].trim();
    if (!text) continue;
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    headings.push({
      id: slug || `heading-${i}`,
      text,
      level: match[1].length,
    });
    i += 1;
    if (headings.length >= 40) break;
  }
  return headings;
}

/** Fallback health when articles lack trustScore (common for portal-created docs). */
export function computePortalKbHealthScore(articles: PortalKbArticleLike[]): number {
  if (!articles.length) return 0;
  const withTrust = articles.filter((a) => Number(a.trustScore) > 0);
  if (withTrust.length > 0) {
    const sum = withTrust.reduce((acc, a) => acc + Number(a.trustScore || 0), 0);
    return Math.round(sum / withTrust.length);
  }
  const published = articles.filter((a) => isPublishedStatus(a.status)).length;
  const tagged = articles.filter((a) => Array.isArray(a.tags) && a.tags.length > 0).length;
  const now = Date.now();
  const fresh = articles.filter((a) => {
    const ts = getArticleTimestamp(a);
    return ts > 0 && now - ts < 90 * 24 * 60 * 60 * 1000;
  }).length;
  const n = articles.length;
  const score =
    (published / n) * 45 +
    (tagged / n) * 30 +
    (fresh / n) * 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type PortalKbArticleSummary = {
  id: string;
  title: string;
  status: string;
  views: number;
  category: string;
  updatedAt: string | null;
  author_name: string;
};

function toSummary(a: PortalKbArticleLike): PortalKbArticleSummary {
  return {
    id: String(a.id || ''),
    title: String(a.title || ''),
    status: String(a.status || 'Published'),
    views: Number(a.views || 0),
    category: String(a.category || ''),
    updatedAt:
      typeof a.updatedAt === 'string'
        ? a.updatedAt
        : a.updatedAt
          ? new Date(getArticleTimestamp(a)).toISOString()
          : null,
    author_name: resolveArticleAuthorName(a),
  };
}

export function buildPopularArticles(
  articles: PortalKbArticleLike[],
  limit = 5,
): PortalKbArticleSummary[] {
  return [...articles]
    .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
    .slice(0, limit)
    .map(toSummary);
}

export function buildRecentlyUpdatedArticles(
  articles: PortalKbArticleLike[],
  limit = 5,
): PortalKbArticleSummary[] {
  return [...articles]
    .sort((a, b) => getArticleTimestamp(b) - getArticleTimestamp(a))
    .slice(0, limit)
    .map(toSummary);
}

export function buildMostViewedArticles(
  articles: PortalKbArticleLike[],
  limit = 5,
): PortalKbArticleSummary[] {
  return buildPopularArticles(articles, limit);
}

export function buildMissingArticles(
  articles: PortalKbArticleLike[],
  limit = 10,
): PortalKbArticleSummary[] {
  return articles
    .filter((a) => !a.tags || a.tags.length === 0)
    .slice(0, limit)
    .map(toSummary);
}

export function buildStaleArticles(
  articles: PortalKbArticleLike[],
  limit = 10,
  staleMs = 180 * 24 * 60 * 60 * 1000,
  ref = Date.now(),
): PortalKbArticleSummary[] {
  return articles
    .filter((a) => {
      if (isOutdatedStatus(a.status)) return true;
      const ts = getArticleTimestamp(a);
      return ts > 0 && ref - ts > staleMs;
    })
    .sort((a, b) => getArticleTimestamp(a) - getArticleTimestamp(b))
    .slice(0, limit)
    .map(toSummary);
}

export function buildRecentActivity(
  articles: PortalKbArticleLike[],
  limit = 8,
): Array<{
  id: string;
  title: string;
  meta: string;
  type: 'edited' | 'published';
  at: string | null;
}> {
  return [...articles]
    .sort((a, b) => getArticleTimestamp(b) - getArticleTimestamp(a))
    .slice(0, limit)
    .map((art) => {
      const at =
        typeof art.updatedAt === 'string'
          ? art.updatedAt
          : art.updatedAt
            ? new Date(getArticleTimestamp(art)).toISOString()
            : null;
      const published = isPublishedStatus(art.status);
      return {
        id: String(art.id || ''),
        title: String(art.title || ''),
        meta: published
          ? `Veröffentlicht · ${resolveArticleAuthorName(art)}`
          : `Bearbeitet von ${resolveArticleAuthorName(art)}`,
        type: published ? ('published' as const) : ('edited' as const),
        at,
      };
    });
}

export function buildTopContributors(
  articles: PortalKbArticleLike[],
  limit = 5,
): Array<{ name: string; count: number; initial: string }> {
  const counts = new Map<string, number>();
  for (const a of articles) {
    const name = resolveArticleAuthorName(a);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({
      name,
      count,
      initial: name.charAt(0).toUpperCase(),
    }));
}

export type PortalKbWorkspacePayload = {
  publishedCount: number;
  draftCount: number;
  reviewsCount: number;
  kbHealthScore: number;
  monthlyViews: number;
  missingTagsCount: number;
  outdatedCount: number;
  recentActivity: ReturnType<typeof buildRecentActivity>;
  topContributors: ReturnType<typeof buildTopContributors>;
  aiInsights: {
    reviewNeeded: number;
    missingTags: number;
    outdated: number;
    recommendations: number;
  };
  popularArticles: PortalKbArticleSummary[];
  recentlyUpdatedArticles: PortalKbArticleSummary[];
  mostViewedArticles: PortalKbArticleSummary[];
  missingArticles: PortalKbArticleSummary[];
  staleArticles: PortalKbArticleSummary[];
  trends: KBDashboardMetrics['trends'];
  ragTenantId: string;
};

export function filterPortalVisibleArticles<T extends PortalKbArticleLike>(
  articles: T[],
  organizationId: string,
  scope: PortalKbScopeFilter = 'all',
): T[] {
  return articles.filter((row) =>
    matchesPortalKbScope(row as Record<string, unknown>, organizationId, scope),
  );
}

export function computePortalKbWorkspace(
  articles: PortalKbArticleLike[],
  organizationId: string,
): PortalKbWorkspacePayload {
  const metrics = computeDashboardMetrics(articles);
  const kbHealthScore =
    metrics.healthScore > 0 ? metrics.healthScore : computePortalKbHealthScore(articles);
  const missingTagsCount = metrics.missingTagsCount;
  const outdatedCount = metrics.outdatedCount;
  const reviewsCount = metrics.reviewCount;

  return {
    publishedCount: metrics.publishedCount,
    draftCount: metrics.draftCount,
    reviewsCount,
    kbHealthScore,
    monthlyViews: metrics.monthlyViews,
    missingTagsCount,
    outdatedCount,
    recentActivity: buildRecentActivity(articles),
    topContributors: buildTopContributors(articles),
    aiInsights: {
      reviewNeeded: reviewsCount,
      missingTags: missingTagsCount,
      outdated: outdatedCount,
      recommendations: missingTagsCount + outdatedCount + reviewsCount,
    },
    popularArticles: buildPopularArticles(articles),
    recentlyUpdatedArticles: buildRecentlyUpdatedArticles(articles),
    mostViewedArticles: buildMostViewedArticles(articles),
    missingArticles: buildMissingArticles(articles),
    staleArticles: buildStaleArticles(articles),
    trends: metrics.trends,
    ragTenantId: resolveTenantIdForOrganization(organizationId),
  };
}

/** Keyword relevance over org-visible articles (no cross-tenant vectors). */
export function portalKbKeywordSearch(
  query: string,
  articles: PortalKbArticleLike[],
  limit = 8,
): Array<{
  sourceId: string;
  sourceTitle: string;
  text: string;
  score: number;
}> {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  const scored = articles
    .map((a) => {
      const title = String(a.title || '').toLowerCase();
      const content = String(a.content || '')
        .replace(/<[^>]+>/g, ' ')
        .toLowerCase();
      const tags = (a.tags || []).join(' ').toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (tags.includes(term)) score += 2;
        if (content.includes(term)) score += 1;
      }
      const snippet =
        content.slice(Math.max(0, content.indexOf(terms[0] || '') - 40), 280).trim() ||
        content.slice(0, 280);
      return {
        sourceId: String(a.id || ''),
        sourceTitle: String(a.title || ''),
        text: snippet,
        score,
      };
    })
    .filter((r) => r.score > 0 && r.sourceId)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored;
}

/** Assert RAG tenant id is locked to the session organization (unit-tested). */
export function assertPortalKbRagTenantMatchesOrg(
  tenantId: string,
  organizationId: string,
): boolean {
  return resolveTenantIdForOrganization(organizationId) === String(tenantId || '').trim();
}

export function assertArticlesIsolatedToOrg(
  articles: PortalKbArticleLike[],
  organizationId: string,
): boolean {
  return articles.every((a) => isKbArticleVisibleToPortal(a as Record<string, unknown>, organizationId));
}

export {
  isDraftStatus,
  isPublishedStatus,
  isReviewStatus,
  isOutdatedStatus,
};
