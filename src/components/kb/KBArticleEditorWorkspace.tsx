import {
  BookOpen,
  Building2,
  Check,
  ChevronLeft,
  FilePenLine,
  Globe2,
  Lock,
  ListOrdered,
  MessageCircleQuestion,
  Plus,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
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

const CARD_CLASS =
  'rounded-xl border border-slate-200/80 bg-white shadow-sm p-5 sm:p-6 space-y-5';

const FIELD_LABEL =
  'text-[11px] font-bold text-slate-500 uppercase tracking-wide';

const STARTER_TEMPLATES = [
  {
    id: 'sop',
    label: 'Problemlösung (SOP)',
    icon: Wrench,
    tint: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/80',
    iconTint: 'bg-rose-100 text-rose-600',
    html: [
      '<h2>Problembeschreibung</h2><p></p>',
      '<h2>Ursache</h2><p></p>',
      '<h2>Lösungsweg</h2><p></p>',
      '<h2>Verifizierung</h2><p></p>',
    ].join(''),
  },
  {
    id: 'howto',
    label: 'Schritt-für-Schritt-Anleitung',
    icon: ListOrdered,
    tint: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100/80',
    iconTint: 'bg-sky-100 text-sky-600',
    html: [
      '<h2>Voraussetzungen</h2><p></p>',
      '<h2>Schritt 1</h2><p></p>',
      '<h2>Schritt 2</h2><p></p>',
      '<h2>Schritt 3</h2><p></p>',
      '<h2>Hinweise</h2><p></p>',
    ].join(''),
  },
  {
    id: 'faq',
    label: 'FAQ / Kurzantwort',
    icon: MessageCircleQuestion,
    tint: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100/80',
    iconTint: 'bg-violet-100 text-violet-600',
    html: [
      '<h2>Frage</h2><p></p>',
      '<h2>Kurzantwort</h2><p></p>',
      '<h2>Details</h2><p></p>',
    ].join(''),
  },
] as const;

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

function parseTagChips(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
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
  const [tagDraft, setTagDraft] = useState('');
  const isPortal = mode === 'portal';

  const titleValid = newArticle.title.trim().length > 0;
  const bodyValid = stripHtmlText(newArticle.content).length > 0;
  const showTitleError = (titleTouched || attemptedMode !== null) && !titleValid;
  const showBodyError = attemptedMode === 'publish' && !bodyValid;
  const bodyEmpty = !bodyValid;
  const visibility = draftVisibility(newArticle.visibility);
  const tagChips = useMemo(() => parseTagChips(tagInput), [tagInput]);

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

  const applyTemplate = (html: string) => {
    if (!bodyEmpty) return;
    patchArticle({ content: html });
  };

  const addTagChip = (raw: string) => {
    const next = raw.trim().replace(/^#/, '');
    if (!next) return;
    const existing = parseTagChips(tagInput);
    if (existing.some((t) => t.toLowerCase() === next.toLowerCase())) {
      setTagDraft('');
      return;
    }
    onTagInputChange([...existing, next].join(', '));
    setTagDraft('');
  };

  const removeTagChip = (tag: string) => {
    onTagInputChange(
      parseTagChips(tagInput)
        .filter((t) => t !== tag)
        .join(', '),
    );
  };

  const categoryValue =
    !newArticle.category || newArticle.category === 'All'
      ? UNCATEGORIZED_CATEGORY_ID
      : newArticle.category;

  const visibilityOptions = [
    {
      id: 'internal' as const,
      title: t('kb.editor.visibilityInternal', 'Intern (Nur Hubcom)'),
      hint: t(
        'kb.editor.internalHint',
        'Nur Hubcom-Mitarbeitende sehen diesen Artikel — nie im Kunden-Portal.',
      ),
      icon: Lock,
      active: 'border-slate-400 bg-slate-50 ring-2 ring-slate-300/70',
      iconWrap: 'bg-slate-200 text-slate-700',
    },
    {
      id: 'organization' as const,
      title: t('kb.editor.visibilityOrg', 'Kundenspezifisch (Mandant)'),
      hint: t(
        'kb.editor.orgHint',
        'Artikel wird auf das gewählte Kunden-Portal beschränkt.',
      ),
      icon: Building2,
      active: 'border-sky-400 bg-sky-50 ring-2 ring-sky-200',
      iconWrap: 'bg-sky-100 text-sky-700',
    },
    {
      id: 'shared_portal' as const,
      title: t('kb.editor.visibilityShared', 'Global (Alle Kunden-Portale)'),
      hint: t(
        'kb.editor.sharedHint',
        'Sichtbar in jedem Kunden-Portal (z. B. VPN-/Outlook-Anleitungen).',
      ),
      icon: Globe2,
      active: 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200',
      iconWrap: 'bg-emerald-100 text-emerald-700',
    },
  ];

  return (
    <div className={cn('flex flex-col flex-1 min-h-0 h-full bg-[#f6f8fb]', className)}>
      <header className="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 bg-white/95 backdrop-blur shrink-0">
        <div className="max-w-4xl mx-auto w-full flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 hover:text-slate-900 shrink-0"
            aria-label={t('kb.editor.backToOverview', 'Zurück zur Wissensdatenbank')}
          >
            <ChevronLeft className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">
              {t('kb.editor.backToOverview', 'Zurück zur Wissensdatenbank')}
            </span>
          </button>
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 shadow-sm">
            <BookOpen className="w-5 h-5 text-blue-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
              {editingArticleId
                ? t('kb.editor.reviseTitle', 'Artikel bearbeiten')
                : t('kb.editor.createTitle', 'Neuer Artikel')}
            </h2>
            <p className="text-[11px] text-slate-500 font-semibold mt-0.5 truncate">
              {selectedCategory && selectedCategory !== 'All'
                ? selectedCategory
                : t('kb.editor.noCategory', 'Ohne Kategorie')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-5 sm:py-6 space-y-5">
          {/* Card 1 — Titel & Einordnung */}
          <section className={CARD_CLASS} aria-labelledby="kb-editor-card-title">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                <BookOpen className="w-4 h-4 text-blue-600" aria-hidden />
              </div>
              <h3 id="kb-editor-card-title" className="text-[15px] font-bold text-slate-800">
                {t('kb.editor.cardTitlePlacement', 'Titel & Einordnung')}
              </h3>
            </div>

            <div className="space-y-2">
              <Label className={FIELD_LABEL}>
                {t('kb.editor.documentTitle', 'Titel')}{' '}
                <span className="text-rose-600" aria-hidden>
                  *
                </span>
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
                  'h-11 text-sm font-semibold rounded-xl border-slate-200 bg-white focus:ring-2 focus:ring-blue-100 placeholder:text-slate-300',
                  showTitleError && 'border-rose-400 focus:ring-rose-100',
                )}
              />
              {showTitleError ? (
                <p className="text-[11px] font-semibold text-rose-600" role="alert">
                  {t('kb.editor.titleRequired', 'Bitte einen Titel eingeben.')}
                </p>
              ) : null}
            </div>

            <div className={cn('grid gap-4', isPortal ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className={FIELD_LABEL}>
                    {t('kb.editor.categoryDestination', 'Kategorie')}
                  </Label>
                  {canCreateCategory && onCreateCategory ? (
                    <button
                      type="button"
                      onClick={onCreateCategory}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t('kb.editor.newCategoryInline', '+ Neue Kategorie')}
                    </button>
                  ) : null}
                </div>
                <select
                  value={categoryValue}
                  onChange={(e) => patchArticle({ category: e.target.value })}
                  className="w-full h-11 border border-slate-200 rounded-xl px-3 text-xs bg-white font-bold cursor-pointer"
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
                <div className="space-y-2">
                  <Label className={FIELD_LABEL}>
                    {t('kb.editor.subcategory', 'Unterkategorie')}
                  </Label>
                  <Input
                    value={newArticle.subCategory}
                    onChange={(e) => patchArticle({ subCategory: e.target.value })}
                    placeholder={t('kb.editor.subcategoryPlaceholder', 'optional')}
                    className="h-11 text-xs font-bold rounded-xl border-slate-200 bg-white"
                  />
                </div>
              ) : null}
            </div>
          </section>

          {/* Card 2 — Inhalt & Schlagwörter */}
          <section className={CARD_CLASS} aria-labelledby="kb-editor-card-content">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
                  <FilePenLine className="w-4 h-4 text-violet-600" aria-hidden />
                </div>
                <h3 id="kb-editor-card-content" className="text-[15px] font-bold text-slate-800 truncate">
                  {t('kb.editor.cardContentTags', 'Inhalt & Schlagwörter')}
                </h3>
              </div>
              {!isPortal && showAutoAssist ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md shrink-0">
                  <Sparkles className="w-3 h-3" aria-hidden />
                  {t('kb.editor.autoAssist', 'Auto-Assist')}
                </span>
              ) : null}
            </div>

            {bodyEmpty ? (
              <div className="space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                  {t('kb.editor.quickStartTemplates', 'Schnellstart-Vorlagen')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTER_TEMPLATES.map((tpl) => {
                    const Icon = tpl.icon;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => applyTemplate(tpl.html)}
                        className={cn(
                          'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                          tpl.tint,
                        )}
                      >
                        <span
                          className={cn(
                            'inline-flex h-5 w-5 items-center justify-center rounded-full',
                            tpl.iconTint,
                          )}
                        >
                          <Icon className="w-3 h-3" aria-hidden />
                        </span>
                        {t(`kb.editor.template.${tpl.id}`, tpl.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <KBRichTextEditor
                value={newArticle.content}
                onChange={(content) => patchArticle({ content })}
                placeholder={t(
                  'kb.editor.placeholder',
                  'Tippe / für Blöcke oder beginne zu schreiben…',
                )}
                className={cn(
                  'min-h-[280px]',
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

            <div className="space-y-2">
              <Label className={FIELD_LABEL}>{t('kb.editor.tagsLabel', 'Tags')}</Label>
              <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 min-h-[44px] flex flex-wrap gap-1.5 items-center">
                {tagChips.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[11px] font-semibold border border-slate-200"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => removeTagChip(tag)}
                      aria-label={t('kb.editor.removeTag', 'Tag entfernen') + `: ${tag}`}
                      className="hover:text-rose-600"
                    >
                      <X className="w-3 h-3" aria-hidden />
                    </button>
                  </span>
                ))}
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTagChip(tagDraft);
                    }
                  }}
                  onBlur={() => {
                    if (tagDraft.trim()) addTagChip(tagDraft);
                  }}
                  placeholder={t('kb.editor.tagsPlaceholder', 'z. B. prüfapp, anmeldung')}
                  className="h-7 min-w-[8rem] flex-1 border-0 shadow-none focus-visible:ring-0 px-1 text-xs bg-transparent"
                />
              </div>
            </div>
          </section>

          {/* Card 3 — Sichtbarkeit, KI & Freigabe */}
          <section className={CARD_CLASS} aria-labelledby="kb-editor-card-visibility">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                <Globe2 className="w-4 h-4 text-emerald-600" aria-hidden />
              </div>
              <h3 id="kb-editor-card-visibility" className="text-[15px] font-bold text-slate-800">
                {t('kb.editor.cardVisibilityAi', 'Sichtbarkeit, KI & Freigabe')}
              </h3>
            </div>

            <div className="space-y-3">
              <Label className={FIELD_LABEL}>
                {t('kb.editor.accessScope', 'Sichtbarkeit')}
              </Label>
              {lockPortalOrgVisibility ? (
                <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-[12px] font-semibold text-sky-900 leading-relaxed">
                  {t(
                    'kb.editor.portalOrgLocked',
                    'Artikel werden automatisch als Firmen-Anleitung für Ihre Organisation veröffentlicht.',
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {visibilityOptions.map((opt) => {
                      const Icon = opt.icon;
                      const active = visibility === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            patchArticle({
                              visibility: opt.id,
                              organizationId:
                                opt.id === 'organization'
                                  ? newArticle.organizationId || ''
                                  : '',
                            })
                          }
                          className={cn(
                            'text-left rounded-xl border p-3.5 transition-all',
                            active
                              ? opt.active
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
                          )}
                          aria-pressed={active}
                        >
                          <div
                            className={cn(
                              'mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-lg',
                              active ? opt.iconWrap : 'bg-slate-100 text-slate-500',
                            )}
                          >
                            <Icon className="w-4 h-4" aria-hidden />
                          </div>
                          <p className="text-[13px] font-bold text-slate-900 leading-snug">
                            {opt.title}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-slate-500 leading-relaxed">
                            {opt.hint}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                  {visibility === 'organization' ? (
                    <div className="space-y-2 max-w-md">
                      <Label className={FIELD_LABEL}>
                        {t('kb.editor.orgPicker', 'Unternehmen / Mandant')}
                      </Label>
                      <select
                        className="w-full h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800"
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
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {showRagToggle ? (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3.5">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 shrink-0">
                    <Sparkles className="w-4 h-4" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900">
                      {t('kb.editor.includeInRag', 'In KI-Wissensspeicher (RAG) aufnehmen')}
                    </p>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5 leading-relaxed">
                      {t(
                        'kb.editor.includeInRagHint',
                        'Wenn deaktiviert, ist der Artikel lesbar, wird aber nicht vom KI-Copilot zitiert.',
                      )}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={
                    newArticle.index_in_rag === true ||
                    (!isPortal && newArticle.index_in_rag !== false)
                  }
                  onCheckedChange={(checked) => {
                    const value = Boolean(checked);
                    patchArticle({ index_in_rag: value });
                    onToggleIndexInRag?.(value);
                  }}
                />
              </div>
            ) : null}

            {!isPortal ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className={FIELD_LABEL}>
                    {t('kb.editor.documentOwner', 'Autor')}
                  </Label>
                  <select
                    value={newArticle.owner}
                    onChange={(e) => patchArticle({ owner: e.target.value })}
                    className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold"
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
                  <Label className={FIELD_LABEL}>
                    {t('kb.editor.auditor', 'Prüfer (optional)')}
                  </Label>
                  <select
                    value={newArticle.reviewer}
                    onChange={(e) => patchArticle({ reviewer: e.target.value })}
                    className="w-full h-11 bg-white border border-slate-200 rounded-xl px-3 text-xs font-bold"
                  >
                    <option value="">{t('kb.editor.noReviewer', 'Kein Prüfer')}</option>
                    {enterpriseUsers.map((user) => (
                      <option key={user.uid} value={user.name}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </section>

          {/* Bottom action bar */}
          <div className="rounded-xl border border-slate-200/80 bg-white shadow-sm px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <Button
              variant="ghost"
              className="rounded-lg px-4 h-10 text-[13px] font-semibold text-slate-500 hover:text-slate-800 justify-start sm:justify-center"
              onClick={onClose}
            >
              {t('kb.editor.closeDraft', 'Abbrechen')}
            </Button>

            <div className="flex flex-wrap items-center gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg px-4 h-10 text-[13px] font-semibold border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => handleSaveClick('draft')}
              >
                <FilePenLine className="w-4 h-4" />
                <span>{t('kb.editor.saveDraft', 'Entwurf speichern')}</span>
              </Button>
              <Button
                type="button"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 h-10 rounded-lg text-[13px] flex items-center gap-1.5 shadow-sm"
                onClick={() => handleSaveClick('publish')}
              >
                <Check className="w-4 h-4" />
                <span>{t('kb.editor.publishLive', 'Veröffentlichen')}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
