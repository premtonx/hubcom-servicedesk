/**
 * Pure helpers for per-organization KnowledgeEmbedding RAG isolation.
 * Safe for unit tests — no I/O.
 */

export type RagOrgScopeParams = {
  /** When set (portal / org ticket), filter embeddings to this org. */
  organizationId?: string | null;
  /**
   * When true with an organizationId, also include Hubcom-global chunks
   * (organization_id IS NULL). Default false = exclusive org RAG.
   */
  includeSharedKb?: boolean;
};

export type EmbeddingOrgRow = {
  organization_id?: string | null;
  organizationId?: string | null;
  tenant_id?: string | null;
  tenantId?: string | null;
  source_id?: string | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  visibility?: string | null;
};

function embeddingVisibility(row: EmbeddingOrgRow): string {
  const raw =
    row.visibility ??
    (row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as any).visibility
      : null);
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (
    value === 'shared_portal' ||
    value === 'shared' ||
    value === 'public' ||
    value === 'global'
  ) {
    return 'shared_portal';
  }
  if (value === 'organization' || value === 'org' || value === 'company' || value === 'tenant') {
    return 'organization';
  }
  return 'internal';
}

/** Resolve organization id stamped on a KB article document. */
export function resolveArticleOrganizationId(
  article: Record<string, unknown> | null | undefined,
): string | null {
  if (!article) return null;
  const raw =
    article.organizationId ??
    article.organization_id ??
    (article.metadata && typeof article.metadata === 'object'
      ? (article.metadata as any).organizationId ??
        (article.metadata as any).organization_id
      : null);
  const id = String(raw || '').trim();
  return id || null;
}

/** Parse org UUID from tenant_id form `org:<uuid>`. */
export function organizationIdFromRagTenant(
  tenantId: string | null | undefined,
): string | null {
  const t = String(tenantId || '').trim();
  if (!t.startsWith('org:')) return null;
  const id = t.slice(4).trim();
  return id || null;
}

export function resolveIncludeSharedKbInRag(
  orgOrSettings:
    | { settings?: Record<string, unknown> | null; include_shared_kb_in_rag?: boolean }
    | Record<string, unknown>
    | null
    | undefined,
): boolean {
  if (!orgOrSettings || typeof orgOrSettings !== 'object') return false;
  const direct = (orgOrSettings as any).include_shared_kb_in_rag;
  if (direct === true) return true;
  const settings = ((orgOrSettings as any).settings || {}) as Record<string, unknown>;
  return (
    settings.include_shared_kb_in_rag === true ||
    settings.includeSharedKbInRag === true
  );
}

/**
 * Whether an embedding row is visible under the given org scope.
 * - No organizationId → staff/global: only rows with NULL organization_id
 *   (never leak customer-private vectors into Hubcom-default search).
 * - With organizationId + includeSharedKb=false → exclusive match.
 * - With organizationId + includeSharedKb=true → org rows OR NULL (shared).
 */
export function embeddingMatchesOrgScope(
  row: EmbeddingOrgRow,
  scope: RagOrgScopeParams,
): boolean {
  const rowOrg = String(
    row.organization_id ??
      row.organizationId ??
      (row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as any).organization_id ??
          (row.metadata as any).organizationId
        : '') ??
      '',
  ).trim();
  const orgId = String(scope.organizationId || '').trim();

  if (!orgId) {
    // Hubcom staff / no org override — never surface customer-private chunks.
    return !rowOrg;
  }

  if (rowOrg === orgId) return true;
  // Shared Hubcom guides only — never internal staff docs with NULL organization_id.
  if (scope.includeSharedKb === true && !rowOrg && embeddingVisibility(row) === 'shared_portal') {
    return true;
  }
  return false;
}

/** Filter in-memory embedding hits (unit tests + defense-in-depth post-filter). */
export function filterEmbeddingsByOrganization<T extends EmbeddingOrgRow>(
  rows: T[],
  scope: RagOrgScopeParams,
): T[] {
  return rows.filter((row) => embeddingMatchesOrgScope(row, scope));
}

/**
 * Build SQL AND-clause fragments + bind values for organization scoping.
 * Caller appends after `WHERE tenant_id = $N`.
 * Returns `{ clause, values }` where clause starts with ` AND …` or is empty.
 */
export function buildRagOrganizationSqlFilter(
  scope: RagOrgScopeParams,
  nextParamIndex: number,
): { clause: string; values: string[]; nextIndex: number } {
  const orgId = String(scope.organizationId || '').trim();
  if (!orgId) {
    // Staff / global tenant search: exclude any org-owned private vectors.
    return {
      clause: ` AND (organization_id IS NULL OR TRIM(organization_id) = '')`,
      values: [],
      nextIndex: nextParamIndex,
    };
  }
  if (scope.includeSharedKb === true) {
    // Own-org chunks OR shared_portal/global (NULL org + visibility) — never internal Hubcom.
    return {
      clause: ` AND (
        organization_id = $${nextParamIndex}
        OR (
          (organization_id IS NULL OR TRIM(COALESCE(organization_id, '')) = '')
          AND lower(replace(trim(COALESCE(metadata->>'visibility', '')), '-', '_'))
            IN ('shared_portal', 'shared', 'public', 'global')
        )
      )`,
      values: [orgId],
      nextIndex: nextParamIndex + 1,
    };
  }
  return {
    clause: ` AND organization_id = $${nextParamIndex}`,
    values: [orgId],
    nextIndex: nextParamIndex + 1,
  };
}
