/**
 * Org-scoped RAG reindex — rebuild KnowledgeEmbedding only for one organization's KB.
 */

import { getDocsDirect, queryDb } from '../postgres-backend.js';
import { resolveTenantIdForOrganization } from '../client-portal/portal-kb-workspace.js';
import { stampOrganizationEmbeddingModel } from '../client-portal/organizations.js';
import {
  drainVectorQueue,
  enqueueKbArticleIndex,
  getVectorQueueDepth,
} from './vector-queue.js';
import {
  filterKbArticlesForOrgReindex,
  parseOllamaTagsResponse,
  parseOpenAiModelsResponse,
  type LocalServerType,
} from './org-ai-settings.js';

function isPublishedArticle(data: Record<string, unknown>): boolean {
  const status = String(data.status || '').toLowerCase();
  return (
    status === 'published' ||
    status === 'public' ||
    data.visibility === 'Public' ||
    status === ''
  );
}

/**
 * Delete all KnowledgeEmbedding rows for this organization_id, then enqueue
 * re-embed jobs for published KB articles belonging to the org only.
 * Never touches other organizations' vectors.
 */
export async function reindexOrganizationKbRag(organizationId: string): Promise<{
  organizationId: string;
  tenantId: string;
  deletedChunks: number;
  enqueued: number;
  enqueuedIds: string[];
  queueDepth: number;
}> {
  const orgId = String(organizationId || '').trim();
  if (!orgId) {
    throw new Error('organizationId required');
  }
  const tenantId = resolveTenantIdForOrganization(orgId);

  // Purge ONLY this org's vectors (organization_id match — never other orgs).
  const del = await queryDb(
    `DELETE FROM "KnowledgeEmbedding"
     WHERE organization_id = $1
        OR (tenant_id = $2 AND organization_id = $1)`,
    [orgId, tenantId],
  );
  const deletedChunks = del.rowCount || 0;

  const rows = (await getDocsDirect('kb_articles', [])) as Array<Record<string, unknown>>;
  const orgArticles = filterKbArticlesForOrgReindex(
    rows.map((r) => ({
      id: String(r.id || ''),
      organizationId: (r.organizationId as string) || null,
      organization_id: (r.organization_id as string) || null,
      status: r.status,
      visibility: r.visibility,
      index_in_rag: r.index_in_rag,
    })),
    orgId,
  );

  const enqueuedIds: string[] = [];
  for (const article of orgArticles) {
    const id = String(article.id || '').trim();
    if (!id) continue;
    if (!isPublishedArticle(article as Record<string, unknown>)) continue;
    if ((article as any).index_in_rag === false) continue;
    await enqueueKbArticleIndex(id, tenantId);
    enqueuedIds.push(id);
  }

  void drainVectorQueue();
  await stampOrganizationEmbeddingModel(orgId);

  return {
    organizationId: orgId,
    tenantId,
    deletedChunks,
    enqueued: enqueuedIds.length,
    enqueuedIds: enqueuedIds.slice(0, 100),
    queueDepth: await getVectorQueueDepth(),
  };
}

function normalizeLocalBase(endpoint: string): string {
  return String(endpoint || '')
    .trim()
    .replace(/\/v1\/?$/, '')
    .replace(/\/$/, '');
}

/** Count org KB articles vs indexed KnowledgeEmbedding sources (portal RAG status). */
export async function getOrganizationRagStatus(organizationId: string): Promise<{
  indexedCount: number;
  totalCount: number;
  organizationId: string;
}> {
  const orgId = String(organizationId || '').trim();
  const rows = (await getDocsDirect('kb_articles', [])) as Array<Record<string, unknown>>;
  const orgArticles = filterKbArticlesForOrgReindex(
    rows.map((r) => ({
      id: String(r.id || ''),
      organizationId: (r.organizationId as string) || null,
      organization_id: (r.organization_id as string) || null,
      status: r.status,
      visibility: r.visibility,
      index_in_rag: r.index_in_rag,
    })),
    orgId,
  ).filter(
    (a) =>
      isPublishedArticle(a as Record<string, unknown>) &&
      (a as any).index_in_rag !== false,
  );
  const totalCount = orgArticles.length;
  if (!orgId || totalCount === 0) {
    return { indexedCount: 0, totalCount, organizationId: orgId };
  }
  const indexed = await queryDb(
    `SELECT COUNT(DISTINCT source_id)::int AS n
     FROM "KnowledgeEmbedding"
     WHERE organization_id = $1 AND source_type = 'KB_ARTICLE'`,
    [orgId],
  );
  return {
    indexedCount: Number(indexed.rows[0]?.n || 0),
    totalCount,
    organizationId: orgId,
  };
}

/**
 * Discover models from local Ollama (/api/tags) or OpenAI-compat (/v1/models).
 * Never calls cloud providers; never touches /api/db.
 */
export async function discoverOrgLocalModels(params: {
  endpoint: string;
  apiKey?: string | null;
  serverType?: LocalServerType | null;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  models: string[];
  serverType: LocalServerType | 'unknown';
}> {
  const start = Date.now();
  const base = normalizeLocalBase(params.endpoint);
  if (!base) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Bitte eine Server-Adresse (URL) eingeben.',
      models: [],
      serverType: 'unknown',
    };
  }
  const headers: Record<string, string> = {};
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;
  const preferred = params.serverType || null;

  const tryFetch = async (
    path: string,
  ): Promise<{ ok: boolean; status: number; data: unknown } | null> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${base}${path}`, {
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeoutId);
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      return { ok: res.ok || (res.status >= 200 && res.status < 500), status: res.status, data };
    } catch {
      return null;
    }
  };

  const order: Array<{ type: LocalServerType; path: string }> =
    preferred === 'openai_compatible'
      ? [
          { type: 'openai_compatible', path: '/v1/models' },
          { type: 'ollama', path: '/api/tags' },
        ]
      : [
          { type: 'ollama', path: '/api/tags' },
          { type: 'openai_compatible', path: '/v1/models' },
        ];

  for (const attempt of order) {
    const result = await tryFetch(attempt.path);
    if (!result || !result.ok) continue;
    const models =
      attempt.type === 'ollama'
        ? parseOllamaTagsResponse(result.data)
        : parseOpenAiModelsResponse(result.data);
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      latencyMs,
      message: `Verbindung erfolgreich (${latencyMs} ms) — ${models.length} Modell(e) gefunden.`,
      models,
      serverType: attempt.type,
    };
  }

  return {
    ok: false,
    latencyMs: Date.now() - start,
    message: 'Lokaler KI-Server ist unter dieser Adresse nicht erreichbar.',
    models: [],
    serverType: preferred || 'unknown',
  };
}

/** Test connection to org local LLM/embedding endpoint (no cloud). */
export async function testOrgLocalAiConnection(params: {
  endpoint: string;
  apiKey?: string | null;
  model?: string;
  serverType?: LocalServerType | null;
}): Promise<{
  ok: boolean;
  latencyMs: number;
  message: string;
  modelsSample?: string[];
  models?: string[];
  serverType?: LocalServerType | 'unknown';
}> {
  const discovered = await discoverOrgLocalModels({
    endpoint: params.endpoint,
    apiKey: params.apiKey,
    serverType: params.serverType,
  });
  return {
    ok: discovered.ok,
    latencyMs: discovered.latencyMs,
    message: discovered.message,
    modelsSample: discovered.models.slice(0, 12),
    models: discovered.models,
    serverType: discovered.serverType,
  };
}
