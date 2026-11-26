import { PenLine, Sparkles, Settings, Check, FilePenLine, X, Plus } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { KBRichTextEditor } from './KBRichTextEditor';
import { UNCATEGORIZED_CATEGORY_ID, type KBCategoryRecord } from './kbCategoryUtils';

export type KBArticleDraftVisibility = 'internal' | 'shared_portal' | 'organization';

export interface KBArticleDraft {
  title: string;
  content: string;
  category: string;
  subCategory: string;
  visibility: KBArticleDraftVisibility | 'Public' | 'Private';
  organizationId?: string;
  tags: string[];
  owner: string;
  reviewer: string;
  lastEditor: string;
  status: string;
  avgReadTime: string;
  index_in_rag: boolean;
}

export type KBArticleSaveMode = 'draft' | 'publish';

interface EnterpriseUser {
  uid: string;
  name: string;
  role: string;
  email: string;
  avatar: string;
}

interface PortalOrganizationOption {
  id: string;
  name: string;
}

interface KBArticleEditorWorkspaceProps {
  editingArticleId: string | null;
  selectedCategory: string;
  newArticle: KBArticleDraft;
  onNewArticleChange: Dispatch<SetStateAction<KBArticleDraft>>;
  tagInput: string;
  onTagInputChange: (value: string) => void;
  categories: KBCategoryRecord[];
  enterpriseUsers: EnterpriseUser[];
  /** MSP organizations for „Nur für bestimmtes Unternehmen“. */
  portalOrganizations?: PortalOrganizationOption[];
  onClose: () => void;
  onSave: (mode: KBArticleSaveMode) => void;
  /** Instant-persist RAG opt-in for existing articles (fires on toggle change). */
  onToggleIndexInRag?: (checked: boolean) => void;
  className?: string;
  /** Kunden-Portal: force organization visibility; hide staff visibility/RAG controls. */
  lockPortalOrgVisibility?: boolean;
  showRagToggle?: boolean;
  /** staff | portal — controls owner/reviewer/subcategory/auto-assist chrome. */
  mode?: 'staff' | 'portal';
  /** Show AI Auto-Assist pill (staff only when AI online). */
  showAutoAssist?: boolean;
  /** Allow creating a category inline next to the Kategorie dropdown. */
  canCreateCategory?: boolean;
  onCreateCategory?: () => void;
}

function draftVisibility(
  raw: KBArticleDraft['visibility'],
): KBArticleDraftVisibility {
  const v = String(raw || '').toLowerCase();
  if (v === 'shared_portal' || v === 'public') return 'shared_portal';
  if (v === 'organization') return 'organization';
  return 'internal';
}

function stripHtmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function KBArticleEditorWorkspace({
  editingArticleId,
  selectedCategory,
  newArticle,
  onNewArticleChange,
  tagInput,
  onTagInputChange,
  categories,
  enterpriseUsers,
  portalOrganizations = [],
  onClose,
  onSave,
  onToggleIndexInRag,
  className,
  lockPortalOrgVisibility = false,
  showRagToggle = true,
  mode = 'staff',
  showAutoAssist = false,
  canCreateCategory = false,
  onCreateCategory,
}: KBArticleEditorWorkspaceProps) {
  const { t } = useTranslation();
  const [titleTouched, setTitleTouched] = useState(false);
  const [attemptedMode, setAttemptedMode] = useState<KBArticleSaveMode | null>(null);
  const isPortal = mode === 'portal';

  const titleValid = newArticle.title.trim().length > 0;
  const bodyValid = stripHtmlText(newArticle.content).length > 0;
  const showTitleError = (titleTouched || attemptedMode !== null) && !titleValid;
  const showBodyError = attemptedMode === 'publish' && !bodyValid;

  const patchArticle = (patch: Partial<KBArticleDraft>) => {
    onNewArticleChange((prev) => ({ ...prev, ...patch }));
  };

  const handleSaveClick = (modeSave: KBArticleSaveMode) => {
    setAttemptedMode(modeSave);
    setTitleTouched(true);
    if (!titleValid) return;
    if (modeSave === 'publish' && !bodyValid) return;
    onSave(modeSave);
  };

  const categoryValue =
    !newArticle.category || newArticle.category === 'All'
      ? UNCATEGORIZED_CATEGORY_ID
      : newArticle.category;

  return (
    <div className={cn('flex flex-col lg:flex-row flex-1 min-h-0 h-full bg-white', className)}>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="px-4 sm:px-6 py-4 border-b shrink-0 flex flex-row items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-800 tracking-tight flex items-center gap-2">
              <PenLine className="w-4 h-4 text-indigo-500 shrink-0" />
              {editingArticleId
                ? t('kb.editor.reviseTitle', 'Artikel bearbeiten')
                : t('kb.editor.createTitle', 'Neuer Artikel')}
            </h2>
            <p className="text-[11px] text-slate-400 font-semibold mt-0.5 truncate">
              {selectedCategory && selectedCategory !== 'All'
                ? selectedCategory
                : t('kb.editor.noCategory', 'Ohne Kategorie')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg border shrink-0"
            aria-label={t('kb.editor.closeDraft', 'Schließen')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0">
          <div className="space-y-1">
            <Label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
              {t('kb.editor.documentTitle', 'Titel')}
            </Label>
            <Input
              value={newArticle.title}
              onChange={(e) => patchArticle({ title: e.target.value })}
              onBlur={() => setTitleTouched(true)}
              aria-invalid={showTitleError}
              placeholder={t(
                'kb.editor.titlePlaceholder',
                'z. B. Anmeldung an PrüfApp PRO nicht möglich',
              )}
              className={cn(
                'h-11 text-md font-bold rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 placeholder:text-slate-300',
                showTitleError && 'border-rose-400 focus:ring-rose-100',
              )}
            />
            {showTitleError ? (
              <p className="text-[11px] font-semibold text-rose-600" role="alert">
                {t('kb.editor.titleRequired', 'Bitte einen Titel eingeben.')}
              </p>
            ) : null}
          </div>

          <div className={cn('grid gap-4', isPortal ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2')}>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <Label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                  {t('kb.editor.categoryDestination', 'Kategorie')}
                </Label>
                {canCreateCategory && onCreateCategory ? (
                  <button
                    type="button"
                    onClick={onCreateCategory}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('kb.editor.newCategoryInline', '+ Neue Kategorie')}
                  </button>
                ) : null}
              </div>
              <select
                value={categoryValue}
                onChange={(e) => patchArticle({ category: e.target.value })}
                className="w-full h-11 border border-slate-200 rounded-xl px-3 text-xs bg-slate-50 font-bold cursor-pointer"
              >
                <option value={UNCATEGORIZED_CATEGORY_ID}>
                  {t('kb.editor.noCategory', 'Ohne Kategorie')}
                </option>
                {categories
                  .filter((cat) => cat.id !== UNCATEGORIZED_CATEGORY_ID)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
              </select>
            </div>

            {!isPortal ? (
              <div>
                <Label className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                  {t('kb.editor.subcategory', 'Unterkategorie')}
                </Label>
                <Input
                  value={newArticle.subCategory}
                  onChange={(e) => patchArticle({ subCategory: e.target.value })}
                  placeholder={t('kb.editor.subcategoryPlaceholder', 'optional')}
                  className="h-11 text-xs font-bold rounded-xl border-slate-200 bg-slate-50"
                />
              </div>
            ) : null}
          </div>

          <div className="flex-1 flex flex-col space-y-2 min-h-[250px]">
            <div className="flex justify-between items-center text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              <span>{t('kb.editor.bodyLabel', 'Inhalt')}</span>
              {!isPortal && showAutoAssist ? (
                <span className="flex items-center gap-1 text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md font-black">
                  <Sparkles className="w-3 h-3" />
                  {t('kb.editor.autoAssist', 'Auto-Assist aktiviert')}
                </span>
              ) : null}
            </div>

            <KBRichTextEditor
              value={newArticle.content}
              onChange={(content) => patchArticle({ content })}
              placeholder={t('kb.editor.placeholder', 'Tippe / für Blöcke oder beginne zu schreiben…')}
              className={cn(
                'flex-1 min-h-[280px]',
                showBodyError && 'ring-2 ring-rose-300 border-rose-300 rounded-xl',
              )}
            />
            {showBodyError ? (
              <p className="text-[11px] font-semibold text-rose-600" role="alert">
                {t(
                  'kb.editor.bodyRequiredToPublish',
                  'Fügen Sie Inhalt hinzu, bevor Sie veröffentlichen. Speichern als Entwurf ist trotzdem möglich.',
                )}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="px-4 sm:px-6 py-4 border-t bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <Button
            variant="ghost"
            className="rounded-xl px-4 text-xs font-extrabold text-slate-400 hover:text-slate-600"
            onClick={onClose}
          >
            {t('kb.editor.closeDraft', 'Abbrechen')}
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl px-4 h-10 text-xs font-extrabold border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
              onClick={() => handleSaveClick('draft')}
            >
              <FilePenLine className="w-4 h-4" />
              <span>{t('kb.editor.saveDraft', 'Entwurf speichern')}</span>
            </Button>
            <Button
              type="button"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold px-6 h-10 rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
              onClick={() => handleSaveClick('publish')}
            >
              <Check className="w-4 h-4" />
              <span>{t('kb.editor.publishLive', 'Veröffentlichen')}</span>
            </Button>
          </div>
        </footer>
      </div>

      <aside className="w-full lg:w-[320px] bg-slate-50/70 border-t lg:border-t-0 lg:border-l border-slate-150 p-4 sm:p-6 flex flex-col gap-5 shrink-0 overflow-y-auto min-h-0">
        <div className="flex items-center gap-2 pb-4 border-b">
          <Settings className="w-4 h-4 text-indigo-500" />
          <h4 className="text-xs font-black uppercase text-slate-800">
            {t('kb.editor.publishingParams', 'Einstellungen')}
          </h4>
        </div>

        <div className="space-y-2">
          <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
            {t('kb.editor.accessScope', 'Sichtbarkeit')}
          </Label>
          <div className="p-3 bg-white border rounded-xl shadow-3xs space-y-2">
            {lockPortalOrgVisibility ? (
              <p className="text-[11px] text-slate-600 font-semibold leading-relaxed">
                {t(
                  'kb.editor.portalOrgLocked',
                  'Artikel werden automatisch als Firmen-Anleitung für Ihre Organisation veröffentlicht.',
                )}
              </p>
            ) : (
              <>
                <select
                  className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-800"
                  value={draftVisibility(newArticle.visibility)}
                  onChange={(e) => {
                    const next = e.target.value as KBArticleDraftVisibility;
                    patchArticle({
                      visibility: next,
                      organizationId:
                        next === 'organization' ? newArticle.organizationId || '' : '',
                    });
                  }}
                  aria-label={t('kb.editor.visibilitySelect', 'Sichtbarkeit')}
                >
                  <option value="internal">
                    {t('kb.editor.visibilityInternal', 'Nur intern (Hubcom)')}
                  </option>
                  <option value="shared_portal">
                    {t('kb.editor.visibilityShared', 'Für alle Kunden-Portale')}
                  </option>
                  <option value="organization">
                    {t('kb.editor.visibilityOrg', 'Nur für bestimmtes Unternehmen')}
                  </option>
                </select>
                {draftVisibility(newArticle.visibility) === 'organization' ? (
                  <select
                    className="w-full h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-800"
                    value={newArticle.organizationId || ''}
                    onChange={(e) => patchArticle({ organizationId: e.target.value })}
                    aria-label={t('kb.editor.orgPicker', 'Unternehmen')}
                  >
                    <option value="">
                      {t('kb.editor.orgPickerPlaceholder', 'Unternehmen wählen…')}
                    </option>
                    {portalOrganizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[10px] text-slate-400 font-semibold">
                    {draftVisibility(newArticle.visibility) === 'shared_portal'
                      ? t(
                          'kb.editor.sharedHint',
                          'Sichtbar in jedem Kunden-Portal (z. B. VPN-/Outlook-Anleitungen).',
                        )
                      : t(
                          'kb.editor.internalHint',
                          'Nur Hubcom-Mitarbeitende sehen diesen Artikel — nie im Kunden-Portal.',
                        )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {showRagToggle ? (
          <div className="space-y-2">
            <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
              {t('kb.editor.ragAccess', 'KI-Wissensspeicher (RAG)')}
            </Label>
            <div className="flex items-center justify-between p-3 bg-white border rounded-xl shadow-3xs">
              <div className="flex flex-col">
                <span className="text-xs font-black text-slate-800">
                  {t('kb.editor.includeInRag', 'In KI-Wissensspeicher (RAG) aufnehmen')}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold mt-0.5">
                  {t(
                    'kb.editor.includeInRagHint',
                    'Wenn deaktiviert, ist der Artikel öffentlich lesbar, wird aber nicht vom KI-Copilot zitiert.',
                  )}
                </span>
              </div>
              <Switch
                checked={newArticle.index_in_rag === true || (!isPortal && newArticle.index_in_rag !== false)}
                onCheckedChange={(checked) => {
                  const value = Boolean(checked);
                  patchArticle({ index_in_rag: value });
                  onToggleIndexInRag?.(value);
                }}
              />
            </div>
          </div>
        ) : null}

        {!isPortal ? (
          <>
            <div className="space-y-2">
              <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
                {t('kb.editor.documentOwner', 'Autor')}
              </Label>
              <select
                value={newArticle.owner}
                onChange={(e) => patchArticle({ owner: e.target.value })}
                className="w-full h-10 bg-white border rounded-xl px-2.5 text-xs font-bold"
              >
                {enterpriseUsers.length === 0 ? (
                  <option value={newArticle.owner || ''}>
                    {newArticle.owner || t('kb.editor.currentUser', 'Aktueller Benutzer')}
                  </option>
                ) : null}
                {enterpriseUsers.map((user) => (
                  <option key={user.uid} value={user.name}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
                {t('kb.editor.auditor', 'Prüfer (optional)')}
              </Label>
              <select
                value={newArticle.reviewer}
                onChange={(e) => patchArticle({ reviewer: e.target.value })}
                className="w-full h-10 bg-white border rounded-xl px-2.5 text-xs font-bold"
              >
                <option value="">{t('kb.editor.noReviewer', 'Kein Prüfer')}</option>
                {enterpriseUsers.map((user) => (
                  <option key={user.uid} value={user.name}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
            {t('kb.editor.workflowStatus', 'Status')}
          </Label>
          <select
            value={newArticle.status === 'Draft' ? 'Draft' : 'Published'}
            onChange={(e) => patchArticle({ status: e.target.value })}
            className="w-full h-10 bg-white border rounded-xl px-2.5 text-xs font-bold"
          >
            <option value="Published">{t('kb.status.published', 'Veröffentlicht')}</option>
            <option value="Draft">{t('kb.status.draft', 'Entwurf')}</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label className="text-[9.5px] uppercase font-black text-slate-400 tracking-wider">
            {t('kb.editor.tagsLabel', 'Tags')}
          </Label>
          <Input
            value={tagInput}
            onChange={(e) => onTagInputChange(e.target.value)}
            placeholder={t('kb.editor.tagsPlaceholder', 'z. B. prüfapp, anmeldung, hardware')}
            className="h-10 bg-white border text-xs font-bold rounded-xl"
          />
          <div className="flex flex-wrap gap-1 mt-1.5">
            {tagInput
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
              .map((tag, idx) => (
                <Badge
                  key={idx}
                  className="bg-slate-200 text-slate-600 font-extrabold uppercase text-[7.5px] py-0 px-1 border-none rounded-md"
                >
                  #{tag}
                </Badge>
              ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
