/**
 * KB article lifecycle — outdated / archived / RAG eligibility (pure helpers).
 */

import {
  isOutdatedStatus,
  isPublishedStatus,
  normalizeKbStatus,
} from '../kb-dashboard-metrics.js';

export const KB_RAG_BLOCKED_STATUS_ERROR =
  'Veraltete oder archivierte Artikel können nicht in den KI-Wissensspeicher aufgenommen werden.';

export const KB_OUTDATED_STATUSES = ['outdated', 'archived', 'draft'] as const;

export type KbLifecycleStatus =
  | 'Published'
  | 'Draft'
  | 'Outdated'
  | 'Archived'
  | 'Needs Review';

/** Canonical stored status strings used across staff + portal. */
export function toStoredKbStatus(raw: string | null | undefined): KbLifecycleStatus | null {
  const n = normalizeKbStatus(raw || undefined);
  if (n === 'published') return 'Published';
  if (n === 'draft') return 'Draft';
  if (n === 'outdated') return 'Outdated';
  if (n === 'archived') return 'Archived';
  if (n === 'review') return 'Needs Review';
  return null;
}

/** Statuses that must never be indexed / returned by RAG. */
export function statusBlocksRag(status?: string | null): boolean {
  const n = normalizeKbStatus(status || undefined);
  return n === 'outdated' || n === 'archived' || n === 'draft' || n === 'review';
}

/** Article may be in AI knowledge store only when published and index_in_rag. */
export function isArticleEligibleForRag(article: {
  status?: string | null;
  index_in_rag?: boolean | null;
}): boolean {
  if (!isPublishedStatus(article.status || undefined)) return false;
  if (article.index_in_rag === false) return false;
  return true;
}

export function assertCanEnableRagIndex(status?: string | null): {
  ok: boolean;
  error?: string;
} {
  if (statusBlocksRag(status) || !isPublishedStatus(status || undefined)) {
    return { ok: false, error: KB_RAG_BLOCKED_STATUS_ERROR };
  }
  return { ok: true };
}

export interface MarkOutdatedPatch {
  status: 'Outdated';
  index_in_rag: false;
  outdated_at: string;
  outdated_reason: string | null;
  outdated_by: string | null;
  updatedAt: string;
}

export function buildMarkOutdatedPatch(params: {
  reason?: string | null;
  actorId?: string | null;
  now?: Date;
}): MarkOutdatedPatch {
  const now = params.now || new Date();
  const reason = String(params.reason || '')
    .trim()
    .slice(0, 2000);
  return {
    status: 'Outdated',
    index_in_rag: false,
    outdated_at: now.toISOString(),
    outdated_reason: reason || null,
    outdated_by: params.actorId ? String(params.actorId).trim() || null : null,
    updatedAt: now.toISOString(),
  };
}

export interface MarkArchivedPatch {
  status: 'Archived';
  index_in_rag: false;
  outdated_at: string;
  outdated_reason: string | null;
  outdated_by: string | null;
  updatedAt: string;
}

export function buildMarkArchivedPatch(params: {
  reason?: string | null;
  actorId?: string | null;
  now?: Date;
}): MarkArchivedPatch {
  const base = buildMarkOutdatedPatch(params);
  return { ...base, status: 'Archived' };
}

export interface RepublishPatch {
  status: 'Published';
  outdated_at: null;
  outdated_reason: null;
  outdated_by: null;
  updatedAt: string;
  index_in_rag?: boolean;
}

export function buildRepublishPatch(params: {
  reenableRag?: boolean;
  now?: Date;
}): RepublishPatch {
  const now = params.now || new Date();
  const patch: RepublishPatch = {
    status: 'Published',
    outdated_at: null,
    outdated_reason: null,
    outdated_by: null,
    updatedAt: now.toISOString(),
  };
  if (params.reenableRag === true) {
    patch.index_in_rag = true;
  }
  return patch;
}

/**
 * Resolve PATCH/update body for status + index_in_rag with lifecycle rules.
 * Returns error when RAG enable is blocked; otherwise patch fields to merge.
 */
export function resolveKbLifecycleUpdate(params: {
  existingStatus?: string | null;
  existingIndexInRag?: boolean | null;
  nextStatusRaw?: string | null;
  nextIndexInRag?: boolean | null;
  outdatedReason?: string | null;
  actorId?: string | null;
  now?: Date;
}): { ok: true; patch: Record<string, unknown>; purgeRag: boolean } | { ok: false; error: string } {
  const now = params.now || new Date();
  const patch: Record<string, unknown> = { updatedAt: now.toISOString() };
  let nextStatus = params.existingStatus || 'Published';

  if (params.nextStatusRaw != null && String(params.nextStatusRaw).trim() !== '') {
    const stored = toStoredKbStatus(params.nextStatusRaw);
    if (!stored) {
      return { ok: false, error: 'Ungültiger Artikelstatus.' };
    }
    nextStatus = stored;
    patch.status = stored;

    if (stored === 'Outdated') {
      Object.assign(
        patch,
        buildMarkOutdatedPatch({
          reason: params.outdatedReason,
          actorId: params.actorId,
          now,
        }),
      );
    } else if (stored === 'Archived') {
      Object.assign(
        patch,
        buildMarkArchivedPatch({
          reason: params.outdatedReason,
          actorId: params.actorId,
          now,
        }),
      );
    } else if (stored === 'Draft') {
      patch.index_in_rag = false;
    } else if (stored === 'Published') {
      // Clearing outdated metadata on republish unless caller only toggles RAG.
      if (isOutdatedStatus(params.existingStatus || undefined)) {
        Object.assign(patch, buildRepublishPatch({ now }));
      }
    }
  }

  if (typeof params.nextIndexInRag === 'boolean') {
    if (params.nextIndexInRag === true) {
      const gate = assertCanEnableRagIndex(String(patch.status || nextStatus));
      if (!gate.ok) {
        return { ok: false, error: gate.error || KB_RAG_BLOCKED_STATUS_ERROR };
      }
      patch.index_in_rag = true;
    } else {
      patch.index_in_rag = false;
    }
  }

  const effectiveStatus = String(patch.status || nextStatus);
  const effectiveIndex =
    typeof patch.index_in_rag === 'boolean'
      ? patch.index_in_rag
      : params.existingIndexInRag !== false;

  const purgeRag =
    statusBlocksRag(effectiveStatus) ||
    effectiveIndex === false ||
    patch.index_in_rag === false;

  if (statusBlocksRag(effectiveStatus)) {
    patch.index_in_rag = false;
  }

  return { ok: true, patch, purgeRag };
}

/** Filter hybrid KB hits so only published + indexed articles remain (defense in depth). */
export function filterHybridHitsToPublishedRagArticles<
  T extends { sourceType?: string; sourceId?: string },
>(
  hits: T[],
  articlesById: Map<string, { status?: string | null; index_in_rag?: boolean | null }>,
): T[] {
  return hits.filter((hit) => {
    const type = String(hit.sourceType || '').toUpperCase();
    if (type && type !== 'KB_ARTICLE') return true;
    const id = String(hit.sourceId || '').trim();
    if (!id) return false;
    const article = articlesById.get(id);
    if (!article) return false;
    return isArticleEligibleForRag(article);
  });
}

export function isStrictOutdatedSidebarStatus(status?: string | null): boolean {
  return normalizeKbStatus(status || undefined) === 'outdated';
}
