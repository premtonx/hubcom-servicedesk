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
import { filterKbArticlesForOrgReindex } from './org-ai-settings.js';

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

/** Test connection to org local LLM/embedding endpoint (no cloud). */
export async function testOrgLocalAiConnection(params: {
  endpoint: string;
  apiKey?: string | null;
  model?: string;
}): Promise<{ ok: boolean; latencyMs: number; message: string; modelsSample?: string[] }> {
  const start = Date.now();
  const base = String(params.endpoint || '')
    .trim()
    .replace(/\/v1\/?$/, '')
    .replace(/\/$/, '');
  if (!base) {
    return {
      ok: false,
      latencyMs: 0,
      message: 'Kein local_llm_endpoint konfiguriert.',
    };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = {};
    if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

    // Prefer OpenAI-compat /v1/models; fall back to Ollama /api/tags.
    let res = await fetch(`${base}/v1/models`, {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      res = await fetch(`${base}/api/tags`, {
        signal: controller.signal,
        headers,
      });
    }
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;
    if (res.status >= 200 && res.status < 500) {
      let modelsSample: string[] = [];
      try {
        const data = (await res.json()) as any;
        const list = data?.data || data?.models || [];
        if (Array.isArray(list)) {
          modelsSample = list
            .slice(0, 8)
            .map((m: any) => String(m?.id || m?.name || ''))
            .filter(Boolean);
        }
      } catch {
        /* ignore parse */
      }
      return {
        ok: true,
        latencyMs,
        message: `Verbindung OK (${latencyMs} ms)`,
        modelsSample,
      };
    }
    return {
      ok: false,
      latencyMs,
      message: `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message:
        err instanceof Error
          ? err.name === 'AbortError'
            ? 'Timeout — Endpunkt nicht erreichbar'
            : err.message
          : String(err),
    };
  }
}
