/**
 * Kunden-Portal Knowledge Base visibility + tenant isolation helpers.
 *
 * Visibility contract (stored on kb_articles documents):
 *   - internal       — Hubcom staff only (default for legacy Private / unset)
 *   - shared_portal  — published for every Kunden-Portal
 *   - organization   — private to one organizations.id
 *
 * Legacy aliases: Public → shared_portal, Private → internal.
 */

export type PortalKbVisibility = 'internal' | 'shared_portal' | 'organization';

export const PORTAL_KB_VISIBILITY_VALUES: PortalKbVisibility[] = [
  'internal',
  'shared_portal',
  'organization',
];

export function normalizeKbVisibility(raw: unknown): PortalKbVisibility {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (value === 'shared_portal' || value === 'shared' || value === 'public') {
    return 'shared_portal';
  }
  if (value === 'organization' || value === 'org' || value === 'company') {
    return 'organization';
  }
  // Private / internal / empty → Hubcom-only
  return 'internal';
}

export function articleOrganizationId(
  article: Record<string, unknown> | null | undefined,
): string | null {
  if (!article) return null;
  const raw =
    article.organizationId ??
    article.organization_id ??
    (article as any).orgId ??
    null;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).trim();
}

/** True when a CLIENT_* account may list/read this article. */
export function isKbArticleVisibleToPortal(
  article: Record<string, unknown> | null | undefined,
  organizationId: string,
): boolean {
  if (!article || !organizationId) return false;
  const visibility = normalizeKbVisibility(article.visibility);
  if (visibility === 'internal') return false;
  if (visibility === 'shared_portal') return true;
  if (visibility === 'organization') {
    return articleOrganizationId(article) === organizationId;
  }
  return false;
}

export type PortalKbScopeFilter = 'all' | 'organization' | 'shared_portal';

export function matchesPortalKbScope(
  article: Record<string, unknown>,
  organizationId: string,
  scope: PortalKbScopeFilter,
): boolean {
  if (!isKbArticleVisibleToPortal(article, organizationId)) return false;
  const visibility = normalizeKbVisibility(article.visibility);
  if (scope === 'all') return true;
  if (scope === 'shared_portal') return visibility === 'shared_portal';
  if (scope === 'organization') return visibility === 'organization';
  return false;
}

/** Fields safe to return to CLIENT_* roles (no Hubcom-only AI/trust internals). */
export function sanitizeKbArticleForPortal<T extends Record<string, unknown>>(
  article: T,
): Record<string, unknown> {
  const visibility = normalizeKbVisibility(article.visibility);
  return {
    id: article.id,
    title: article.title,
    content: article.content,
    category: article.category,
    subCategory: article.subCategory || '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    visibility,
    organizationId: articleOrganizationId(article),
    status: article.status || 'Published',
    authorId: article.authorId || null,
    owner: article.owner || null,
    createdAt: article.createdAt || null,
    updatedAt: article.updatedAt || null,
    views: typeof article.views === 'number' ? article.views : 0,
    language: article.language || 'de',
  };
}

export function assertPortalKbWriteRole(role: string | null | undefined): boolean {
  return role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER';
}
