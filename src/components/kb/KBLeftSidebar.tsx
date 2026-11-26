import { type ElementType, type ReactNode } from 'react';
import {
  LayoutDashboard,
  FileText,
  FilePen,
  ClipboardCheck,
  Sparkles,
  BarChart3,
  TrendingUp,
  Clock,
  Eye,
  BookX,
  AlertTriangle,
  Settings,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { categoryI18nKey } from './kb-utils';
import { UNCATEGORIZED_CATEGORY_ID, type KBCategoryRecord } from './kbCategoryUtils';

export type KBNavFilter =
  | { type: 'workspace'; id: string }
  | { type: 'category'; id: string }
  | { type: 'smart'; id: string };

interface KBLeftSidebarProps {
  active: KBNavFilter;
  onNavigate: (filter: KBNavFilter) => void;
  onOpenSettings?: () => void;
  categories: KBCategoryRecord[];
  counts: {
    all: number;
    drafts: number;
    reviews: number;
    categories: Record<string, number>;
    popular: number;
    recent: number;
    mostViewed: number;
    missing: number;
    outdated: number;
  };
  healthScore?: number;
  className?: string;
  /** When set, only these workspace nav ids are shown (staff default = all). */
  workspaceItemIds?: ReadonlyArray<
    'overview' | 'all' | 'drafts' | 'reviews' | 'ai' | 'analytics'
  >;
  /** Hide KB Health Score telemetry block. */
  showHealthScore?: boolean;
  /** When set, only these smart-view ids are shown. */
  smartItemIds?: ReadonlyArray<
    'popular' | 'recent' | 'mostViewed' | 'missing' | 'outdated'
  >;
  /** Show + beside KATEGORIEN and hover rename/delete for org categories. */
  canManageCategories?: boolean;
  onCreateCategory?: () => void;
  onRenameCategory?: (categoryId: string) => void;
  onDeleteCategory?: (categoryId: string) => void;
}

const WORKSPACE_ITEMS = [
  { id: 'overview', icon: LayoutDashboard, labelKey: 'kb.sidebar.overview', defaultLabel: 'Overview' },
  { id: 'all', icon: FileText, labelKey: 'kb.sidebar.allArticles', defaultLabel: 'All Articles' },
  { id: 'drafts', icon: FilePen, labelKey: 'kb.sidebar.drafts', defaultLabel: 'Drafts' },
  { id: 'reviews', icon: ClipboardCheck, labelKey: 'kb.sidebar.reviews', defaultLabel: 'Reviews' },
  { id: 'ai', icon: Sparkles, labelKey: 'kb.sidebar.aiAssistant', defaultLabel: 'AI Assistant' },
  { id: 'analytics', icon: BarChart3, labelKey: 'kb.sidebar.analytics', defaultLabel: 'Analytics' },
] as const;

const SMART_ITEMS = [
  { id: 'popular', icon: TrendingUp, labelKey: 'kb.sidebar.popularArticles', defaultLabel: 'Popular Articles' },
  { id: 'recent', icon: Clock, labelKey: 'kb.sidebar.recentlyUpdated', defaultLabel: 'Recently Updated' },
  { id: 'mostViewed', icon: Eye, labelKey: 'kb.sidebar.mostViewed', defaultLabel: 'Most Viewed' },
  { id: 'missing', icon: BookX, labelKey: 'kb.sidebar.missingArticles', defaultLabel: 'Missing Articles' },
  { id: 'outdated', icon: AlertTriangle, labelKey: 'kb.sidebar.outdatedContent', defaultLabel: 'Veraltete Inhalte' },
] as const;

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: ElementType;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors text-left',
        active
          ? 'bg-[#E8F0FE] text-[#1A73E8]'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      )}
    >
      <Icon className="w-4 h-4 shrink-0 opacity-80" />
      <span className="truncate flex-1">{label}</span>
      {count !== undefined ? (
        <span className={cn('text-[11px] tabular-nums shrink-0', active ? 'text-blue-600' : 'text-slate-400')}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  );
}

export function KBLeftSidebar({
  active,
  onNavigate,
  onOpenSettings,
  categories,
  counts,
  healthScore,
  className,
  workspaceItemIds,
  showHealthScore = true,
  smartItemIds,
  canManageCategories = false,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
}: KBLeftSidebarProps) {
  const { t } = useTranslation();

  const isActive = (type: KBNavFilter['type'], id: string) =>
    active.type === type && active.id === id;

  const workspaceItems = workspaceItemIds
    ? WORKSPACE_ITEMS.filter((item) => workspaceItemIds.includes(item.id))
    : WORKSPACE_ITEMS;

  const smartItems = smartItemIds
    ? SMART_ITEMS.filter((item) => smartItemIds.includes(item.id))
    : SMART_ITEMS;

  const workspaceCount = (id: string) => {
    if (id === 'all' || id === 'overview' || id === 'analytics') return counts.all;
    if (id === 'drafts') return counts.drafts;
    if (id === 'reviews') return counts.reviews;
    return undefined;
  };

  const smartCount = (id: string) => {
    if (id === 'popular') return counts.popular;
    if (id === 'recent') return counts.recent;
    if (id === 'mostViewed') return counts.mostViewed;
    if (id === 'missing') return counts.missing;
    if (id === 'outdated') return counts.outdated;
    return undefined;
  };

  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);

  return (
    <aside
      className={cn(
        'w-[220px] shrink-0 border-r border-slate-200/80 bg-white flex flex-col min-h-0 hidden lg:flex print:hidden',
        className,
      )}
    >
      <div className="flex-1 overflow-y-auto py-3 px-2">
        <SectionLabel>{t('kb.sidebar.workspace', 'Workspace')}</SectionLabel>
        <nav className="space-y-0.5">
          {workspaceItems.map((item) => (
            <NavButton
              key={item.id}
              active={isActive('workspace', item.id)}
              onClick={() => onNavigate({ type: 'workspace', id: item.id })}
              icon={item.icon}
              label={t(item.labelKey, item.defaultLabel)}
              count={workspaceCount(item.id)}
            />
          ))}
        </nav>

        <div className="flex items-center justify-between gap-1 px-3 pt-4 pb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {t('kb.sidebar.categories', 'Categories')}
          </p>
          {canManageCategories && onCreateCategory ? (
            <button
              type="button"
              onClick={onCreateCategory}
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title={t('kb.actions.createCategory', 'Kategorie erstellen')}
              aria-label={t('kb.actions.createCategory', 'Kategorie erstellen')}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
        <nav className="space-y-0.5">
          {categories.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-slate-400">
              {t('kb.sidebar.noCategories', 'Noch keine Kategorien')}
            </p>
          ) : (
          sortedCategories.map((item) => {
            const canEditItem =
              canManageCategories &&
              item.id !== UNCATEGORIZED_CATEGORY_ID &&
              (onRenameCategory || onDeleteCategory);
            return (
              <div key={item.id} className="group relative">
                <NavButton
                  active={isActive('category', item.id)}
                  onClick={() => onNavigate({ type: 'category', id: item.id })}
                  icon={item.icon}
                  label={t(categoryI18nKey(item.name), item.name)}
                  count={counts.categories[item.id] ?? 0}
                />
                {canEditItem ? (
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-white/95 rounded-md border border-slate-200 shadow-sm p-0.5">
                    {onRenameCategory ? (
                      <button
                        type="button"
                        className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        title={t('kb.categoryRename.action', 'Umbenennen')}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRenameCategory(item.id);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    ) : null}
                    {onDeleteCategory ? (
                      <button
                        type="button"
                        className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                        title={t('kb.categoryDelete.action', 'Löschen')}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteCategory(item.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
          )}
        </nav>

        {smartItems.length > 0 ? (
        <>
        <SectionLabel>{t('kb.sidebar.smartViews', 'Intelligente Ansichten')}</SectionLabel>
        <nav className="space-y-0.5">
          {smartItems.map((item) => (
            <NavButton
              key={item.id}
              active={isActive('smart', item.id)}
              onClick={() => onNavigate({ type: 'smart', id: item.id })}
              icon={item.icon}
              label={t(item.labelKey, item.defaultLabel)}
              count={smartCount(item.id)}
            />
          ))}
        </nav>
        </>
        ) : null}

        {showHealthScore && typeof healthScore === 'number' ? (
          <div className="mt-4 mx-1 rounded-xl border border-slate-200/80 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t('kb.sidebar.healthScore', 'KB Health Score')}
            </p>
            <p className="text-xl font-semibold text-slate-900 mt-1">{healthScore}%</p>
            <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, healthScore))}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              {t('kb.sidebar.healthHint', 'Aggregate trust across published articles')}
            </p>
          </div>
        ) : null}
      </div>

      {onOpenSettings ? (
      <div className="border-t border-slate-200/80 p-2 shrink-0">
        <NavButton
          active={false}
          onClick={() => onOpenSettings()}
          icon={Settings}
          label={t('kb.sidebar.settings', 'Settings')}
        />
      </div>
      ) : null}
    </aside>
  );
}
