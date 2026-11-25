import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { KBArticle, KBArticleAlert, KBArticleHistoryEntry } from '../../types';
import { KBArticleDetailView } from '../kb/KBArticleDetailView';
import type { KBTranslateLanguage } from '../kb/KBArticleDetailToolbar';
import { kbArticleApi } from '../../services/kbArticleApi';
import { stripHtml } from '../kb/kb-utils';
import { AIAdapter } from '../../lib/ai/provider-adapter';
import { DEFAULT_KB_ALERTS, resolveInfrastructureTrust } from '../../lib/kb-article-defaults';
import { kbRelationshipService, type KBRelationship } from '../../services/kbRelationshipService';
import { kbService } from '../../services/kbService';
import { trustScoreService } from '../../services/trustScoreService';
import type {
  KbWorkbenchAdapter,
  KbWorkbenchCapabilities,
  KbWorkbenchMode,
} from '../../lib/kb/kb-workbench-adapter';
import { STAFF_KB_CAPABILITIES } from '../../lib/kb/kb-workbench-adapter';
import type { KBCategoryRecord } from '../kb/kbCategoryUtils';

export interface KnowledgeBaseArticlePageProps {
  article: KBArticle & { id: string };
  mode?: KbWorkbenchMode;
  adapter: KbWorkbenchAdapter;
  capabilities?: KbWorkbenchCapabilities;
  categories?: KBCategoryRecord[];
  isAiSearchReady?: boolean;
  aiAdapter?: AIAdapter | null;
  onBack: () => void;
  onCopyLink: (articleId: string) => void;
  onArticleUpdated: (articleId: string, patch: Partial<KBArticle>) => void;
  onCreateCategory?: () => void;
}

function isSeedArticle(id: string) {
  return id.startsWith('seed-');
}

export function KnowledgeBaseArticlePage({
  article,
  mode = 'staff',
  adapter,
  capabilities = STAFF_KB_CAPABILITIES,
  categories = [],
  isAiSearchReady = false,
  aiAdapter = null,
  onBack,
  onCopyLink,
  onArticleUpdated,
  onCreateCategory,
}: KnowledgeBaseArticlePageProps) {
  const isPortal = mode === 'portal';
  const canEdit = Boolean(capabilities.canEditArticles);
  const canManageCategories = Boolean(capabilities.categoryAdmin);

  const [liveArticle, setLiveArticle] = useState(article);
  const [articleContentLanguage, setArticleContentLanguage] = useState<string>(
    article.language || (isPortal ? 'German' : 'English'),
  );
  const [isTranslating, setIsTranslating] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(article.aiSummary ?? null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<KBArticleHistoryEntry[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [relationships, setRelationships] = useState<KBRelationship[]>([]);
  // Strictly-once view-increment guard. Without this, the effect below re-fires
  // on every render because the parent recreates the `article` object (and the
  // inline `onArticleUpdated` callback) whenever the optimistic views patch is
  // applied — resulting in an infinite view-count loop.
  const viewIncrementedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLiveArticle(article);
    setArticleContentLanguage(article.language || (isPortal ? 'German' : 'English'));
    setAiSummary(article.aiSummary ?? null);
  }, [article, isPortal]);

  useEffect(() => {
    if (isPortal) {
      setRelationships([]);
      return;
    }
    const unsub = kbRelationshipService.subscribeToRelationships(setRelationships);
    return () => unsub();
  }, [isPortal]);

  useEffect(() => {
    // Portal never hits staff view-increment endpoints (/api/kb/* / /api/db).
    if (isPortal || isSeedArticle(article.id)) return;
    if (viewIncrementedRef.current.has(article.id)) return;
    viewIncrementedRef.current.add(article.id);

    let cancelled = false;
    void kbArticleApi
      .incrementView(article.id)
      .then(({ views }) => {
        if (cancelled) return;
        setLiveArticle((prev) => ({ ...prev, views }));
        onArticleUpdated(article.id, { views });
      })
      .catch((error) => {
        console.warn('Failed to increment article views:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [article.id, isPortal, onArticleUpdated]);

  const loadHistory = useCallback(async () => {
    if (isPortal) {
      setHistoryEntries([]);
      return;
    }
    if (isSeedArticle(article.id)) {
      setHistoryEntries([
        {
          id: 'seed-history-1',
          articleId: article.id,
          changeSummary: 'Published revision',
          authorName: liveArticle.owner || 'Author',
          snapshotTitle: liveArticle.title,
          createdAt: liveArticle.updatedAt,
        },
        {
          id: 'seed-history-2',
          articleId: article.id,
          changeSummary: 'Initial draft',
          authorName: liveArticle.owner || 'Author',
          snapshotTitle: liveArticle.title,
          createdAt: liveArticle.createdAt,
        },
      ]);
      return;
    }

    setIsHistoryLoading(true);
    try {
      const { history } = await kbArticleApi.getHistory(article.id);
      setHistoryEntries(history);
    } catch (error) {
      console.warn('Failed to load article history:', error);
      setHistoryEntries([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [
    article.id,
    isPortal,
    liveArticle.createdAt,
    liveArticle.owner,
    liveArticle.title,
    liveArticle.updatedAt,
  ]);

  const baseLanguage = liveArticle.language || (isPortal ? 'German' : 'English');

  const resolvedAlerts = useMemo((): KBArticleAlert[] => {
    const translated = liveArticle.translations?.[articleContentLanguage]?.alerts;
    if (articleContentLanguage !== baseLanguage && translated?.length) {
      return translated;
    }
    if (liveArticle.alerts?.length) {
      return liveArticle.alerts;
    }
    if (isSeedArticle(liveArticle.id) && liveArticle.id === 'seed-1') {
      return DEFAULT_KB_ALERTS;
    }
    return [];
  }, [articleContentLanguage, baseLanguage, liveArticle.alerts, liveArticle.id, liveArticle.translations]);

  const displayTitle = useMemo(() => {
    if (articleContentLanguage === baseLanguage) {
      return liveArticle.title;
    }
    return liveArticle.translations?.[articleContentLanguage]?.title || liveArticle.title;
  }, [articleContentLanguage, baseLanguage, liveArticle.title, liveArticle.translations]);

  const displayContent = useMemo(() => {
    if (articleContentLanguage === baseLanguage) {
      return liveArticle.content || '';
    }
    return liveArticle.translations?.[articleContentLanguage]?.content || liveArticle.content || '';
  }, [articleContentLanguage, baseLanguage, liveArticle.content, liveArticle.translations]);

  const infrastructureTrust = useMemo(
    () => resolveInfrastructureTrust(liveArticle, liveArticle.trustScore),
    [liveArticle],
  );

  const handleTranslate = useCallback(
    async (targetLang: KBTranslateLanguage) => {
      if (isPortal || !aiAdapter) {
        throw new Error('Übersetzung ist im Kunden-Portal nicht verfügbar.');
      }
      if (targetLang === baseLanguage) {
        setArticleContentLanguage(baseLanguage);
        return;
      }

      const cached = liveArticle.translations?.[targetLang];
      if (cached?.title && cached?.content) {
        setArticleContentLanguage(targetLang);
        toast.success(`Showing ${targetLang} translation.`);
        return;
      }

      if (!isAiSearchReady) {
        toast.error('Geist AI is not configured. Connect a model in AI Orchestrator settings.');
        return;
      }

      setIsTranslating(true);
      try {
        const plainSource = (liveArticle.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const plainTitle = liveArticle.title || '';
        const [translatedBody, translatedTitle, ...translatedAlerts] = await Promise.all([
          aiAdapter.translate(plainSource, targetLang, 'Professional'),
          aiAdapter.translate(plainTitle, targetLang, 'Professional'),
          ...resolvedAlerts.map((alert) =>
            aiAdapter.translate(`${alert.title}: ${alert.body}`, targetLang, 'Professional'),
          ),
        ]);

        const htmlTranslated = `<div class="kb-translated-body">${translatedBody.replace(/\n/g, '<br/>')}</div>`;
        const alerts: KBArticleAlert[] = resolvedAlerts.map((alert, index) => {
          const translatedLine = translatedAlerts[index] || '';
          const splitIndex = translatedLine.indexOf(':');
          return {
            type: alert.type,
            title: splitIndex > 0 ? translatedLine.slice(0, splitIndex).trim() : alert.title,
            body: splitIndex > 0 ? translatedLine.slice(splitIndex + 1).trim() : translatedLine || alert.body,
          };
        });

        const translation = {
          title: translatedTitle,
          content: htmlTranslated,
          alerts,
        };

        if (!isSeedArticle(liveArticle.id)) {
          const { translations } = await kbArticleApi.saveTranslation(liveArticle.id, targetLang, translation);
          setLiveArticle((prev) => ({ ...prev, translations }));
          onArticleUpdated(liveArticle.id, { translations });
        } else {
          setLiveArticle((prev) => ({
            ...prev,
            translations: { ...(prev.translations || {}), [targetLang]: translation },
          }));
        }

        setArticleContentLanguage(targetLang);
        toast.success(`Article localized to ${targetLang}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Translation failed.';
        toast.error(message);
        throw error;
      } finally {
        setIsTranslating(false);
      }
    },
    [
      aiAdapter,
      baseLanguage,
      isAiSearchReady,
      isPortal,
      liveArticle.content,
      liveArticle.id,
      liveArticle.title,
      liveArticle.translations,
      onArticleUpdated,
      resolvedAlerts,
    ],
  );

  const handleRegenerateSummary = useCallback(
    async (forceRefresh = false) => {
      if (isPortal) return;
      if (isSeedArticle(liveArticle.id)) {
        toast.info('AI summary is available for database-backed articles.');
        return;
      }

      const plainContent = stripHtml(liveArticle.content || '').trim();
      if (!plainContent) {
        setSummaryFailed(true);
        setIsSummaryLoading(false);
        toast.error('KI-Zusammenfassung konnte nicht erstellt werden');
        console.warn('KB summary generation skipped: article content is empty.');
        return;
      }

      setSummaryFailed(false);
      setIsSummaryLoading(true);
      try {
        const { aiSummary: summary } = await kbArticleApi.getOrGenerateSummary(liveArticle.id, {
          forceRefresh,
        });
        setAiSummary(summary);
        setLiveArticle((prev) => ({ ...prev, aiSummary: summary }));
        onArticleUpdated(liveArticle.id, { aiSummary: summary });
        toast.success(forceRefresh ? 'AI summary refreshed.' : 'AI summary loaded.');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to generate summary.';
        setSummaryFailed(true);
        toast.error('KI-Zusammenfassung konnte nicht erstellt werden');
        console.warn('KB summary generation failed:', message);
      } finally {
        setIsSummaryLoading(false);
      }
    },
    [isPortal, liveArticle.id, liveArticle.content, onArticleUpdated],
  );

  const handleToggleIndexInRag = useCallback(
    async (checked: boolean) => {
      if (isPortal || !capabilities.ragIndexToggle) return;
      if (isSeedArticle(liveArticle.id)) {
        setLiveArticle((prev) => ({ ...prev, index_in_rag: checked }));
        onArticleUpdated(liveArticle.id, { index_in_rag: checked });
        toast.success(
          checked
            ? 'Artikel wird wieder für KI-RAG indexiert.'
            : 'Artikel wird nicht mehr für KI-RAG indexiert.',
        );
        return;
      }
      try {
        await adapter.setIndexInRag(liveArticle.id, checked);
        setLiveArticle((prev) => ({ ...prev, index_in_rag: checked }));
        onArticleUpdated(liveArticle.id, { index_in_rag: checked });
        toast.success(
          checked
            ? 'Artikel wird wieder für KI-RAG indexiert.'
            : 'Artikel wird nicht mehr für KI-RAG indexiert.',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'RAG-Toggle fehlgeschlagen.';
        toast.error(message);
      }
    },
    [adapter, capabilities.ragIndexToggle, isPortal, liveArticle.id, onArticleUpdated],
  );

  const handleAiExplain = useCallback(async () => {
    if (isPortal || !aiAdapter) {
      throw new Error('KI-Erklärung ist im Kunden-Portal nicht verfügbar.');
    }
    if (!isAiSearchReady) {
      throw new Error('Geist AI is not configured. Connect a model in AI Orchestrator settings.');
    }
    return aiAdapter.explainArticleLayout(liveArticle.title, liveArticle.content || '', liveArticle.id);
  }, [aiAdapter, isAiSearchReady, isPortal, liveArticle.content, liveArticle.id, liveArticle.title]);

  /** Content save — always via adapter (portal → PATCH /api/portal/kb/:id; staff → kbService). */
  const handleSaveContent = useCallback(
    async (content: string) => {
      if (isSeedArticle(liveArticle.id)) {
        setLiveArticle((prev) => ({ ...prev, content }));
        onArticleUpdated(liveArticle.id, { content });
        return;
      }

      await adapter.updateArticle(liveArticle.id, { content }, liveArticle.tags || []);
      const updatedAt = new Date().toISOString();
      setLiveArticle((prev) => ({ ...prev, content, updatedAt }));
      onArticleUpdated(liveArticle.id, { content, updatedAt });
      if (!isPortal) void loadHistory();
    },
    [adapter, isPortal, liveArticle.id, liveArticle.tags, loadHistory, onArticleUpdated],
  );

  /** Quick category reassignment from Artikel-Metadaten sidebar. */
  const handleCategoryChange = useCallback(
    async (categoryId: string) => {
      if (!canEdit || isSeedArticle(liveArticle.id)) {
        setLiveArticle((prev) => ({ ...prev, category: categoryId }));
        onArticleUpdated(liveArticle.id, { category: categoryId });
        return;
      }
      await adapter.updateArticle(liveArticle.id, { category: categoryId }, liveArticle.tags || []);
      const updatedAt = new Date().toISOString();
      setLiveArticle((prev) => ({ ...prev, category: categoryId, updatedAt }));
      onArticleUpdated(liveArticle.id, { category: categoryId, updatedAt });
      toast.success('Kategorie aktualisiert');
    },
    [adapter, canEdit, liveArticle.id, liveArticle.tags, onArticleUpdated],
  );

  const handleHelpful = useCallback(async () => {
    if (isPortal) {
      toast.success('Danke für Ihr Feedback!');
      return;
    }
    const updatedHelpful = (liveArticle.helpfulCount || 0) + 1;
    if (!isSeedArticle(liveArticle.id)) {
      await kbService.updateArticle(liveArticle.id, { helpfulCount: updatedHelpful });
      try {
        const trust = await trustScoreService.getTrustScore(liveArticle.id, liveArticle);
        const updatedInputs = { ...trust.inputs, helpfulCount: updatedHelpful };
        await trustScoreService.updateTrustScore(liveArticle.id, updatedInputs, trust.score, trust.history);
      } catch (error) {
        console.warn('Could not save trust score logs:', error);
      }
    }
    setLiveArticle((prev) => ({ ...prev, helpfulCount: updatedHelpful }));
    onArticleUpdated(liveArticle.id, { helpfulCount: updatedHelpful });
    toast.success('Thank you! Positive rating logged.');
  }, [isPortal, liveArticle, onArticleUpdated]);

  const handleUnhelpful = useCallback(async () => {
    if (isPortal) {
      toast.success('Danke für Ihr Feedback!');
      return;
    }
    const updatedUnhelpful = (liveArticle.unhelpfulCount || 0) + 1;
    if (!isSeedArticle(liveArticle.id)) {
      await kbService.updateArticle(liveArticle.id, { unhelpfulCount: updatedUnhelpful });
      try {
        const trust = await trustScoreService.getTrustScore(liveArticle.id, liveArticle);
        const updatedInputs = { ...trust.inputs, unhelpfulCount: updatedUnhelpful };
        await trustScoreService.updateTrustScore(liveArticle.id, updatedInputs, trust.score, trust.history);
      } catch (error) {
        console.warn('Could not save trust score logs:', error);
      }
    }
    setLiveArticle((prev) => ({ ...prev, unhelpfulCount: updatedUnhelpful }));
    onArticleUpdated(liveArticle.id, { unhelpfulCount: updatedUnhelpful });
    toast.success('Feedback recorded. Trust metrics adjusted.');
  }, [isPortal, liveArticle, onArticleUpdated]);

  return (
    <KBArticleDetailView
      mode={mode}
      article={liveArticle}
      title={displayTitle}
      htmlContent={displayContent}
      alerts={resolvedAlerts}
      activeReadingLanguage={articleContentLanguage}
      isTranslating={isTranslating}
      infrastructureTrust={infrastructureTrust}
      aiSummary={isPortal ? null : aiSummary}
      isSummaryLoading={isPortal ? false : isSummaryLoading}
      summaryFailed={isPortal ? false : summaryFailed}
      onRetrySummary={isPortal ? undefined : () => void handleRegenerateSummary(true)}
      relationships={isPortal ? [] : relationships}
      historyEntries={isPortal ? [] : historyEntries}
      isHistoryLoading={isPortal ? false : isHistoryLoading}
      categories={categories}
      canEdit={canEdit}
      canManageCategories={canManageCategories}
      onBack={onBack}
      onCopyLink={() => onCopyLink(liveArticle.id)}
      onTranslate={handleTranslate}
      onAiExplain={handleAiExplain}
      onRegenerateSummary={handleRegenerateSummary}
      onLoadHistory={loadHistory}
      onSaveContent={handleSaveContent}
      onCategoryChange={handleCategoryChange}
      onCreateCategory={onCreateCategory}
      onHelpful={handleHelpful}
      onUnhelpful={handleUnhelpful}
      indexInRag={isPortal || !capabilities.ragIndexToggle ? undefined : liveArticle.index_in_rag !== false}
      onToggleIndexInRag={
        isPortal || !capabilities.ragIndexToggle
          ? undefined
          : (checked) => void handleToggleIndexInRag(checked)
      }
    />
  );
}
