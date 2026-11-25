/**
 * Staff KB adapter — wires KnowledgeBaseWorkbench to existing Hubcom staff APIs.
 * Do not use from /portal/* (portal will get usePortalKbAdapter in a later step).
 */

import { useMemo } from 'react';
import axios from 'axios';
import { kbService } from '../services/kbService';
import { kbArticleApi } from '../services/kbArticleApi';
import { kbCategoryApi, kbDashboardApi } from '../services/kbDashboardApi';
import { ragService } from '../services/ragService';
import { AIAdapter } from '../lib/ai/provider-adapter';
import type { KbWorkbenchAdapter } from '../lib/kb/kb-workbench-adapter';
import type { KBArticle } from '../types';

async function emptyCoverageFallback() {
  return {
    overallPercentage: 0,
    totalExpected: 0,
    totalExistingMatched: 0,
    totalMissing: 0,
    healthStatus: 'Empty',
    criticalGaps: [],
    categories: [],
    aiSuggestions: [],
  };
}

export function useStaffKbAdapter(): KbWorkbenchAdapter {
  return useMemo(() => {
    const aiAdapter = new AIAdapter();

    const adapter: KbWorkbenchAdapter = {
      subscribeArticles(callback) {
        return kbService.subscribeToArticles(callback);
      },

      async createArticle(article) {
        return kbService.createArticle(article);
      },

      async updateArticle(id, patch, previousTags) {
        await kbService.updateArticle(id, patch, previousTags ?? []);
      },

      async deleteArticle(id, tags) {
        await kbService.deleteArticle(id, tags ?? []);
      },

      async deleteArticles(items) {
        await kbService.deleteArticles(
          items.map((item) => ({ id: item.id, tags: item.tags ?? [] })),
        );
      },

      async listCategories() {
        const { categories } = await kbCategoryApi.list();
        return categories;
      },

      async createCategory(payload) {
        const { category } = await kbCategoryApi.create(payload);
        return category;
      },

      async updateCategory(id, payload) {
        const { category } = await kbCategoryApi.update(id, payload);
        return category;
      },

      async removeCategory(id, strategy) {
        return kbCategoryApi.remove(id, strategy);
      },

      async listAssignableUsers() {
        try {
          const res = await axios.get('/api/admin/users', { withCredentials: true });
          const rows = Array.isArray(res.data?.users) ? res.data.users : [];
          return rows
            .filter((u: Record<string, unknown>) => {
              const role = String(u.role || '');
              return (
                role === 'SYSTEM_ADMIN' ||
                role === 'AGENT' ||
                role === 'agent' ||
                role === 'TEAM_LEAD' ||
                role === 'team_lead' ||
                role === 'admin'
              );
            })
            .map((u: Record<string, unknown>) => ({
              uid: String(u.id || u.uid || ''),
              name: String(u.name || u.email || ''),
              role: String(u.role || ''),
              email: String(u.email || ''),
            }))
            .filter((u: { uid: string; name: string }) => u.uid && u.name);
        } catch {
          return [];
        }
      },

      async getGlobalSettings() {
        try {
          const { settings } = await kbDashboardApi.getGlobalSettings();
          return settings;
        } catch {
          return null;
        }
      },

      async setIndexInRag(articleId, indexInRag) {
        await kbArticleApi.setIndexInRag(articleId, indexInRag);
      },

      async listPortalOrganizations() {
        try {
          const res = await axios.get('/api/admin/organizations', { withCredentials: true });
          const orgs = Array.isArray(res.data?.organizations) ? res.data.organizations : [];
          return orgs.map((o: { id?: string; name?: string }) => ({
            id: String(o.id),
            name: String(o.name || o.id),
          }));
        } catch {
          return [];
        }
      },

      async importCsvArticles(payload) {
        const res = await axios.post('/api/kb/import-csv', payload, { withCredentials: true });
        return {
          imported: Number(res.data?.imported || 0),
          skipped: Number(res.data?.skipped || 0),
          errors: Array.isArray(res.data?.errors) ? res.data.errors.map(String) : [],
          attachmentSharePointIds: Array.isArray(res.data?.attachmentSharePointIds)
            ? res.data.attachmentSharePointIds.map(String)
            : [],
          summary: String(res.data?.summary || ''),
        };
      },

      async fetchCoverage(forceRecalc = false) {
        const url = forceRecalc ? '/api/coverage/recalculate' : '/api/coverage';
        const method = forceRecalc ? 'POST' : 'GET';
        try {
          const res = await fetch(url, { method });
          if (!res.ok) return emptyCoverageFallback();
          const data = await res.json();
          return data.dashboard || data;
        } catch {
          return emptyCoverageFallback();
        }
      },

      async recalculateCoverage() {
        try {
          const res = await fetch('/api/coverage/recalculate', { method: 'POST' });
          if (!res.ok) return emptyCoverageFallback();
          const data = await res.json();
          return data.dashboard || data;
        } catch {
          return emptyCoverageFallback();
        }
      },

      findRelevantContext(query, articles) {
        return ragService.findRelevantContext(query, articles as KBArticle[], []) as any;
      },

      isAiSearchConfigured() {
        return Boolean(aiAdapter.isConfigured);
      },

      async answerKnowledgeQuery(query, snippets, options) {
        return aiAdapter.answerKnowledgeQuery(query, snippets as any, {
          entityId: options?.entityId,
          forceRefresh: options?.forceRefresh,
        });
      },

      getAiAdapter() {
        return aiAdapter;
      },
    };

    return adapter;
  }, []);
}
