/**
 * Kunden-Portal KB adapter — KnowledgeBaseWorkbench ↔ /api/portal/kb* only.
 * Never calls staff DB/KB analytics or AI endpoints — portal KB REST only.
 */

import { useMemo } from 'react';
import axios from 'axios';
import type { KbWorkbenchAdapter } from '../lib/kb/kb-workbench-adapter';
import type { KBArticle } from '../types';
import type { KBCategoryDto } from '../services/kbDashboardApi';
import { slugifyCategoryId } from '../components/kb/kbCategoryUtils';

const PORTAL_KB = '/api/portal/kb';
const POLL_MS = 20_000;

function toKbArticle(row: Record<string, unknown>): KBArticle {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    category: String(row.category || 'Allgemein'),
    subCategory: String(row.subCategory || ''),
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t)) : [],
    visibility: (row.visibility as KBArticle['visibility']) || 'organization',
    organizationId: (row.organizationId as string | null | undefined) ?? null,
    organization_id: (row.organizationId as string | null | undefined) ?? null,
    status: String(row.status || 'Published'),
    owner: String(row.owner || ''),
    authorId: row.authorId != null ? String(row.authorId) : undefined,
    views: typeof row.views === 'number' ? row.views : 0,
    language: String(row.language || 'de'),
    createdAt: row.createdAt as any,
    updatedAt: row.updatedAt as any,
    index_in_rag: false,
  } as KBArticle;
}

async function fetchPortalArticles(): Promise<KBArticle[]> {
  const res = await axios.get(PORTAL_KB, {
    params: { scope: 'all' },
    withCredentials: true,
  });
  const rows = Array.isArray(res.data?.articles) ? res.data.articles : [];
  return rows.map((row: Record<string, unknown>) => toKbArticle(row));
}

function categoriesFromArticles(articles: KBArticle[]): KBCategoryDto[] {
  const seen = new Map<string, KBCategoryDto>();
  let order = 1;
  for (const art of articles) {
    const name = String(art.category || 'Allgemein').trim() || 'Allgemein';
    const id = slugifyCategoryId(name);
    if (seen.has(id)) continue;
    seen.set(id, { id, name, order: order++ });
  }
  return Array.from(seen.values());
}

export function usePortalKbAdapter(): KbWorkbenchAdapter {
  return useMemo(() => {
    /** Last list used so listCategories can stay in sync without a second staff API. */
    let latestArticles: KBArticle[] = [];
    const listeners = new Set<(articles: KBArticle[]) => void>();

    const notify = (articles: KBArticle[]) => {
      latestArticles = articles;
      listeners.forEach((cb) => cb(articles));
    };

    const refresh = async () => {
      const articles = await fetchPortalArticles();
      notify(articles);
      return articles;
    };

    const adapter: KbWorkbenchAdapter = {
      subscribeArticles(callback) {
        listeners.add(callback);
        let cancelled = false;
        void (async () => {
          try {
            const articles = await fetchPortalArticles();
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
        const res = await axios.post(
          PORTAL_KB,
          {
            title: article.title,
            content: article.content,
            category: article.category || 'Allgemein',
            subCategory: article.subCategory || '',
            tags: article.tags || [],
          },
          { withCredentials: true },
        );
        await refresh();
        return res.data?.article?.id ? String(res.data.article.id) : undefined;
      },

      async updateArticle(id, patch) {
        await axios.patch(
          `${PORTAL_KB}/${encodeURIComponent(id)}`,
          {
            title: patch.title,
            content: patch.content,
            category: patch.category,
            subCategory: patch.subCategory,
            tags: patch.tags,
            status: patch.status,
          },
          { withCredentials: true },
        );
        await refresh();
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
        if (latestArticles.length === 0) {
          try {
            latestArticles = await fetchPortalArticles();
          } catch {
            return [];
          }
        }
        return categoriesFromArticles(latestArticles);
      },

      async updateCategory() {
        throw new Error('Kategorien werden im Kunden-Portal nicht verwaltet.');
      },

      async removeCategory() {
        throw new Error('Kategorien werden im Kunden-Portal nicht verwaltet.');
      },

      async getGlobalSettings() {
        return null;
      },

      async setIndexInRag() {
        /* Portal never toggles RAG indexing. */
      },

      async listPortalOrganizations() {
        return [];
      },
    };

    return adapter;
  }, []);
}
