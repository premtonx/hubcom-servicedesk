/**
 * Kunden-Portal KB adapter — KnowledgeBaseWorkbench ↔ /api/portal/kb* only.
 * Never calls staff DB/KB analytics or AI endpoints — portal KB REST only.
 */

import { useMemo } from 'react';
import axios from 'axios';
import type { KbWorkbenchAdapter } from '../lib/kb/kb-workbench-adapter';
import type { KBArticle } from '../types';
import type { KBCategoryDto } from '../services/kbDashboardApi';

const PORTAL_KB = '/api/portal/kb';
const PORTAL_KB_CATEGORIES = '/api/portal/kb/categories';
const POLL_MS = 20_000;

function toKbArticle(row: Record<string, unknown>): KBArticle {
  return {
    id: String(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    category: String(row.category || 'uncategorized'),
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

export function usePortalKbAdapter(): KbWorkbenchAdapter {
  return useMemo(() => {
    const listeners = new Set<(articles: KBArticle[]) => void>();

    const notify = (articles: KBArticle[]) => {
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
        const category = String(article.category || '').trim();
        const res = await axios.post(
          PORTAL_KB,
          {
            title: article.title,
            content: article.content,
            category: category && category !== 'All' ? category : 'uncategorized',
            subCategory: '',
            tags: article.tags || [],
            status: article.status || 'Published',
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
        const res = await axios.get(PORTAL_KB_CATEGORIES, { withCredentials: true });
        return (res.data?.categories || []) as KBCategoryDto[];
      },

      async createCategory(payload) {
        const res = await axios.post(
          PORTAL_KB_CATEGORIES,
          { name: payload.name, desc: payload.desc, order: payload.order, iconName: payload.iconName },
          { withCredentials: true },
        );
        return res.data.category as KBCategoryDto;
      },

      async updateCategory(id, payload) {
        const res = await axios.patch(
          `${PORTAL_KB_CATEGORIES}/${encodeURIComponent(id)}`,
          payload,
          { withCredentials: true },
        );
        return res.data.category as KBCategoryDto;
      },

      async removeCategory(id, strategy) {
        const res = await axios.delete(`${PORTAL_KB_CATEGORIES}/${encodeURIComponent(id)}`, {
          withCredentials: true,
          data: { strategy },
        });
        return res.data as { success: boolean; strategy: string; affectedCount: number };
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

      async listAssignableUsers() {
        return [];
      },
    };

    return adapter;
  }, []);
}
