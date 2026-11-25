import { FileText, ArrowLeft } from 'lucide-react';
import { deriveArticleBadges, formatArticleViews } from './kb-article-detail-utils';
import type { KbWorkbenchMode } from '../../lib/kb/kb-workbench-adapter';
import {
  getCategoryDisplayName,
  type KBCategoryRecord,
} from './kbCategoryUtils';
import { categoryI18nKey } from './kb-utils';

interface KBArticleDetailHeaderProps {
  mode?: KbWorkbenchMode;
  title: string;
  category: string;
  subCategory?: string;
  categories?: KBCategoryRecord[];
  article: {
    owner?: string;
    reviewer?: string;
    reviewDueDate?: string;
    views?: number;
    linkedTicket?: string;
    status?: string;
    visibility?: string;
    tags?: string[];
    approvalStatus?: string;
  };
  onBack: () => void;
}

export function KBArticleDetailHeader({
  mode = 'staff',
  title,
  category,
  subCategory,
  categories = [],
  article,
  onBack,
}: KBArticleDetailHeaderProps) {
  const isPortal = mode === 'portal';
  const badges = deriveArticleBadges(
    { ...article, category, subCategory },
    { locale: isPortal ? 'de' : 'en' },
  );
  const ticketRef = article.linkedTicket || '—';
  const categoryLabel = getCategoryDisplayName(
    category,
    categories,
    (_key, fallback) => fallback || category,
    categoryI18nKey,
  );
  const uncategorizedLabel = isPortal ? 'Unkategorisiert' : 'Uncategorized';
  const displayCategory =
    categoryLabel === 'Uncategorized' || category === 'uncategorized'
      ? uncategorizedLabel
      : categoryLabel;

  return (
    <header className="space-y-4 pb-4 border-b border-slate-200/80">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {isPortal ? 'Zurück zur Wissensdatenbank' : 'Back to articles'}
      </button>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {displayCategory}
            {!isPortal && subCategory ? ` · ${subCategory}` : null}
            {!isPortal && !subCategory ? ' · General' : null}
          </p>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight leading-snug mt-0.5">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span key={badge.key} className={badge.className}>
            {badge.label}
          </span>
        ))}
      </div>

      {!isPortal ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-[11px]">
          <ContextItem label="Owner" value={article.owner || '—'} />
          <ContextItem label="Reviewer" value={article.reviewer || '—'} />
          <ContextItem label="Review Due" value={article.reviewDueDate || '—'} />
          <ContextItem label="Views" value={formatArticleViews(article.views ?? 0)} />
          <ContextItem label="Tickets" value={ticketRef} />
        </div>
      ) : null}
    </header>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-xs font-medium text-slate-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}
