/**
 * Persist SharePoint / CSV KB articles with org-scoped duplicate protection.
 */

import { addDocDirect, getDocsDirect } from '../postgres-backend.js';
import {
  articleOrganizationId,
  normalizeKbVisibility,
  type PortalKbVisibility,
} from '../client-portal/kb-visibility.js';
import {
  buildSharePointPreviewArticles,
  normalizeArticleTitleKey,
  type SharePointPreviewArticle,
} from './sharepoint-csv-import.js';

export type KbCsvImportVisibilityInput = 'organization' | 'public' | 'internal' | 'shared_portal';

export type KbCsvImportArticleInput = {
  title: string;
  content: string;
  sharePointId?: string;
  matchcode?: string;
  hasAttachments?: boolean;
  category?: string;
};

export type KbCsvImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
  attachmentSharePointIds: string[];
  importedIds: string[];
  skippedTitles: string[];
  preview?: SharePointPreviewArticle[];
};

export type KbCsvImportParams = {
  organizationId: string;
  visibility?: KbCsvImportVisibilityInput;
  category?: string;
  publishImmediately?: boolean;
  csv?: string;
  articles?: KbCsvImportArticleInput[];
  authorId?: string;
  authorName?: string;
  /** When true, parse only — no writes. */
  dryRun?: boolean;
};

function resolveVisibility(raw: KbCsvImportVisibilityInput | undefined): PortalKbVisibility {
  if (!raw) return 'organization';
  if (raw === 'public') return 'shared_portal';
  return normalizeKbVisibility(raw);
}

function resolveCategory(raw: string | undefined): string {
  const cat = String(raw || '').trim();
  if (!cat || cat === 'All' || cat.toLowerCase() === 'allgemein') return 'uncategorized';
  return cat;
}

async function existingTitleKeysForOrg(organizationId: string): Promise<Set<string>> {
  const rows = await getDocsDirect('kb_articles', []);
  const keys = new Set<string>();
  for (const row of rows) {
    if (articleOrganizationId(row) !== organizationId) continue;
    const title = String(row.title || '').trim();
    if (!title) continue;
    keys.add(normalizeArticleTitleKey(title));
  }
  return keys;
}

/** Pure planner — skip duplicates by normalized title (case-insensitive). */
export function planKbCsvImportArticles(
  articles: KbCsvImportArticleInput[],
  existingTitleKeys: Iterable<string>,
): {
  toImport: KbCsvImportArticleInput[];
  skipped: KbCsvImportArticleInput[];
  errors: string[];
} {
  const existing = new Set(
    Array.from(existingTitleKeys).map((k) => normalizeArticleTitleKey(k)).filter(Boolean),
  );
  const seenInBatch = new Set<string>();
  const toImport: KbCsvImportArticleInput[] = [];
  const skipped: KbCsvImportArticleInput[] = [];
  const errors: string[] = [];

  for (const article of articles) {
    const title = String(article.title || '').trim();
    const content = String(article.content || '').trim();
    if (!title || !content) {
      skipped.push(article);
      errors.push(`Leerer Titel/Inhalt übersprungen (${article.sharePointId || title || 'ohne ID'})`);
      continue;
    }
    const titleKey = normalizeArticleTitleKey(title);
    if (existing.has(titleKey) || seenInBatch.has(titleKey)) {
      skipped.push(article);
      continue;
    }
    seenInBatch.add(titleKey);
    toImport.push({ ...article, title, content });
  }

  return { toImport, skipped, errors };
}

function articlesFromCsv(csv: string): Array<KbCsvImportArticleInput & { hasAttachments: boolean; sharePointId: string }> {
  return buildSharePointPreviewArticles(csv).map((preview) => ({
    title: preview.title,
    content: preview.content,
    sharePointId: preview.sharePointId,
    matchcode: preview.matchcode,
    hasAttachments: preview.hasAttachments,
    category: undefined,
  }));
}

export async function importKbCsvArticles(
  params: KbCsvImportParams,
): Promise<KbCsvImportResult> {
  const organizationId = String(params.organizationId || '').trim();
  if (!organizationId) {
    throw Object.assign(new Error('organizationId ist erforderlich.'), { status: 400 });
  }

  const visibility = resolveVisibility(params.visibility);
  if (visibility === 'organization' && !organizationId) {
    throw Object.assign(new Error('organizationId ist für Organisations-Sichtbarkeit erforderlich.'), {
      status: 400,
    });
  }

  const defaultCategory = resolveCategory(params.category);
  const status = params.publishImmediately === false ? 'Draft' : 'Published';
  const dryRun = Boolean(params.dryRun);

  let incoming: Array<KbCsvImportArticleInput & { hasAttachments?: boolean; sharePointId?: string }> =
    [];
  let preview: SharePointPreviewArticle[] | undefined;

  if (Array.isArray(params.articles) && params.articles.length > 0) {
    incoming = params.articles.map((a) => ({
      title: String(a.title || '').trim(),
      content: String(a.content || ''),
      sharePointId: a.sharePointId ? String(a.sharePointId) : undefined,
      matchcode: a.matchcode ? String(a.matchcode) : undefined,
      hasAttachments: Boolean(a.hasAttachments),
      category: a.category,
    }));
  } else if (params.csv) {
    preview = buildSharePointPreviewArticles(params.csv);
    incoming = articlesFromCsv(params.csv);
  } else {
    throw Object.assign(new Error('CSV-Text oder articles[] ist erforderlich.'), { status: 400 });
  }

  if (dryRun) {
    if (!preview && params.csv) preview = buildSharePointPreviewArticles(params.csv);
    return {
      imported: 0,
      skipped: 0,
      errors: [],
      attachmentSharePointIds: incoming
        .filter((a) => a.hasAttachments)
        .map((a) => String(a.sharePointId || ''))
        .filter(Boolean),
      importedIds: [],
      skippedTitles: [],
      preview,
    };
  }

  const existingTitles = await existingTitleKeysForOrg(organizationId);
  const planned = planKbCsvImportArticles(incoming, existingTitles);
  let imported = 0;
  const errors = [...planned.errors];
  const importedIds: string[] = [];
  const skippedTitles = planned.skipped
    .map((a) => String(a.title || '').trim())
    .filter(Boolean);
  const attachmentSharePointIds: string[] = [];
  const now = new Date().toISOString();

  for (const article of planned.toImport) {
    if (article.hasAttachments && article.sharePointId) {
      attachmentSharePointIds.push(String(article.sharePointId));
    }
    try {
      const category = resolveCategory(article.category || defaultCategory);
      const created = await addDocDirect('kb_articles', {
        title: article.title,
        content: article.content,
        category,
        subCategory: '',
        tags: ['sharepoint-import'].concat(
          article.matchcode ? [`matchcode:${article.matchcode}`] : [],
        ),
        authorId: params.authorId || null,
        owner: params.authorName || params.authorId || '',
        reviewer: '',
        visibility,
        organizationId,
        organization_id: organizationId,
        status,
        views: 0,
        index_in_rag: false,
        language: 'de',
        source: 'sharepoint-csv',
        sourceSharePointId: article.sharePointId || null,
        hasSharePointAttachments: Boolean(article.hasAttachments),
        createdAt: now,
        updatedAt: now,
      });
      importedIds.push(created.id);
      imported += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Import fehlgeschlagen für „${article.title}“: ${message}`);
    }
  }

  return {
    imported,
    skipped: planned.skipped.length,
    errors,
    attachmentSharePointIds,
    importedIds,
    skippedTitles,
  };
}

/** German summary line for toast / UI. */
export function formatKbCsvImportSummary(result: KbCsvImportResult): string {
  const base = `${result.imported} Artikel importiert, ${result.skipped} übersprungen`;
  if (!result.attachmentSharePointIds.length) return base;
  const ids = result.attachmentSharePointIds.join(', ');
  return `${base} — Hinweis: ${result.attachmentSharePointIds.length} Artikel hatten Anhänge in SharePoint (IDs: ${ids})`;
}
