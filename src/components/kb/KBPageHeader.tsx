import React from 'react';
import { ChevronDown, Sparkles, Upload, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface KBPageHeaderProps {
  onImportDocs: () => void;
  onAiGenerate: () => void;
  onNewArticle: () => void;
  onNewCategory?: () => void;
  className?: string;
  /** Staff-only: Dokumente importieren (default true for identical staff UI). */
  showImportDocs?: boolean;
  /** Staff-only: KI generieren (default true). */
  showAiGenerate?: boolean;
  /** Hide "+ Neu" create menu (CLIENT_USER read-only). */
  showNewMenu?: boolean;
  /** Portal: hide "Kategorie erstellen" in the new menu. */
  showNewCategory?: boolean;
  title?: string;
  subtitle?: string;
}

export function KBPageHeader({
  onImportDocs,
  onAiGenerate,
  onNewArticle,
  onNewCategory,
  className,
  showImportDocs = true,
  showAiGenerate = true,
  showNewMenu = true,
  showNewCategory = true,
  title,
  subtitle,
}: KBPageHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className={cn('flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {title ?? t('kb.pageTitle', 'Knowledge Base')}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
          {subtitle ??
            t(
              'kb.pageSubtitle',
              'Centralized documentation, SOPs, onboarding guides, and AI-powered company knowledge',
            )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {showImportDocs ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onImportDocs}
          className="h-9 rounded-xl text-xs font-semibold border-slate-200/80"
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {t('kb.actions.importDocs', 'Import Docs')}
        </Button>
        ) : null}
        {showAiGenerate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAiGenerate}
          className="h-9 rounded-xl text-xs font-semibold border-slate-200/80"
        >
          <Sparkles className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
          {t('kb.actions.aiGenerateShort', 'AI Generate')}
        </Button>
        ) : null}
        {showNewMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('kb.actions.newShort', '+ Neu')}
                <ChevronDown className="w-3.5 h-3.5 opacity-80" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56 rounded-xl">
            <DropdownMenuItem onClick={onNewArticle} className="text-xs font-medium">
              {t('kb.actions.createArticle', '📄 Artikel erstellen')}
            </DropdownMenuItem>
            {showNewCategory ? (
            <DropdownMenuItem onClick={onNewCategory ?? onNewArticle} className="text-xs font-medium">
              {t('kb.actions.createCategory', '📁 Kategorie erstellen')}
            </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}
