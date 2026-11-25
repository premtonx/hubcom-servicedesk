/**
 * 2-step CSV / SharePoint Wissensdatenbank import modal (staff + portal).
 * Parsing is client-side (shared pure lib); persistence goes through the adapter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  FileSpreadsheet,
  Link2,
  Loader2,
  Paperclip,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../lib/context/I18nContext';
import {
  buildSharePointPreviewArticles,
  normalizeArticleTitleKey,
  type SharePointPreviewArticle,
} from '../../lib/kb/sharepoint-csv-import';
import type { KbWorkbenchAdapter, KbWorkbenchMode } from '../../lib/kb/kb-workbench-adapter';
import type { KBCategoryRecord } from './kbCategoryUtils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Checkbox } from '../ui/checkbox';

type OrgOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: KbWorkbenchMode;
  adapter: KbWorkbenchAdapter;
  categories: KBCategoryRecord[];
  organizations?: OrgOption[];
  /** Existing article titles in the target tenant — used for Duplikat badges. */
  existingTitles?: string[];
  onImported?: () => void;
};

export function KBSharePointCsvImportModal({
  open,
  onOpenChange,
  mode,
  adapter,
  categories,
  organizations = [],
  existingTitles = [],
  onImported,
}: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [visibility, setVisibility] = useState<'organization' | 'internal' | 'public'>(
    'organization',
  );
  const [category, setCategory] = useState('uncategorized');
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [previews, setPreviews] = useState<SharePointPreviewArticle[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inspectKey, setInspectKey] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setFileName('');
    setCsvText('');
    setPreviews([]);
    setSelected(new Set());
    setInspectKey(null);
    setImporting(false);
    setDragOver(false);
    setCategory('uncategorized');
    setPublishImmediately(true);
    setVisibility('organization');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (mode === 'staff' && organizations.length && !organizationId) {
      const dpg = organizations.find((o) => /dpg/i.test(o.name));
      setOrganizationId(dpg?.id || organizations[0].id);
    }
  }, [open, mode, organizations, organizationId, reset]);

  const inspected = useMemo(
    () => previews.find((p) => p.key === inspectKey) || null,
    [previews, inspectKey],
  );

  const existingTitleKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const title of existingTitles) {
      const key = normalizeArticleTitleKey(title);
      if (key) keys.add(key);
    }
    return keys;
  }, [existingTitles]);

  const isDuplicateTitle = useCallback(
    (title: string) => existingTitleKeys.has(normalizeArticleTitleKey(title)),
    [existingTitleKeys],
  );

  const selectedCount = selected.size;

  const applyFileText = (name: string, text: string) => {
    const articles = buildSharePointPreviewArticles(text);
    if (!articles.length) {
      toast.error(t('kb.csvImport.emptyCsv', 'Keine gültigen SharePoint-Zeilen gefunden.'));
      return;
    }
    setFileName(name);
    setCsvText(text);
    setPreviews(articles);
    const next = new Set<string>();
    for (const row of articles) {
      if (row.isLikelyTest) continue;
      if (existingTitleKeys.has(normalizeArticleTitleKey(row.title))) continue;
      next.add(row.key);
    }
    setSelected(next);
    setStep(2);
  };

  const readFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && file.type && !file.type.includes('csv')) {
      toast.error(t('kb.csvImport.needCsv', 'Bitte eine .csv-Datei auswählen.'));
      return;
    }
    const text = await file.text();
    applyFileText(file.name, text);
  };

  const toggleOne = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(previews.map((p) => p.key)));
  };

  const updateTitle = (key: string, title: string) => {
    setPreviews((prev) => prev.map((p) => (p.key === key ? { ...p, title } : p)));
  };

  const handleImport = async () => {
    if (!adapter.importCsvArticles) {
      toast.error(t('kb.csvImport.unavailable', 'Import ist nicht verfügbar.'));
      return;
    }
    if (mode === 'staff' && !organizationId) {
      toast.error(t('kb.csvImport.needOrg', 'Bitte ein Unternehmen auswählen.'));
      return;
    }
    const articles = previews
      .filter((p) => selected.has(p.key))
      .map((p) => ({
        title: p.title.trim(),
        content: p.content,
        sharePointId: p.sharePointId || undefined,
        matchcode: p.matchcode || undefined,
        hasAttachments: p.hasAttachments,
        category,
      }))
      .filter((a) => a.title && a.content);
    if (!articles.length) {
      toast.error(t('kb.csvImport.noneSelected', 'Bitte mindestens einen Artikel auswählen.'));
      return;
    }

    setImporting(true);
    try {
      const result = await adapter.importCsvArticles({
        organizationId: mode === 'staff' ? organizationId : undefined,
        visibility: mode === 'staff' ? visibility : 'organization',
        category,
        publishImmediately,
        articles,
      });
      const summary =
        result.summary ||
        `${result.imported} Artikel importiert, ${result.skipped} übersprungen`;
      toast.success(summary);
      onImported?.();
      onOpenChange(false);
      reset();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'CSV-Import fehlgeschlagen');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
          <DialogTitle>
            {t('kb.csvImport.title', 'CSV / SharePoint importieren')}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? t(
                  'kb.csvImport.step1Desc',
                  'SharePoint-Export (Ticketsystem_…_Wissensdatenbank.csv) hochladen und Optionen wählen.',
                )
              : t(
                  'kb.csvImport.step2Desc',
                  'Vorschau prüfen, Testzeilen abwählen und ausgewählte Artikel importieren.',
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {step === 1 ? (
            <>
              {mode === 'staff' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {t('kb.csvImport.organization', 'Unternehmen')}
                    </Label>
                    <select
                      value={organizationId}
                      onChange={(e) => setOrganizationId(e.target.value)}
                      className="w-full h-10 border border-slate-200 rounded-xl bg-white px-3 text-sm font-medium"
                    >
                      <option value="">
                        {t('kb.csvImport.selectOrg', 'Unternehmen wählen…')}
                      </option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {t('kb.csvImport.visibility', 'Sichtbarkeit')}
                    </Label>
                    <select
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(e.target.value as 'organization' | 'internal' | 'public')
                      }
                      className="w-full h-10 border border-slate-200 rounded-xl bg-white px-3 text-sm font-medium"
                    >
                      <option value="organization">
                        {t('kb.visibilityOrgShort', 'Nur diese Organisation')}
                      </option>
                      <option value="internal">
                        {t('kb.visibilityInternal', 'Nur intern (Hubcom)')}
                      </option>
                      <option value="public">
                        {t('kb.visibilityShared', 'Für alle Kunden-Portale')}
                      </option>
                    </select>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    {t('kb.csvImport.defaultCategory', 'Standard-Kategorie')}
                  </Label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 border border-slate-200 rounded-xl bg-white px-3 text-sm font-medium"
                  >
                    <option value="uncategorized">
                      {t('kb.editor.noCategory', 'Ohne Kategorie')}
                    </option>
                    {categories
                      .filter((c) => c.id !== 'uncategorized')
                      .map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <div className="flex items-center justify-between w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/60">
                    <Label className="text-sm font-medium text-slate-700">
                      {t('kb.csvImport.publishImmediately', 'Sofort veröffentlichen')}
                    </Label>
                    <Switch
                      checked={publishImmediately}
                      onCheckedChange={setPublishImmediately}
                    />
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  'rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors cursor-pointer',
                  dragOver
                    ? 'border-blue-400 bg-blue-50/50'
                    : 'border-slate-200 bg-slate-50/40 hover:border-slate-300 hover:bg-white',
                )}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void readFile(file);
                }}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm text-blue-600">
                  <Upload className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-800">
                  {t('kb.csvImport.dropHint', 'CSV hier ablegen oder klicken zum Auswählen')}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {t(
                    'kb.csvImport.dropSub',
                    'SharePoint-Export mit Spalten ID, Matchcode, Problem, Loesungsweg, …',
                  )}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readFile(file);
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <FileSpreadsheet className="h-4 w-4 text-slate-400" />
                  <span className="font-medium text-slate-800">{fileName || 'import.csv'}</span>
                  <span className="text-slate-400">·</span>
                  <span>
                    {previews.length}{' '}
                    {t('kb.csvImport.rows', 'Zeilen')} · {selectedCount}{' '}
                    {t('kb.csvImport.selected', 'ausgewählt')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => toggleAll(true)}
                  >
                    <CheckSquare className="h-3.5 w-3.5 mr-1" />
                    {t('kb.csvImport.selectAll', 'Alle')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => toggleAll(false)}
                  >
                    <Square className="h-3.5 w-3.5 mr-1" />
                    {t('kb.csvImport.selectNone', 'Keine')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setStep(1);
                      setPreviews([]);
                      setSelected(new Set());
                      setCsvText('');
                      setFileName('');
                    }}
                  >
                    {t('kb.csvImport.back', 'Andere Datei')}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[320px]">
                <div className="lg:col-span-3 rounded-xl border border-slate-200 overflow-hidden bg-white">
                  <ScrollArea className="h-[360px]">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="w-10 px-3 py-2">
                            <Checkbox
                              checked={selectedCount > 0 && selectedCount === previews.length}
                              onCheckedChange={(v) => toggleAll(v === true)}
                            />
                          </th>
                          <th className="px-2 py-2 font-bold">SP-ID</th>
                          <th className="px-2 py-2 font-bold">
                            {t('kb.csvImport.colTitle', 'Titel')}
                          </th>
                          <th className="px-2 py-2 font-bold hidden md:table-cell">
                            {t('kb.csvImport.colPreview', 'Inhalt-Vorschau')}
                          </th>
                          <th className="px-2 py-2 font-bold">
                            {t('kb.csvImport.colBadges', 'Hinweise')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {previews.map((row) => {
                          const isOn = selected.has(row.key);
                          return (
                            <tr
                              key={row.key}
                              className={cn(
                                'border-b border-slate-100 cursor-pointer hover:bg-slate-50/80',
                                inspectKey === row.key && 'bg-blue-50/60',
                                row.isLikelyTest && !isOn && 'opacity-60',
                              )}
                              onClick={() => setInspectKey(row.key)}
                            >
                              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isOn}
                                  onCheckedChange={() => toggleOne(row.key)}
                                />
                              </td>
                              <td className="px-2 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">
                                {row.sharePointId || '—'}
                              </td>
                              <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  value={row.title}
                                  onChange={(e) => updateTitle(row.key, e.target.value)}
                                  className="w-full min-w-[140px] bg-transparent border-0 border-b border-transparent focus:border-blue-300 outline-none text-sm font-medium text-slate-800"
                                />
                              </td>
                              <td className="px-2 py-2.5 text-xs text-slate-500 hidden md:table-cell max-w-[220px]">
                                <span className="line-clamp-2">{row.contentPreview}</span>
                              </td>
                              <td className="px-2 py-2.5">
                                <div className="flex flex-wrap gap-1">
                                  {row.hasLink ? (
                                    <Badge
                                      variant="secondary"
                                      className="text-[9px] font-bold uppercase tracking-wide gap-0.5"
                                    >
                                      <Link2 className="h-2.5 w-2.5" />
                                      Link
                                    </Badge>
                                  ) : null}
                                  {row.hasAttachments ? (
                                    <Badge className="bg-amber-100 text-amber-800 border-none text-[9px] font-bold uppercase tracking-wide gap-0.5">
                                      <Paperclip className="h-2.5 w-2.5" />
                                      {t(
                                        'kb.csvImport.attachmentBadge',
                                        'Anlage manuell nachziehen',
                                      )}
                                    </Badge>
                                  ) : null}
                                  {row.isLikelyTest ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] font-bold uppercase tracking-wide text-slate-500"
                                    >
                                      Test
                                    </Badge>
                                  ) : null}
                                  {isDuplicateTitle(row.title) ? (
                                    <Badge className="bg-rose-100 text-rose-700 border-none text-[9px] font-bold uppercase tracking-wide">
                                      Duplikat
                                    </Badge>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>

                <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4 flex flex-col min-h-[360px]">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t('kb.csvImport.markdownPreview', 'Markdown-Vorschau')}
                    </h3>
                    {inspected ? (
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-600"
                        onClick={() => setInspectKey(null)}
                        aria-label="Close"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  {inspected ? (
                    <ScrollArea className="flex-1">
                      <div className="space-y-2 pr-2">
                        <p className="text-sm font-semibold text-slate-900">{inspected.title}</p>
                        <pre className="whitespace-pre-wrap break-words text-xs text-slate-600 font-sans leading-relaxed">
                          {inspected.content}
                        </pre>
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-center px-4">
                      <p className="text-xs text-slate-400">
                        {t(
                          'kb.csvImport.clickRow',
                          'Zeile anklicken, um den gerenderten Markdown-Inhalt zu prüfen.',
                        )}
                      </p>
                    </div>
                  )}
                  {previews.some((p) => p.hasAttachments) ? (
                    <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-800">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {t(
                          'kb.csvImport.attachmentHint',
                          'Anhänge aus SharePoint werden nicht importiert — bitte manuell nachziehen.',
                        )}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {/* csvText kept for potential re-parse; silence unused when only articles sent */}
              {csvText ? null : null}
            </>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/40">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            {t('common.cancel', 'Abbrechen')}
          </Button>
          {step === 2 ? (
            <Button
              type="button"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              disabled={importing || selectedCount === 0}
              onClick={() => void handleImport()}
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('kb.csvImport.importing', 'Importiere…')}
                </>
              ) : (
                t('kb.csvImport.importN', '{{count}} Artikel importieren').replace(
                  '{{count}}',
                  String(selectedCount),
                )
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
