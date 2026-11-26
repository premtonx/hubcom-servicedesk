import { useState } from 'react';
import {
  PenLine,
  Share2,
  History,
  Split,
  Languages,
  Sparkles,
  Download,
  Link2,
  Save,
  ChevronDown,
  AlertTriangle,
  Archive,
  RotateCcw,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';
import type { KbWorkbenchMode } from '../../lib/kb/kb-workbench-adapter';
import { isOutdatedStatus, normalizeKbStatus } from '../../lib/kb-dashboard-metrics';

export const KB_TRANSLATE_LANGUAGES = [
  'English',
  'German',
  'French',
  'Spanish',
  'Japanese',
  'Italian',
  'Dutch',
] as const;

export type KBTranslateLanguage = (typeof KB_TRANSLATE_LANGUAGES)[number];

export interface KBArticleDetailToolbarProps {
  className?: string;
  mode?: KbWorkbenchMode;
  canEdit?: boolean;
  isEditing?: boolean;
  isSaving?: boolean;
  isTranslating?: boolean;
  activeLanguage?: string;
  onEdit: () => void;
  onSave?: () => void;
  onShare: () => void;
  onHistory: () => void;
  onCompare: () => void;
  onTranslate: (language: KBTranslateLanguage) => void;
  onAiExplain: () => void;
  onExportPdf: () => void;
  onCopyLink: () => void;
  articleStatus?: string | null;
  onMarkOutdated?: () => void;
  onMarkArchived?: () => void;
  onRepublish?: () => void;
}

type ToolbarActionId =
  | 'edit'
  | 'share'
  | 'history'
  | 'compare'
  | 'translate'
  | 'ai-explain'
  | 'export'
  | 'copy';

export function KBArticleDetailToolbar({
  className,
  mode = 'staff',
  canEdit = true,
  isEditing = false,
  isSaving = false,
  isTranslating = false,
  activeLanguage = 'English',
  onEdit,
  onSave,
  onShare,
  onHistory,
  onCompare,
  onTranslate,
  onAiExplain,
  onExportPdf,
  onCopyLink,
  articleStatus,
  onMarkOutdated,
  onMarkArchived,
  onRepublish,
}: KBArticleDetailToolbarProps) {
  const isPortal = mode === 'portal';
  const [translateOpen, setTranslateOpen] = useState(false);
  const statusNorm = normalizeKbStatus(articleStatus || undefined);
  const isOutdatedOrArchived = isOutdatedStatus(articleStatus || undefined);

  const actions: Array<{ id: ToolbarActionId; label: string; icon: typeof PenLine }> = isPortal
    ? [
        { id: 'edit', label: 'Bearbeiten', icon: PenLine },
        { id: 'copy', label: 'Link kopieren', icon: Link2 },
        { id: 'export', label: 'Als PDF exportieren', icon: Download },
      ]
    : [
        { id: 'edit', label: 'Edit', icon: PenLine },
        { id: 'share', label: 'Share', icon: Share2 },
        { id: 'history', label: 'History', icon: History },
        { id: 'compare', label: 'Compare', icon: Split },
        { id: 'translate', label: 'Translate', icon: Languages },
        { id: 'ai-explain', label: 'AI Explain', icon: Sparkles },
        { id: 'export', label: 'Export PDF', icon: Download },
        { id: 'copy', label: 'Copy Link', icon: Link2 },
      ];

  const handlers: Record<Exclude<ToolbarActionId, 'edit' | 'translate'>, () => void> = {
    share: onShare,
    history: onHistory,
    compare: onCompare,
    'ai-explain': onAiExplain,
    export: onExportPdf,
    copy: onCopyLink,
  };

  const actionDisabled = isSaving || isTranslating;

  return (
    <div
      className={cn(
        'sticky top-0 z-20 -mx-1 px-1 py-2 bg-[#FAFBFC]/95 backdrop-blur-sm border-b border-slate-200/80 print:hidden',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          if (action.id === 'edit') {
            if (!canEdit) return null;
            if (isEditing) {
              return (
                <Button
                  key="save"
                  type="button"
                  size="sm"
                  disabled={isSaving}
                  className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 bg-blue-600 text-white hover:bg-blue-700 border-0 shadow-sm"
                  onClick={onSave}
                >
                  <Save className="w-3.5 h-3.5" />
                  {isPortal ? 'Speichern' : 'Speichern / Save'}
                </Button>
              );
            }
            return (
              <Button
                key="edit"
                type="button"
                variant="outline"
                size="sm"
                disabled={actionDisabled}
                className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-none"
                onClick={onEdit}
              >
                <PenLine className="w-3.5 h-3.5 text-slate-500" />
                {action.label}
              </Button>
            );
          }

          if (action.id === 'translate') {
            return (
              <Popover key="translate" open={translateOpen} onOpenChange={setTranslateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={actionDisabled || isEditing}
                    className={cn(
                      'h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-none',
                      isTranslating && 'opacity-70',
                    )}
                  >
                    <Languages className="w-3.5 h-3.5 text-slate-500" />
                    {isTranslating ? 'Translating…' : 'Translate'}
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-48 p-2 rounded-xl">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-2 py-1">
                    Target locale
                  </p>
                  {KB_TRANSLATE_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={cn(
                        'w-full text-left rounded-lg px-2 py-1.5 text-xs hover:bg-slate-100 transition-colors',
                        activeLanguage === lang && 'bg-blue-50 text-blue-700 font-semibold',
                      )}
                      onClick={() => {
                        setTranslateOpen(false);
                        onTranslate(lang);
                      }}
                    >
                      {lang}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            );
          }

          const Icon = action.icon;
          return (
            <Button
              key={action.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={actionDisabled || (isEditing && action.id !== 'copy')}
              className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-none"
              onClick={handlers[action.id]}
            >
              <Icon className="w-3.5 h-3.5 text-slate-500" />
              {action.label}
            </Button>
          );
        })}

        {canEdit && !isOutdatedOrArchived && onMarkOutdated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionDisabled || isEditing}
            className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 shadow-none"
            onClick={onMarkOutdated}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Als veraltet markieren
          </Button>
        ) : null}
        {canEdit && !isOutdatedOrArchived && onMarkArchived ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionDisabled || isEditing}
            className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-none"
            onClick={onMarkArchived}
          >
            <Archive className="w-3.5 h-3.5 text-slate-500" />
            Archivieren
          </Button>
        ) : null}
        {canEdit && isOutdatedOrArchived && onRepublish ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actionDisabled || isEditing}
            className="h-8 rounded-xl text-[11px] font-semibold gap-1.5 border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 shadow-none"
            onClick={onRepublish}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Wieder veröffentlichen
          </Button>
        ) : null}
        {statusNorm === 'outdated' || statusNorm === 'archived' ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-200 rounded-lg px-2 py-1">
            {statusNorm === 'archived' ? 'Archiviert' : 'Veraltet'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
