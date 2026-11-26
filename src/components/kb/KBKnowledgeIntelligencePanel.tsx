import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  GitBranch,
  Network,
  BookOpen,
  Ticket,
  Building2,
  Server,
  Tag,
  User,
  Calendar,
  Loader2,
  RefreshCw,
  Database,
  FolderTree,
  Plus,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { cn, safeString } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import type {
  KBArticleInfrastructureTrust,
  KBArticleWorkflowStep,
} from '../../types';
import { KBRelationship } from '../../services/kbRelationshipService';
import { KBKnowledgeGraphModal } from './KBKnowledgeGraphModal';
import { formatArticleDate, parseSummaryBullets } from '../../lib/kb-article-defaults';
import type { KbWorkbenchMode } from '../../lib/kb/kb-workbench-adapter';
import {
  UNCATEGORIZED_CATEGORY_ID,
  resolveArticleCategoryId,
  type KBCategoryRecord,
} from './kbCategoryUtils';

interface KBKnowledgeIntelligencePanelProps {
  mode?: KbWorkbenchMode;
  article: {
    id?: string;
    title?: string;
    owner?: string;
    reviewer?: string;
    authorId?: string;
    tags?: string[];
    createdAt?: unknown;
    updatedAt?: unknown;
    trustScore?: number;
    category?: string;
    linkedTicket?: string;
    workflowSteps?: KBArticleWorkflowStep[];
  };
  infrastructureTrust: KBArticleInfrastructureTrust;
  aiSummary?: string | null;
  isSummaryLoading?: boolean;
  summaryFailed?: boolean;
  onRetrySummary?: () => void;
  relationships: KBRelationship[];
  categories?: KBCategoryRecord[];
  canEditCategory?: boolean;
  canCreateCategory?: boolean;
  onCategoryChange?: (categoryId: string) => Promise<void> | void;
  onCreateCategory?: () => void;
  onAskAi: (forceRefresh?: boolean) => void;
  /** Explicit RAG opt-in state (undefined hides the toggle). */
  indexInRag?: boolean;
  onToggleIndexInRag?: (checked: boolean) => void;
}

const DEFAULT_WORKFLOW: KBArticleWorkflowStep[] = [
  { id: 'owner', label: 'Owner', status: 'complete' },
  { id: 'reviewer', label: 'Reviewer', status: 'complete' },
  { id: 'security', label: 'Security', status: 'active' },
  { id: 'compliance', label: 'Compliance', status: 'pending' },
];

export function KBKnowledgeIntelligencePanel({
  mode = 'staff',
  article,
  infrastructureTrust,
  aiSummary,
  isSummaryLoading = false,
  summaryFailed = false,
  onRetrySummary,
  relationships,
  categories = [],
  canEditCategory = false,
  canCreateCategory = false,
  onCategoryChange,
  onCreateCategory,
  onAskAi,
  indexInRag,
  onToggleIndexInRag,
}: KBKnowledgeIntelligencePanelProps) {
  const { t } = useTranslation();
  const isPortal = mode === 'portal';
  const [graphOpen, setGraphOpen] = useState(false);
  const [categorySaving, setCategorySaving] = useState(false);
  const summaryBullets = useMemo(() => parseSummaryBullets(aiSummary), [aiSummary]);
  const workflowSteps = article.workflowSteps?.length ? article.workflowSteps : DEFAULT_WORKFLOW;

  const trustScore = infrastructureTrust.trustScore ?? article.trustScore ?? 0;
  const trustLabel = trustScore >= 90 ? 'Excellent' : trustScore >= 75 ? 'Good' : 'Review';

  const categoryValue = resolveArticleCategoryId(
    { category: article.category },
    categories,
  );

  const graphPreview = useMemo(() => {
    const titleKey = (article.title || '').toLowerCase();
    const relevant = relationships.filter(
      (rel) =>
        rel.sourceName.toLowerCase().includes(titleKey) ||
        rel.targetName.toLowerCase().includes(titleKey),
    );
    const nodeNames = new Set<string>([article.title || 'Article']);
    for (const rel of relevant.slice(0, 6)) {
      nodeNames.add(rel.sourceName);
      nodeNames.add(rel.targetName);
    }
    return Array.from(nodeNames).slice(0, 6);
  }, [article.title, relationships]);

  const handleCategorySelect = async (next: string) => {
    if (!onCategoryChange || next === categoryValue) return;
    setCategorySaving(true);
    try {
      await onCategoryChange(next);
    } finally {
      setCategorySaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PanelCard
        title={isPortal ? 'Artikel-Metadaten' : t('kb.detail.metadata', 'Article metadata')}
        icon={BookOpen}
      >
        <div className="space-y-2 text-[11px]">
          <MetaRow
            icon={User}
            label={isPortal ? 'Autor' : t('kb.detail.author', 'Author')}
            value={article.owner || article.authorId || '—'}
          />
          <MetaRow
            icon={Calendar}
            label={isPortal ? 'Erstellt' : t('kb.detail.created', 'Created')}
            value={formatArticleDate(article.createdAt)}
          />
          <MetaRow
            icon={Calendar}
            label={isPortal ? 'Zuletzt aktualisiert' : t('kb.detail.lastUpdated', 'Last updated')}
            value={formatArticleDate(article.updatedAt)}
          />
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <FolderTree className="w-3 h-3" />
              Kategorie
            </p>
            {canCreateCategory && onCreateCategory ? (
              <button
                type="button"
                onClick={onCreateCategory}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
              >
                <Plus className="w-3 h-3" />
                Neue Kategorie
              </button>
            ) : null}
          </div>
          {canEditCategory && onCategoryChange ? (
            <select
              value={categoryValue}
              disabled={categorySaving}
              onChange={(e) => void handleCategorySelect(e.target.value)}
              className="w-full h-9 border border-slate-200 rounded-lg px-2.5 text-[11px] bg-slate-50 font-semibold text-slate-800 cursor-pointer disabled:opacity-60"
              aria-label="Kategorie"
            >
              <option value={UNCATEGORIZED_CATEGORY_ID}>Ohne Kategorie</option>
              {categories
                .filter((cat) => cat.id !== UNCATEGORIZED_CATEGORY_ID)
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
          ) : (
            <p className="text-[11px] font-medium text-slate-800">
              {categories.find((c) => c.id === categoryValue)?.name ||
                (categoryValue === UNCATEGORIZED_CATEGORY_ID
                  ? isPortal
                    ? 'Unkategorisiert'
                    : 'Uncategorized'
                  : article.category || '—')}
            </p>
          )}
        </div>

        {article.tags?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {article.tags.map((tag) => {
              const tagText =
                typeof tag === 'string'
                  ? tag
                  : tag && typeof tag === 'object'
                    ? safeString((tag as Record<string, unknown>).name) ||
                      safeString((tag as Record<string, unknown>).label) ||
                      String(tag)
                    : String(tag ?? '');
              if (!tagText || typeof tagText === 'object') return null;
              return (
                <span
                  key={String(tagText)}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                >
                  <Tag className="w-3 h-3" />
                  {String(tagText)}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-slate-400 mt-2">
            {isPortal ? 'Keine Tags' : t('kb.detail.noTags', 'No tags')}
          </p>
        )}
      </PanelCard>

      {/* RAG toggle — staff always; portal when capabilities.ragIndexToggle wires handlers */}
      {typeof indexInRag === 'boolean' && onToggleIndexInRag ? (
        <PanelCard title={t('kb.editor.ragAccess', 'KI-Wissensspeicher (RAG)')} icon={Database}>
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-violet-500" />
                {t('kb.editor.includeInRag', 'In KI-Wissensspeicher (RAG) aufnehmen')}
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                {indexInRag
                  ? t('kb.detail.ragIncluded', 'Wird vom KI-Copiloten zitiert.')
                  : t('kb.detail.ragExcluded', 'Öffentlich lesbar, aber vom KI-Copiloten ausgeschlossen.')}
              </span>
            </div>
            <Switch
              checked={indexInRag}
              onCheckedChange={onToggleIndexInRag}
              aria-label={t('kb.editor.includeInRag', 'In KI-Wissensspeicher (RAG) aufnehmen')}
            />
          </div>
        </PanelCard>
      ) : null}

      {!isPortal ? (
        <PanelCard title={t('kb.detail.aiSummary', 'AI Summary')} icon={Sparkles}>
          {isSummaryLoading ? (
            <div className="flex items-center gap-2 text-[11px] text-slate-500 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('kb.detail.generatingSummary', 'Generating summary…')}
            </div>
          ) : summaryFailed ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] text-rose-700">
              {t('kb.detail.summaryFailed', 'KI-Zusammenfassung konnte nicht erstellt werden')}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full mt-2 h-8 rounded-xl text-[11px] font-semibold border-rose-200 text-rose-700 hover:bg-rose-100"
                onClick={() => onRetrySummary?.()}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                {t('kb.detail.retrySummary', 'Zusammenfassung erneut versuchen')}
              </Button>
            </div>
          ) : summaryBullets.length > 0 ? (
            <ul className="space-y-2 text-[11px] text-slate-600 leading-relaxed">
              {summaryBullets.map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-blue-600 font-bold shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">
              {t('kb.detail.noSummaryYet', 'No cached summary yet. Ask AI to generate one.')}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full mt-3 h-8 rounded-xl text-[11px] font-semibold border-blue-200 text-blue-700 hover:bg-blue-50"
            onClick={() => onAskAi(true)}
            disabled={isSummaryLoading}
          >
            {isSummaryLoading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            {t('kb.detail.askAiAgain', 'Ask AI about this article')}
          </Button>
        </PanelCard>
      ) : null}

      {!isPortal ? (
        <PanelCard title={t('kb.detail.infrastructureTrust', 'Infrastructure & Trust')} icon={ShieldCheck}>
          <div className="space-y-2 text-[11px]">
            {infrastructureTrust.reviewed ? (
              <ValidationRow label={t('kb.detail.reviewed', 'Reviewed')} />
            ) : null}
            {infrastructureTrust.technicallyVerified ? (
              <ValidationRow label={t('kb.detail.technicallyVerified', 'Technically verified')} />
            ) : null}
          </div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t('kb.detail.enterpriseTrustScore', 'Enterprise trust score')}
            </p>
            <p className="text-lg font-semibold text-slate-900 mt-0.5">
              {trustScore}/100{' '}
              <span className="text-sm font-medium text-emerald-600">({trustLabel})</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <MetricCell
              label={t('kb.detail.hallucinationRisk', 'Hallucination risk')}
              value={infrastructureTrust.hallucinationRisk || '—'}
              tone="emerald"
            />
            <MetricCell
              label={t('kb.detail.coverage', 'Coverage')}
              value={infrastructureTrust.coverage || '—'}
              tone="blue"
            />
            <MetricCell
              label={t('kb.detail.freshness', 'Freshness')}
              value={infrastructureTrust.freshness || '—'}
              tone="blue"
            />
          </div>
        </PanelCard>
      ) : null}

      {!isPortal ? (
        <PanelCard title={t('kb.detail.reviewWorkflow', 'Review workflow')} icon={GitBranch}>
          <div className="space-y-0">
            {workflowSteps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-2 relative">
                {idx < workflowSteps.length - 1 ? (
                  <span className="absolute left-[7px] top-5 w-px h-6 bg-slate-200" />
                ) : null}
                <span
                  className={cn(
                    'w-3.5 h-3.5 rounded-full border-2 shrink-0 z-10',
                    step.status === 'complete' && 'bg-emerald-500 border-emerald-500',
                    step.status === 'active' && 'bg-blue-600 border-blue-600',
                    step.status === 'pending' && 'bg-white border-slate-300',
                  )}
                />
                <span
                  className={cn(
                    'text-[11px] py-2',
                    step.status === 'active' ? 'font-semibold text-slate-900' : 'text-slate-600',
                  )}
                >
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </PanelCard>
      ) : null}

      {!isPortal ? (
        <PanelCard title={t('kb.detail.knowledgeGraph', 'Knowledge graph')} icon={Network}>
          <button
            type="button"
            onClick={() => setGraphOpen(true)}
            className="relative h-[140px] w-full rounded-xl border border-slate-200 bg-slate-50 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all"
            aria-label={t('kb.detail.openKnowledgeGraph', 'Open full knowledge graph')}
          >
            <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden>
              {graphPreview.map((label, index) => {
                const angle = (index / graphPreview.length) * Math.PI * 2;
                const x = index === 0 ? 50 : 50 + Math.cos(angle) * 28;
                const y = index === 0 ? 50 : 50 + Math.sin(angle) * 28;
                return (
                  <g key={label}>
                    <circle
                      cx={x}
                      cy={y}
                      r={index === 0 ? 5 : 3.5}
                      fill={index === 0 ? '#2563EB' : '#94A3B8'}
                    />
                    <text x={x} y={y + 8} textAnchor="middle" fontSize="3.5" fill="#475569">
                      {label.length > 16 ? `${label.slice(0, 14)}…` : label}
                    </text>
                  </g>
                );
              })}
            </svg>
            <span className="absolute bottom-2 right-2 text-[9px] font-semibold uppercase tracking-wide text-blue-700 bg-white/90 px-2 py-0.5 rounded-full border border-blue-100">
              {t('kb.detail.expandGraph', 'Expand')}
            </span>
          </button>
          <div className="flex flex-wrap gap-2 mt-2">
            <GraphLegend icon={BookOpen} label="Article" />
            <GraphLegend icon={Ticket} label="Ticket" />
            <GraphLegend icon={Building2} label="Customer" />
            <GraphLegend icon={Server} label="Asset" />
          </div>
        </PanelCard>
      ) : null}

      {!isPortal ? (
        <KBKnowledgeGraphModal
          open={graphOpen}
          onClose={() => setGraphOpen(false)}
          articleTitle={article.title || 'Article'}
          relationships={relationships}
        />
      ) : null}
    </div>
  );
}

function PanelCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-blue-600" />
        <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="font-medium text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
}

function ValidationRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-700">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
      <span>{label}</span>
    </div>
  );
}

function MetricCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'blue';
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center">
      <p className="text-[9px] text-slate-400 uppercase tracking-wide">{label}</p>
      <p
        className={cn(
          'text-xs font-semibold mt-0.5',
          tone === 'emerald' ? 'text-emerald-600' : 'text-blue-700',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function GraphLegend({ icon: Icon, label }: { icon: typeof BookOpen; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] text-slate-500">
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}
