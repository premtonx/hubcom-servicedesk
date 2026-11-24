import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Switch } from '../../ui/switch';
import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import {
  ticketConfigService,
  type PriorityWithUsage,
} from '../../../services/ticketConfigService';
import { RECOMMENDED_PRIORITY_COLORS } from '../../../lib/ticket-config/types';
import { cn } from '../../../lib/utils';
import { ReplacementDialog } from './ReplacementDialog';
import { SurfaceHint } from './SurfaceHint';

type PriorityFormState = {
  name: string;
  description: string;
  color: string;
  isActive: boolean;
};

const EMPTY: PriorityFormState = {
  name: '',
  description: '',
  color: RECOMMENDED_PRIORITY_COLORS.medium,
  isActive: true,
};

function formEqual(a: PriorityFormState, b: PriorityFormState): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.color === b.color &&
    a.isActive === b.isActive
  );
}

export function PrioritiesSection() {
  const [items, setItems] = useState<PriorityWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PriorityFormState>(EMPTY);
  const [baseline, setBaseline] = useState<PriorityFormState>(EMPTY);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: PriorityWithUsage;
  } | null>(null);
  const [replacementKey, setReplacementKey] = useState('');
  const editorRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const editButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const isDirty = useMemo(() => {
    if (!editingId && !creating) return false;
    return !formEqual(form, baseline);
  }, [editingId, creating, form, baseline]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await ticketConfigService.listPriorities(false));
    } catch (err: any) {
      toast.error(err?.message || 'Prioritäten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!editingId && !creating) return;
    const node = editorRef.current;
    if (node) {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    const t = window.setTimeout(() => nameInputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [editingId, creating]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const confirmDiscard = () => {
    if (!isDirty) return true;
    return window.confirm('Ungespeicherte Änderungen verwerfen?');
  };

  const resetForm = (opts?: { restoreFocusId?: string | null }) => {
    const focusId = opts?.restoreFocusId ?? editingId;
    setEditingId(null);
    setCreating(false);
    setForm(EMPTY);
    setBaseline(EMPTY);
    if (focusId) {
      window.setTimeout(() => editButtonRefs.current[focusId]?.focus(), 0);
    }
  };

  const startCreate = () => {
    if (editingId || creating) {
      if (!confirmDiscard()) return;
    }
    setEditingId(null);
    setCreating(true);
    setForm(EMPTY);
    setBaseline(EMPTY);
  };

  const startEdit = (row: PriorityWithUsage) => {
    if (editingId === row.id) return;
    if ((editingId || creating) && !confirmDiscard()) return;
    const next: PriorityFormState = {
      name: row.name,
      description: row.description,
      color: row.color,
      isActive: row.isActive,
    };
    setCreating(false);
    setEditingId(row.id);
    setForm(next);
    setBaseline(next);
  };

  const cancelEdit = () => {
    if (!confirmDiscard()) return;
    resetForm();
  };

  const persist = async (extra?: { replacementKey?: string; isActive?: boolean }) => {
    const payload = {
      ...form,
      isActive: extra?.isActive ?? form.isActive,
      replacementKey: extra?.replacementKey,
    };
    if (editingId) {
      await ticketConfigService.updatePriority(editingId, payload);
      toast.success('Priorität aktualisiert.');
    } else {
      await ticketConfigService.createPriority(payload);
      toast.success('Priorität angelegt.');
    }
    resetForm();
    await load();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Bitte einen Namen eingeben.');
      return;
    }
    if (editingId && !form.isActive) {
      const current = items.find((p) => p.id === editingId);
      if (current?.isActive && (current.usageCount || 0) > 0) {
        setPending({ mode: 'deactivate', item: current });
        setReplacementKey('');
        return;
      }
    }
    setSaving(true);
    try {
      await persist();
    } catch (err: any) {
      if (err?.code === 'REPLACEMENT_REQUIRED' && editingId) {
        const current = items.find((p) => p.id === editingId);
        if (current) {
          setPending({ mode: 'deactivate', item: current });
          setReplacementKey('');
        }
      } else {
        toast.error(err?.message || 'Speichern fehlgeschlagen.');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async () => {
    if (!pending || !replacementKey) return;
    setSaving(true);
    try {
      if (pending.mode === 'delete') {
        await ticketConfigService.removePriority(pending.item.id, replacementKey);
        toast.success('Priorität gelöscht und Tickets umgebucht.');
      } else {
        await persist({ replacementKey, isActive: false });
      }
      setPending(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Aktion fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: PriorityWithUsage) => {
    if ((row.usageCount || 0) > 0) {
      setPending({ mode: 'delete', item: row });
      setReplacementKey('');
      return;
    }
    if (!window.confirm(`Priorität „${row.name}“ wirklich löschen?`)) return;
    try {
      await ticketConfigService.removePriority(row.id);
      toast.success('Priorität gelöscht.');
      if (editingId === row.id) resetForm();
      await load();
    } catch (err: any) {
      if (err?.code === 'REPLACEMENT_REQUIRED') {
        setPending({ mode: 'delete', item: row });
        setReplacementKey('');
      } else {
        toast.error(err?.message || 'Löschen fehlgeschlagen.');
      }
    }
  };

  const move = async (row: PriorityWithUsage, direction: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((p) => p.id === row.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    try {
      await Promise.all([
        ticketConfigService.updatePriority(row.id, { sortOrder: swap.sortOrder }),
        ticketConfigService.updatePriority(swap.id, { sortOrder: row.sortOrder }),
      ]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Sortierung fehlgeschlagen.');
    }
  };

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const editingRow = editingId ? items.find((p) => p.id === editingId) : null;

  const renderEditorFields = (mode: 'create' | 'edit') => {
    const nameId = mode === 'edit' ? `pr-name-${editingId}` : 'pr-name-create';
    const descId = mode === 'edit' ? `pr-desc-${editingId}` : 'pr-desc-create';
    const colorId = mode === 'edit' ? `pr-color-${editingId}` : 'pr-color-create';
    const keyHelpId = mode === 'edit' ? `pr-key-${editingId}-help` : undefined;

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        {mode === 'edit' && editingRow && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`pr-key-${editingId}`}>Interner Schlüssel</Label>
            <Input
              id={`pr-key-${editingId}`}
              value={editingRow.key}
              readOnly
              className="rounded-xl font-mono text-xs bg-slate-50"
              aria-describedby={keyHelpId}
            />
            <p id={keyHelpId} className="text-[11px] text-slate-500 leading-snug">
              Unveränderlicher Wert, den Tickets speichern. Bleibt beim Umbenennen erhalten.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5 md:col-span-2 min-w-0">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              ref={nameInputRef}
              id={nameId}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="z. B. Medium"
              className="rounded-xl"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={colorId}>Farbe</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={colorId}
                type="color"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="w-12 h-10 p-1 rounded-xl shrink-0"
                aria-label="Prioritätsfarbe"
              />
              <Input
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="rounded-xl font-mono text-xs min-w-0 flex-1"
                aria-label="Prioritätsfarbe als Hex-Wert"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['low', 'Low · Grau'],
              ['medium', 'Medium · Blau'],
              ['high', 'High · Orange'],
              ['urgent', 'Urgent · Rot'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setForm((f) => ({ ...f, color: RECOMMENDED_PRIORITY_COLORS[key] }))
              }
              className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6CA8]"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: RECOMMENDED_PRIORITY_COLORS[key] }}
                aria-hidden
              />
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor={descId}>Beschreibung</Label>
          <Textarea
            id={descId}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="rounded-xl min-h-[64px]"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0B1F3A]">Aktiv</p>
            <p className="text-xs text-slate-500">
              Inaktive Prioritäten sind in Auswahlfeldern ausgeblendet.
            </p>
          </div>
          <Switch
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
            aria-label="Priorität aktiv"
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
            ) : mode === 'edit' ? (
              <Pencil className="w-4 h-4 mr-2" aria-hidden />
            ) : (
              <Plus className="w-4 h-4 mr-2" aria-hidden />
            )}
            {mode === 'edit' ? 'Speichern' : 'Priorität anlegen'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={cancelEdit}
            disabled={saving}
          >
            Abbrechen
          </Button>
          {isDirty && (
            <span className="self-center text-[11px] font-semibold text-amber-700">
              Ungespeicherte Änderungen
            </span>
          )}
        </div>
      </form>
    );
  };

  return (
    <div className="space-y-6">
      <SurfaceHint text="Prioritäten erscheinen in Ticketformularen, Filtern, der Ticketliste und der Detail-Sidebar. Die Reihenfolge unten läuft von niedrigster zu höchster Priorität. Farben dienen der Anzeige — sie ändern keine SLA-Regeln." />

      {!creating && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Prioritätswerte für Formulare, Listenfilter und die Detail-Sidebar.
          </p>
          <Button
            type="button"
            onClick={startCreate}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden />
            Neue Priorität anlegen
          </Button>
        </div>
      )}

      {creating && (
        <Card className="rounded-[2rem] shadow-sm border-slate-200">
          <CardHeader>
            <CardTitle>Neue Priorität anlegen</CardTitle>
            <CardDescription>
              Empfohlene Farben: Low grau, Medium blau, High orange, Urgent rot.
            </CardDescription>
          </CardHeader>
          <CardContent ref={editorRef}>{renderEditorFields('create')}</CardContent>
        </Card>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-5 py-3 border-b bg-slate-50/80 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Prioritätsreihenfolge — niedrig → hoch ({items.length})
          </span>
          <span className="text-[10px] font-semibold text-slate-400">
            Pfeile ändern die Rangfolge
          </span>
        </div>
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Noch keine Prioritäten. Standardwerte werden beim Serverstart angelegt.
          </p>
        ) : (
          <div className="divide-y">
            {sorted.map((row, index) => {
              const isEditing = editingId === row.id;
              return (
                <div key={row.id} className={cn(isEditing && 'bg-[#E8F1F8]/35')}>
                  <div
                    className={cn(
                      'flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-3 px-5 py-4 hover:bg-slate-50/60',
                      isEditing && 'hover:bg-transparent',
                    )}
                  >
                    <span
                      className="text-[10px] font-black text-slate-400 w-6 tabular-nums shrink-0 mt-1 sm:mt-0"
                      title="Rang (1 = niedrigste)"
                    >
                      {index + 1}
                    </span>
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 mt-1 sm:mt-0"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#0B1F3A]">{row.name}</p>
                        <span className="text-[10px] font-mono text-slate-400">{row.key}</span>
                        {index === 0 && (
                          <Badge className="bg-slate-100 text-slate-600 border-none text-[9px]">
                            Niedrigste
                          </Badge>
                        )}
                        {index === sorted.length - 1 && sorted.length > 1 && (
                          <Badge className="bg-rose-50 text-rose-700 border-none text-[9px]">
                            Höchste
                          </Badge>
                        )}
                        {!row.isActive && (
                          <Badge className="bg-slate-100 text-slate-600 border-none text-[9px]">
                            Inaktiv
                          </Badge>
                        )}
                        {(row.usageCount || 0) > 0 && (
                          <span className="text-[10px] font-bold text-slate-400">
                            {row.usageCount} Tickets
                          </span>
                        )}
                      </div>
                      {row.description && (
                        <p className="text-xs text-slate-500 mt-0.5 break-words">
                          {row.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${row.name}“ niedriger einstufen`}
                        onClick={() => void move(row, -1)}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${row.name}“ höher einstufen`}
                        onClick={() => void move(row, 1)}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${row.name}“ bearbeiten`}
                        aria-expanded={isEditing}
                        aria-controls={isEditing ? `priority-editor-${row.id}` : undefined}
                        ref={(el) => {
                          editButtonRefs.current[row.id] = el;
                        }}
                        onClick={() => startEdit(row)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600"
                        aria-label={`„${row.name}“ löschen`}
                        onClick={() => void onDelete(row)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isEditing && (
                    <div
                      id={`priority-editor-${row.id}`}
                      ref={editorRef}
                      role="region"
                      aria-labelledby={`priority-editor-heading-${row.id}`}
                      className="px-5 pb-5 pt-1 border-t border-[#1B6CA8]/15 bg-white"
                    >
                      <h3
                        id={`priority-editor-heading-${row.id}`}
                        className="text-sm font-bold text-[#0B1F3A] mb-3"
                      >
                        Priorität bearbeiten: {row.name}
                      </h3>
                      {renderEditorFields('edit')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ReplacementDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.mode === 'delete' ? 'Priorität löschen' : 'Priorität deaktivieren'}
        description={`„${pending?.item.name}“ wird von Tickets verwendet. Wählen Sie eine Ersatzpriorität — Tickets werden umgebucht, nicht gelöscht.`}
        usageCount={pending?.item.usageCount || 0}
        options={items
          .filter((p) => p.id !== pending?.item.id && p.isActive)
          .map((p) => ({ id: p.id, key: p.key, name: p.name }))}
        value={replacementKey}
        onValueChange={setReplacementKey}
        onConfirm={() => void confirmPending()}
        busy={saving}
      />
    </div>
  );
}