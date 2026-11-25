/**
 * Typed adapter for KnowledgeBaseWorkbench — Shared UI, Separate APIs.
 *
 * The presentational workbench must not import /api/db or staff-only API clients.
 * All network I/O goes through this adapter (staff → /api/kb* + kbService; portal → /api/portal/kb*).
 */

import type { KBArticle } from '../../types';
import type { KBGlobalSettings } from '../kb-dashboard-metrics';
import type { KBCategoryDto } from '../../services/kbDashboardApi';

export type KbWorkbenchMode = 'staff' | 'portal';

/** Feature flags for staff-only chrome. Staff mode enables all; portal disables them. */
export type KbWorkbenchCapabilities = {
  /** "Dokumente importieren" / Import Docs header action + importer dialog */
  importDocs: boolean;
  /** CSV / SharePoint import (staff always; portal writers only) */
  importCsv: boolean;
  /** "KI generieren" header action */
  aiGenerate: boolean;
  /** Artikel / Dokumente / Datenquellen segmented control */
  documentsTab: boolean;
  externalSourcesTab: boolean;
  /** Sidebar: Entwürfe */
  draftsNav: boolean;
  /** Sidebar: Prüfungen */
  reviewsNav: boolean;
  /** Sidebar: KI-Assistent + Autopilot dashboard */
  aiAssistantNav: boolean;
  /** Sidebar: Analytik + coverage map mode */
  analyticsNav: boolean;
  /** KI-Wissens-Einblicke / AI search overlay + Ask AI */
  aiInsights: boolean;
  /** KB-Gesundheit telemetry in sidebar / activity */
  kbHealthTelemetry: boolean;
  /** Cross-tenant / visibility admin filters (internal / shared_portal / organization) */
  crossTenantVisibilityFilters: boolean;
  /** Category admin / rename / delete */
  categoryAdmin: boolean;
  /** RAG index toggle on articles */
  ragIndexToggle: boolean;
  /** Show "+ Neu" / create article */
  canCreateArticles: boolean;
  /** Show edit actions (org articles only — shared guides stay read-only in UI) */
  canEditArticles: boolean;
  /** Show delete actions (org articles only) */
  canDeleteArticles: boolean;
  /** Show duplicate action */
  canDuplicateArticles: boolean;
  /** Show bulk selection / delete bar */
  canBulkDelete: boolean;
  /**
   * Smart-view ids to show in the left sidebar.
   * Omit / undefined → all staff smart views.
   */
  smartItemIds?: ReadonlyArray<
    'popular' | 'recent' | 'mostViewed' | 'missing' | 'outdated'
  >;
};

export const STAFF_KB_CAPABILITIES: KbWorkbenchCapabilities = {
  importDocs: true,
  importCsv: true,
  aiGenerate: true,
  documentsTab: true,
  externalSourcesTab: true,
  draftsNav: true,
  reviewsNav: true,
  aiAssistantNav: true,
  analyticsNav: true,
  aiInsights: true,
  kbHealthTelemetry: true,
  crossTenantVisibilityFilters: true,
  categoryAdmin: true,
  ragIndexToggle: true,
  canCreateArticles: true,
  canEditArticles: true,
  canDeleteArticles: true,
  canDuplicateArticles: true,
  canBulkDelete: true,
};

/** Base portal chrome — staff-only features off. Write flags set per role. */
export const PORTAL_KB_CAPABILITIES: KbWorkbenchCapabilities = {
  importDocs: false,
  importCsv: false,
  aiGenerate: false,
  documentsTab: false,
  externalSourcesTab: false,
  draftsNav: false,
  reviewsNav: false,
  aiAssistantNav: false,
  analyticsNav: false,
  aiInsights: false,
  kbHealthTelemetry: false,
  crossTenantVisibilityFilters: false,
  categoryAdmin: false,
  ragIndexToggle: false,
  canCreateArticles: false,
  canEditArticles: false,
  canDeleteArticles: false,
  canDuplicateArticles: false,
  canBulkDelete: false,
  smartItemIds: ['popular', 'recent'],
};

/** CLIENT_ADMIN | CLIENT_SUPPORTER — write own-org articles + categories. */
export const PORTAL_KB_WRITER_CAPABILITIES: KbWorkbenchCapabilities = {
  ...PORTAL_KB_CAPABILITIES,
  categoryAdmin: true,
  importCsv: true,
  canCreateArticles: true,
  canEditArticles: true,
  canDeleteArticles: true,
};

/** CLIENT_USER — read-only. */
export const PORTAL_KB_READER_CAPABILITIES: KbWorkbenchCapabilities = {
  ...PORTAL_KB_CAPABILITIES,
};

export type KbRagSnippet = {
  text: string;
} & Record<string, unknown>;

/**
 * Data + mutation surface injected into KnowledgeBaseWorkbench.
 * Portal adapters implement the core methods; staff adds telemetry/AI helpers.
 */
export interface KbWorkbenchAdapter {
  subscribeArticles(callback: (articles: KBArticle[]) => void): () => void;

  createArticle(article: Partial<KBArticle>): Promise<string | void>;

  updateArticle(
    id: string,
    patch: Partial<KBArticle>,
    previousTags?: string[],
  ): Promise<void>;

  deleteArticle(id: string, tags?: string[]): Promise<void>;

  deleteArticles(items: Array<{ id: string; tags?: string[] }>): Promise<void>;

  listCategories(): Promise<KBCategoryDto[]>;

  createCategory(payload: {
    name: string;
    desc?: string;
    owner?: string;
    subCategory?: string;
    iconName?: string;
    order?: number;
  }): Promise<KBCategoryDto>;

  updateCategory(
    id: string,
    payload: Partial<{
      name: string;
      desc: string;
      owner: string;
      subCategory: string;
      iconName: string;
      order: number;
    }>,
  ): Promise<KBCategoryDto>;

  removeCategory(
    id: string,
    strategy: 'reassign' | 'purge',
  ): Promise<{ success: boolean; strategy: string; affectedCount: number }>;

  /** Staff: Hubcom users for Autor / Prüfer dropdowns. Portal may return []. */
  listAssignableUsers?(): Promise<
    Array<{ uid: string; name: string; role: string; email: string }>
  >;

  getGlobalSettings(): Promise<KBGlobalSettings | null>;

  setIndexInRag(articleId: string, indexInRag: boolean): Promise<void>;

  listPortalOrganizations(): Promise<Array<{ id: string; name: string }>>;

  /**
   * CSV / SharePoint import. Staff → /api/kb/import-csv; portal → /api/portal/kb/import-csv.
   * Portal adapters ignore organizationId/visibility spoof (server locks session org).
   */
  importCsvArticles?(payload: {
    organizationId?: string;
    visibility?: 'organization' | 'public' | 'internal' | 'shared_portal';
    category?: string;
    publishImmediately?: boolean;
    csv?: string;
    articles?: Array<{
      title: string;
      content: string;
      sharePointId?: string;
      matchcode?: string;
      hasAttachments?: boolean;
      category?: string;
    }>;
    dryRun?: boolean;
  }): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
    attachmentSharePointIds: string[];
    summary: string;
  }>;

  /** Staff coverage map (optional for portal). */
  fetchCoverage?(forceRecalc?: boolean): Promise<unknown>;

  recalculateCoverage?(): Promise<unknown>;

  findRelevantContext?(
    query: string,
    articles: unknown[],
  ): KbRagSnippet[];

  isAiSearchConfigured?(): boolean;

  answerKnowledgeQuery?(
    query: string,
    snippets: KbRagSnippet[],
    options?: { entityId?: string; forceRefresh?: boolean },
  ): Promise<string>;

  /**
   * Raw staff AI adapter for KnowledgeBaseArticlePage (staff mode only).
   * Portal adapters omit this.
   */
  getAiAdapter?(): unknown;
}
