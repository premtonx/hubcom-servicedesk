import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { KBArticleDetailHeader } from './KBArticleDetailHeader';
import { KBArticleDetailToolbar, type KBTranslateLanguage } from './KBArticleDetailToolbar';
import { KBArticleTableOfContents } from './KBArticleTableOfContents';
import { KBArticleDetailBody } from './KBArticleDetailBody';
import { KBKnowledgeIntelligencePanel } from './KBKnowledgeIntelligencePanel';
import { KBArticleToolbarPanels, type KBArticleToolbarPanel } from './KBArticleToolbarPanels';
import { extractArticleHeadings, injectHeadingIds } from './kb-article-detail-utils';
import { buildKbArticleDeepLink, toEditableHtml, toRenderableHtml } from './kb-content-format';
import type { KBArticleAlert, KBArticleHistoryEntry, KBArticleInfrastructureTrust } from '../../types';
import type { KBRelationship } from '../../services/kbRelationshipService';
import type { KbWorkbenchMode } from '../../lib/kb/kb-workbench-adapter';
import type { KBCategoryRecord } from './kbCategoryUtils';

export interface KBArticleDetailViewProps {
  mode?: KbWorkbenchMode;
  article: any;
  title: string;
  htmlContent: string;
  alerts?: KBArticleAlert[];
  activeReadingLanguage: string;
  isTranslating?: boolean;
  infrastructureTrust: KBArticleInfrastructureTrust;
  aiSummary?: string | null;
  isSummaryLoading?: boolean;
  summaryFailed?: boolean;
  onRetrySummary?: () => void;
  relationships: KBRelationship[];
  historyEntries?: KBArticleHistoryEntry[];
  isHistoryLoading?: boolean;
  categories?: KBCategoryRecord[];
  canEdit?: boolean;
  canManageCategories?: boolean;
  onBack: () => void;
  onCopyLink: () => void;
  onTranslate: (language: KBTranslateLanguage) => Promise<void>;
  onAiExplain: () => Promise<string>;
  onRegenerateSummary: (forceRefresh?: boolean) => Promise<void>;
  onLoadHistory: () => Promise<void>;
  onSaveContent: (content: string) => Promise<void>;
  onCategoryChange?: (categoryId: string) => Promise<void> | void;
  onCreateCategory?: () => void;
  onHelpful: () => Promise<void>;
  onUnhelpful: () => Promise<void>;
  indexInRag?: boolean;
  onToggleIndexInRag?: (checked: boolean) => void;
  onMarkOutdated?: (reason: string) => Promise<void> | void;
  onMarkArchived?: (reason: string) => Promise<void> | void;
  onRepublish?: (reenableRag: boolean) => Promise<void> | void;
}

export function KBArticleDetailView({
  mode = 'staff',
  article,
  title,
  htmlContent,
  alerts = [],
  activeReadingLanguage,
  isTranslating = false,
  infrastructureTrust,
  aiSummary,
  isSummaryLoading = false,
  summaryFailed = false,
  onRetrySummary,
  relationships,
  historyEntries = [],
  isHistoryLoading = false,
  categories = [],
  canEdit = true,
  canManageCategories = false,
  onBack,
  onCopyLink,
  onTranslate,
  onAiExplain,
  onRegenerateSummary,
  onLoadHistory,
  onSaveContent,
  onCategoryChange,
  onCreateCategory,
  onHelpful,
  onUnhelpful,
  indexInRag,
  onToggleIndexInRag,
  onMarkOutdated,
  onMarkArchived,
  onRepublish,
}: KBArticleDetailViewProps) {
  const isPortal = mode === 'portal';
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [activePanel, setActivePanel] = useState<KBArticleToolbarPanel>(null);
  const [aiExplainContent, setAiExplainContent] = useState('');
  const [isAiExplainLoading, setIsAiExplainLoading] = useState(false);
  const [outdatedDialog, setOutdatedDialog] = useState<'outdated' | 'archived' | null>(null);
  const [outdatedReason, setOutdatedReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollAreaRootRef = useRef<HTMLDivElement>(null);

  const statusLower = String(article.status || '').toLowerCase();
  const isMarkedOutdated =
    statusLower === 'outdated' || statusLower === 'archived';
  const outdatedReasonText = String(
    article.outdated_reason || article.outdatedReason || '',
  ).trim();
  const outdatedAtRaw = article.outdated_at || article.outdatedAt;
  const outdatedAtLabel = outdatedAtRaw
    ? new Date(String(outdatedAtRaw)).toLocaleString('de-DE')
    : null;

  const articleUrl = useMemo(
    () => buildKbArticleDeepLink(article.id, mode),
    [article.id, mode],
  );
  const viewSourceContent = article.content ?? htmlContent;

  const renderedHtml = useMemo(() => {
    const displayHtml = toRenderableHtml(htmlContent);
    const headingList = extractArticleHeadings(displayHtml);
    return injectHeadingIds(displayHtml, headingList);
  }, [htmlContent]);

  const headings = useMemo(() => extractArticleHeadings(toRenderableHtml(htmlContent)), [htmlContent]);

  useEffect(() => {
    const viewport = scrollAreaRootRef.current
      ?.closest('[data-slot="scroll-area"]')
      ?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null;
    scrollContainerRef.current = viewport;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isEditing) {
        setEditedContent(toEditableHtml(viewSourceContent));
        setIsEditing(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditing, viewSourceContent]);

  const handleToggleEdit = () => {
    if (!canEdit || isEditing) return;
    setEditedContent(toEditableHtml(viewSourceContent));
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editedContent.trim()) {
      toast.error(
        isPortal ? 'Artikelinhalt darf nicht leer sein.' : 'Article content cannot be empty.',
      );
      return;
    }

    setIsSaving(true);
    try {
      await onSaveContent(editedContent.trim());
      setIsEditing(false);
      toast.success('Artikel erfolgreich aktualisiert!');
    } catch {
      toast.error(
        isPortal
          ? 'Artikel konnte nicht gespeichert werden. Bitte später erneut versuchen.'
          : 'Failed to save article. Please try again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = useCallback(() => {
    window.print();
  }, []);

  const handleAiExplain = useCallback(async () => {
    if (isPortal) return;
    setActivePanel('ai-explain');
    setAiExplainContent('');
    setIsAiExplainLoading(true);
    try {
      const output = await onAiExplain();
      setAiExplainContent(output);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI Explain failed.';
      setAiExplainContent(message);
      toast.error(message);
    } finally {
      setIsAiExplainLoading(false);
    }
  }, [isPortal, onAiExplain]);

  const handleTranslate = useCallback(
    async (language: KBTranslateLanguage) => {
      if (isPortal) return;
      try {
        await onTranslate(language);
      } catch {
        toast.error('Translation failed. Please try again.');
      }
    },
    [isPortal, onTranslate],
  );

  const openHistoryPanel = useCallback(async () => {
    if (isPortal) return;
    setActivePanel('history');
    await onLoadHistory();
  }, [isPortal, onLoadHistory]);

  const openComparePanel = useCallback(async () => {
    if (isPortal) return;
    setActivePanel('compare');
    await onLoadHistory();
  }, [isPortal, onLoadHistory]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[#FAFBFC] print:block print:overflow-visible print:bg-white">
      <div className="flex-[7] min-w-0 flex flex-col min-h-0 border-r border-slate-200/80 print:w-full print:max-w-none print:border-none print:min-h-0">
        <ScrollArea className="flex-1 min-h-0 print:overflow-visible print:h-auto">
          <div
            ref={scrollAreaRootRef}
            className="kb-article-print-root max-w-[850px] mx-auto px-5 sm:px-6 py-6 pb-12 min-w-0 overflow-x-hidden print:w-full print:max-w-none print:shadow-none print:border-none print:p-0 print:mx-0 print:bg-white"
          >
            <div className="kb-detail-no-print print:hidden">
              <KBArticleDetailHeader
                mode={mode}
                title={title}
                category={article.category}
                subCategory={article.subCategory}
                article={article}
                categories={categories}
                onBack={onBack}
              />
            </div>

            {isMarkedOutdated ? (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 print:hidden">
                <p className="font-bold">
                  Dieser Artikel ist als{' '}
                  {statusLower === 'archived' ? 'archiviert' : 'veraltet'} markiert und wird von
                  der KI nicht mehr verwendet.
                </p>
                {outdatedReasonText ? (
                  <p className="mt-1 text-amber-900/90">Grund: {outdatedReasonText}</p>
                ) : null}
                {outdatedAtLabel ? (
                  <p className="mt-0.5 text-xs text-amber-800/80">Markiert am {outdatedAtLabel}</p>
                ) : null}
              </div>
            ) : null}

            <div className="print:hidden">
              <KBArticleDetailToolbar
                className="mt-4"
                mode={mode}
                canEdit={canEdit}
                isEditing={isEditing}
                isSaving={isSaving || lifecycleBusy}
                isTranslating={isTranslating}
                activeLanguage={activeReadingLanguage}
                onEdit={handleToggleEdit}
                onSave={() => void handleSave()}
                onShare={isPortal ? () => setActivePanel('share') : () => setActivePanel('share')}
                onHistory={() => void openHistoryPanel()}
                onCompare={() => void openComparePanel()}
                onTranslate={(lang) => void handleTranslate(lang)}
                onAiExplain={() => void handleAiExplain()}
                onExportPdf={handleExportPdf}
                onCopyLink={onCopyLink}
                articleStatus={article.status}
                onMarkOutdated={
                  canEdit && onMarkOutdated ? () => setOutdatedDialog('outdated') : undefined
                }
                onMarkArchived={
                  canEdit && onMarkArchived ? () => setOutdatedDialog('archived') : undefined
                }
                onRepublish={
                  canEdit && onRepublish
                    ? () => {
                        void (async () => {
                          setLifecycleBusy(true);
                          try {
                            await onRepublish(false);
                          } finally {
                            setLifecycleBusy(false);
                          }
                        })();
                      }
                    : undefined
                }
              />
            </div>

            {outdatedDialog ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-white p-4 shadow-sm space-y-3 print:hidden">
                <p className="text-sm font-bold text-slate-900">
                  {outdatedDialog === 'archived'
                    ? 'Artikel archivieren?'
                    : 'Artikel als veraltet markieren?'}
                </p>
                <p className="text-xs text-slate-600">
                  Der Artikel wird sofort aus dem KI-Wissensspeicher (RAG) entfernt.
                </p>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">
                    Optionaler Grund (z. B. „Ersetzt durch neue PrüfApp-Version“)
                  </span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={outdatedReason}
                    onChange={(e) => setOutdatedReason(e.target.value)}
                    placeholder="Grund (optional)"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={lifecycleBusy}
                    onClick={() => {
                      void (async () => {
                        setLifecycleBusy(true);
                        try {
                          if (outdatedDialog === 'archived') {
                            await onMarkArchived?.(outdatedReason);
                          } else {
                            await onMarkOutdated?.(outdatedReason);
                          }
                          setOutdatedDialog(null);
                          setOutdatedReason('');
                        } finally {
                          setLifecycleBusy(false);
                        }
                      })();
                    }}
                  >
                    Bestätigen
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={lifecycleBusy}
                    onClick={() => {
                      setOutdatedDialog(null);
                      setOutdatedReason('');
                    }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="print-only-article-title hidden print:block mb-6">
              <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
              <p className="text-sm text-slate-500 mt-1">
                {article.category} · {article.subCategory || (isPortal ? 'Allgemein' : 'General')}
              </p>
            </div>

            <div className="flex flex-col xl:flex-row gap-6 mt-6 min-w-0 print:mt-0 print:block">
              {!isEditing ? (
                <KBArticleTableOfContents
                  headings={headings}
                  scrollContainerRef={scrollContainerRef}
                  locale={isPortal ? 'de' : 'en'}
                />
              ) : null}
              <KBArticleDetailBody
                htmlContent={renderedHtml}
                alerts={alerts}
                isEditing={isEditing}
                editedContent={editedContent}
                onContentChange={setEditedContent}
              />
            </div>

            {!isPortal ? (
              <div className="kb-detail-no-print print:hidden mt-8 rounded-xl border border-slate-200/80 bg-white p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-900">Was this documentation helpful?</h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Feedback updates the enterprise trust score model.
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200"
                    onClick={() => void onHelpful()}
                  >
                    <ThumbsUp className="w-3.5 h-3.5 text-emerald-600" />
                    Yes ({article.helpfulCount || 0})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200"
                    onClick={() => void onUnhelpful()}
                  >
                    <ThumbsDown className="w-3.5 h-3.5 text-rose-500" />
                    No ({article.unhelpfulCount || 0})
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      <aside className="kb-detail-no-print print:hidden flex-[3] min-w-[280px] max-w-[400px] shrink-0 min-h-0 overflow-y-auto bg-white p-4 custom-scrollbar">
        <KBKnowledgeIntelligencePanel
          mode={mode}
          article={article}
          infrastructureTrust={infrastructureTrust}
          aiSummary={aiSummary}
          isSummaryLoading={isSummaryLoading}
          summaryFailed={summaryFailed}
          onRetrySummary={onRetrySummary}
          relationships={relationships}
          categories={categories}
          canEditCategory={canEdit}
          canCreateCategory={canManageCategories}
          onCategoryChange={onCategoryChange}
          onCreateCategory={onCreateCategory}
          onAskAi={(forceRefresh) => void onRegenerateSummary(forceRefresh)}
          indexInRag={indexInRag}
          onToggleIndexInRag={onToggleIndexInRag}
        />
      </aside>

      <KBArticleToolbarPanels
        activePanel={activePanel}
        onClose={() => setActivePanel(null)}
        article={article}
        articleUrl={articleUrl}
        historyEntries={historyEntries}
        isHistoryLoading={isHistoryLoading}
        aiExplainContent={aiExplainContent}
        isAiExplainLoading={isAiExplainLoading}
        onCopyLink={onCopyLink}
      />
    </div>
  );
}
