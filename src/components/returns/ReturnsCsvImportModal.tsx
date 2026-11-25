/**
 * 2-step SharePoint CSV-Import modal for Rücklieferungen (staff + portal).
 * Calls /import-csv/preview then /import-csv (portal/staff returns base only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  Search,
  Upload,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatDateDeOnly } from '../../lib/client-portal/hardware-returns-dates';

type WorkbenchMode = 'portal' | 'staff';

type PreviewSummary = {
  total: number;
  toImport: number;
  openCount: number;
  completedCount: number;
  testExcluded: number;
  duplicatesSkipped: number;
  employeesDetected: number;
  newCatalogItems: {
    device_types: string[];
    shipping_methods: string[];
    statuses: string[];
    slas: string[];
    service_levels: string[];
  };
};

type PreviewRow = {
  externalRefId: string | null;
  assigneeName: string | null;
  employeeName: string | null;
  employeeEmail: string | null;
  deviceOldType: string | null;
  deviceOldSerial: string | null;
  deviceNewType: string | null;
  deviceNewSerial: string | null;
  shippingMethod: string | null;
  returnDueDate: string | null;
  status: string | null;
  returned: boolean;
  mail1SentAt: string | null;
  mail2SentAt: string | null;
  mail3SentAt: string | null;
  willImport: boolean;
  skipReason: string | null;
  isLikelyTest: boolean;
  duplicate: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: WorkbenchMode;
  organizationId: string;
  apiBase: string;
  idPrefix?: string;
  onImported: () => void;
};

const PAGE_SIZE = 50;

function formatIdDisplay(prefix: string, externalRefId: string | null): string {
  const id = String(externalRefId || '').trim();
  if (!id) return '—';
  const raw = `${prefix}-${id}`;
  return raw.startsWith('#') ? raw : `#${raw}`;
}

function deviceCell(type: string | null, serial: string | null): string {
  const t = String(type || '').trim();
  const s = String(serial || '').trim();
  if (!t && !s) return '—';
  if (t && s) return `${t} · ${s}`;
  return t || s;
}

function mailStatusLabel(row: PreviewRow): string {
  if (row.mail3SentAt) return 'Mail 3 gesendet';
  if (row.mail2SentAt) return 'Mail 2 gesendet';
  if (row.mail1SentAt) return 'Mail 1 gesendet';
  return 'Keine Mahnung';
}

function SummaryPill({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    sky: 'bg-sky-50 text-sky-800 border-sky-100',
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-100',
    amber: 'bg-amber-50 text-amber-900 border-amber-100',
    rose: 'bg-rose-50 text-rose-800 border-rose-100',
    violet: 'bg-violet-50 text-violet-800 border-violet-100',
  };
  return (
    <div className={cn('rounded-xl border px-3 py-2 min-w-[7.5rem]', tones[tone])}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-lg font-black tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}

export function ReturnsCsvImportModal({
  open,
  onOpenChange,
  mode,
  organizationId,
  apiBase,
  idPrefix = 'DPG',
  onImported,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [scope, setScope] = useState<'all' | 'open_only'>('all');
  const [excludeTestRows, setExcludeTestRows] = useState(true);
  const [mergeCatalogs, setMergeCatalogs] = useState(true);
  const [seedDirectory, setSeedDirectory] = useState(true);
  const [enableAutoReminders, setEnableAutoReminders] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const reset = useCallback(() => {
    setStep(1);
    setFileName('');
    setCsvText('');
    setDragOver(false);
    setScope('all');
    setExcludeTestRows(true);
    setMergeCatalogs(true);
    setSeedDirectory(true);
    setEnableAutoReminders(false);
    setPreviewing(false);
    setImporting(false);
    setSummary(null);
    setPreviewRows([]);
    setSearch('');
    setPage(0);
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const orgPayload = mode === 'staff' ? { organizationId } : {};

  const acceptFile = async (file: File) => {
    const name = file.name || 'import.csv';
    if (!name.toLowerCase().endsWith('.csv') && file.type && !file.type.includes('csv')) {
      toast.error('Bitte eine .csv-Datei auswählen.');
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      toast.error('CSV-Datei ist leer.');
      return;
    }
    setCsvText(text);
    setFileName(name);
  };

  const runPreview = async () => {
    if (!csvText.trim()) {
      toast.error('Bitte zuerst eine CSV-Datei auswählen.');
      return;
    }
    setPreviewing(true);
    try {
      const res = await axios.post(
        `${apiBase}/import-csv/preview`,
        {
          csvText,
          scope,
          excludeTestRows,
          ...orgPayload,
        },
        { withCredentials: true },
      );
      setSummary(res.data?.summary || null);
      setPreviewRows(Array.isArray(res.data?.previewRows) ? res.data.previewRows : []);
      setPage(0);
      setSearch('');
      setStep(2);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Vorschau fehlgeschlagen');
      toast.error(message);
    } finally {
      setPreviewing(false);
    }
  };

  const importableRows = useMemo(
    () => previewRows.filter((r) => r.willImport),
    [previewRows],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return importableRows;
    return importableRows.filter((r) => {
      const hay = [
        r.externalRefId,
        r.assigneeName,
        r.employeeName,
        r.employeeEmail,
        r.deviceOldType,
        r.deviceOldSerial,
        r.deviceNewType,
        r.deviceNewSerial,
        r.shippingMethod,
        r.status,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }, [importableRows, search]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const pageRows = filteredRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  const handleCommit = async () => {
    if (!csvText || !summary?.toImport) return;
    setImporting(true);
    try {
      const res = await axios.post(
        `${apiBase}/import-csv`,
        {
          csvText,
          scope,
          excludeTestRows,
          mergeCatalogs,
          seedDirectory,
          enableAutoReminders,
          ...orgPayload,
        },
        { withCredentials: true },
      );
      const imported = Number(res.data?.imported || 0);
      const employeesSeeded = Number(res.data?.employeesSeeded || 0);
      const parts = [`${imported} Rücklieferungen importiert`];
      if (employeesSeeded > 0) parts.push(`${employeesSeeded} Mitarbeiter ergänzt`);
      toast.success(parts.join(', '));
      onImported();
      onOpenChange(false);
      reset();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Import fehlgeschlagen');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  };

  const catalogBox =
    summary &&
    (summary.newCatalogItems.device_types.length > 0 ||
      summary.newCatalogItems.shipping_methods.length > 0);

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
          <DialogTitle>CSV / SharePoint importieren</DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'SharePoint-Export (Ticketsystem_DPG.csv) hochladen und Import-Optionen wählen.'
              : 'Vorschau prüfen und ausgewählte Rücklieferungen übernehmen.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {step === 1 ? (
            <>
              <div
                className={cn(
                  'rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors cursor-pointer',
                  dragOver
                    ? 'border-sky-400 bg-sky-50/50'
                    : csvText
                      ? 'border-emerald-300 bg-emerald-50/40'
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
                  if (file) void acceptFile(file);
                }}
              >
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm text-sky-600">
                  {csvText ? (
                    <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-800">
                  {csvText
                    ? fileName || 'import.csv'
                    : 'CSV hier ablegen oder klicken zum Auswählen'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {csvText
                    ? 'Datei geladen · UTF-8 · erneut klicken zum Austauschen'
                    : 'UTF-8 SharePoint-Export · max. ca. 5 MB'}
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void acceptFile(file);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Import-Umfang
                </Label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as 'all' | 'open_only')}
                  className="w-full h-10 border border-slate-200 rounded-xl bg-white px-3 text-sm font-medium"
                >
                  <option value="all">Alle gültigen Einträge (Offen + Historie)</option>
                  <option value="open_only">
                    Nur offene Rücklieferungen (noch nicht zurückgeliefert)
                  </option>
                </select>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={excludeTestRows}
                    onCheckedChange={(v) => setExcludeTestRows(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-slate-800 font-medium">
                    Testzeilen automatisch ausschließen
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={mergeCatalogs}
                    onCheckedChange={(v) => setMergeCatalogs(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-slate-800 font-medium">
                    Kataloge (Gerätetypen, Versandarten, Status, SLA) aus CSV ergänzen
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <Checkbox
                    checked={seedDirectory}
                    onCheckedChange={(v) => setSeedDirectory(v === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-slate-800 font-medium">
                    Mitarbeiter-Verzeichnis aus CSV mitbefüllen
                  </span>
                </label>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                      checked={enableAutoReminders}
                      onCheckedChange={(v) => setEnableAutoReminders(v === true)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-slate-800 font-medium">
                      Auto-Mahnversand für importierte Zeilen aktivieren
                    </span>
                  </label>
                  {!enableAutoReminders ? (
                    <div className="ml-7 flex gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-900">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Empfohlen: Aus lassen, damit überfällige Alt-Fälle nicht sofort Mahnungen
                        auslösen.
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <FileSpreadsheet className="h-4 w-4 text-slate-400" />
                  <span className="font-medium text-slate-800">{fileName || 'import.csv'}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={previewing || importing}
                  onClick={() => {
                    setStep(1);
                    setSummary(null);
                    setPreviewRows([]);
                  }}
                >
                  Zurück zu Optionen
                </Button>
              </div>

              {summary ? (
                <div className="flex flex-wrap gap-2">
                  <SummaryPill label="Zu importieren" value={summary.toImport} tone="sky" />
                  <SummaryPill label="Offen" value={summary.openCount} tone="violet" />
                  <SummaryPill label="Erledigt" value={summary.completedCount} tone="emerald" />
                  <SummaryPill
                    label="Testdaten ausgeschlossen"
                    value={summary.testExcluded}
                    tone="amber"
                  />
                  <SummaryPill
                    label="Duplikate übersprungen"
                    value={summary.duplicatesSkipped}
                    tone="rose"
                  />
                  <SummaryPill
                    label="Mitarbeiter erkannt"
                    value={summary.employeesDetected}
                    tone="slate"
                  />
                </div>
              ) : null}

              {catalogBox ? (
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-sky-950">
                  <p className="text-xs font-bold uppercase tracking-wide text-sky-700 mb-2">
                    Neue Katalogeinträge
                  </p>
                  {summary!.newCatalogItems.device_types.length ? (
                    <p className="text-xs leading-relaxed">
                      <span className="font-semibold">Gerätetypen: </span>
                      {summary!.newCatalogItems.device_types.join(', ')}
                    </p>
                  ) : null}
                  {summary!.newCatalogItems.shipping_methods.length ? (
                    <p className="text-xs leading-relaxed mt-1">
                      <span className="font-semibold">Versandarten: </span>
                      {summary!.newCatalogItems.shipping_methods.join(', ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Vorschau filtern…"
                    className="h-9 pl-9 rounded-xl text-sm"
                  />
                </div>
                <span className="text-xs text-slate-500">
                  {filteredRows.length} Zeilen
                  {filteredRows.length > PAGE_SIZE
                    ? ` · Seite ${page + 1}/${pageCount}`
                    : ''}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
                <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                  <table className="w-full text-left text-sm min-w-[960px]">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-bold">ID</th>
                        <th className="px-3 py-2 font-bold">Bearbeiter</th>
                        <th className="px-3 py-2 font-bold">Mitarbeiter</th>
                        <th className="px-3 py-2 font-bold">Alt (Gerät + S/N)</th>
                        <th className="px-3 py-2 font-bold">Neu (Gerät + S/N)</th>
                        <th className="px-3 py-2 font-bold">Versandart</th>
                        <th className="px-3 py-2 font-bold">Fällig am</th>
                        <th className="px-3 py-2 font-bold">Mahnstatus</th>
                        <th className="px-3 py-2 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => (
                        <tr
                          key={`${row.externalRefId}-${row.employeeEmail || ''}-${row.returnDueDate || ''}`}
                          className="border-b border-slate-100 hover:bg-slate-50/80"
                        >
                          <td className="px-3 py-2 font-mono text-xs text-sky-800 whitespace-nowrap">
                            {formatIdDisplay(idPrefix, row.externalRefId)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            {row.assigneeName || '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700">
                            <div className="font-medium">{row.employeeName || '—'}</div>
                            {row.employeeEmail ? (
                              <div className="text-[10px] text-slate-400">{row.employeeEmail}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px]">
                            {deviceCell(row.deviceOldType, row.deviceOldSerial)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 max-w-[160px]">
                            {deviceCell(row.deviceNewType, row.deviceNewSerial)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600">
                            {row.shippingMethod || '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                            {formatDateDeOnly(row.returnDueDate)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                            {mailStatusLabel(row)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                            {row.status || (row.returned ? 'Geschlossen' : 'Neu')}
                          </td>
                        </tr>
                      ))}
                      {!pageRows.length ? (
                        <tr>
                          <td
                            colSpan={9}
                            className="px-3 py-10 text-center text-sm text-slate-400"
                          >
                            Keine importierbaren Zeilen in der aktuellen Filterung.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {pageCount > 1 ? (
                  <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 bg-slate-50/50">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={page <= 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Zurück
                    </Button>
                    <span className="text-xs text-slate-500">
                      {page * PAGE_SIZE + 1}–
                      {Math.min(filteredRows.length, (page + 1) * PAGE_SIZE)} von{' '}
                      {filteredRows.length}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={page >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    >
                      Weiter
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/40">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={importing || previewing}
          >
            Abbrechen
          </Button>
          {step === 1 ? (
            <Button
              type="button"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              disabled={!csvText || previewing}
              onClick={() => void runPreview()}
            >
              {previewing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Vorschau…
                </>
              ) : (
                'Weiter zur Vorschau'
              )}
            </Button>
          ) : (
            <Button
              type="button"
              className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
              disabled={importing || !summary?.toImport}
              onClick={() => void handleCommit()}
            >
              {importing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importiere…
                </>
              ) : (
                `${summary?.toImport || 0} Rücklieferungen importieren`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
