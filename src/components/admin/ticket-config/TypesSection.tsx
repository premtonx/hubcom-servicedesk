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
import { ticketConfigService, type TypeWithUsage } from '../../../services/ticketConfigService';
import { cn } from '../../../lib/utils';
import { ReplacementDialog } from './ReplacementDialog';
import { SurfaceHint } from './SurfaceHint';

type TypeFormState = {
  name: string;
  description: string;
  color: string;
  isActive: boolean;
};

const EMPTY: TypeFormState = {
  name: '',
  description: '',
  color: '#3B82F6',
  isActive: true,
};

function formEqual(a: TypeFormState, b: TypeFormState): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.color === b.color &&
    a.isActive === b.isActive
  );
}

export function TypesSection() {
  const [items, setItems] = useState<TypeWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<TypeFormState>(EMPTY);
  const [baseline, setBaseline] = useState<TypeFormState>(EMPTY);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: TypeWithUsage;
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
      setItems(await ticketConfigService.listTypes(false));
    } catch (err: any) {
      toast.error(err?.message || 'Ticket-Typen konnten nicht geladen werden.');
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

  const startEdit = (row: TypeWithUsage) => {
    if (editingId === row.id) return;
    if ((editingId || creating) && !confirmDiscard()) return;
    const next: TypeFormState = {
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
      await ticketConfigService.updateType(editingId, payload);
      toast.success('Ticket-Typ aktualisiert.');
    } else {
      await ticketConfigService.createType(payload);
      toast.success('Ticket-Typ angelegt.');
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
      const current = items.find((t) => t.id === editingId);
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
        const current = items.find((t) => t.id === editingId);
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
        await ticketConfigService.removeType(pending.item.id, replacementKey);
        toast.success('Ticket-Typ gelöscht und Tickets umgebucht.');
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

  const onDelete = async (row: TypeWithUsage) => {
    if ((row.usageCount || 0) > 0) {
      setPending({ mode: 'delete', item: row });
      setReplacementKey('');
      return;
    }
    if (!window.confirm(`Ticket-Typ „${row.name}“ wirklich löschen?`)) return;
    try {
      await ticketConfigService.removeType(row.id);
      toast.success('Ticket-Typ gelöscht.');
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

  const move = async (row: TypeWithUsage, direction: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((t) => t.id === row.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    try {
      await Promise.all([
        ticketConfigService.updateType(row.id, { sortOrder: swap.sortOrder }),
        ticketConfigService.updateType(swap.id, { sortOrder: row.sortOrder }),
      ]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Sortierung fehlgeschlagen.');
    }
  };

  const editingRow = editingId ? items.find((t) => t.id === editingId) : null;

  const renderEditorFields = (mode: 'create' | 'edit') => {
    const nameId = mode === 'edit' ? `ty-name-${editingId}` : 'ty-name-create';
    const descId = mode === 'edit' ? `ty-desc-${editingId}` : 'ty-desc-create';
    const colorId = mode === 'edit' ? `ty-color-${editingId}` : 'ty-color-create';
    const keyHelpId = mode === 'edit' ? `ty-key-${editingId}-help` : undefined;

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        {mode === 'edit' && editingRow && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`ty-key-${editingId}`}>Interner Schlüssel</Label>
            <Input
              id={`ty-key-${editingId}`}
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
              placeholder="z. B. Incident"
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
                aria-label="Typfarbe"
              />
              <Input
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="rounded-xl font-mono text-xs min-w-0 flex-1"
                aria-label="Typfarbe als Hex-Wert"
              />
            </div>
          </div>
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor={descId}>Beschreibung (optional)</Label>
          <Textarea
            id={descId}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="rounded-xl min-h-[64px]"
            placeholder="Wann dieser Typ gewählt werden soll"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0B1F3A]">Aktiv</p>
            <p className="text-xs text-slate-500">
              Inaktive Typen erscheinen nicht in Auswahlfeldern.
            </p>
          </div>
          <Switch
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
            aria-label="Ticket-Typ aktiv"
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
            {mode === 'edit' ? 'Speichern' : 'Typ anlegen'}
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
      <SurfaceHint text="Ticket-Typen erscheinen im Erstellen-Dialog und können in Filtern sowie der Ticketliste genutzt werden. Beschreibung und Farbe helfen Agenten bei der Auswahl — Labels sind ohne Farbe lesbar." />

      {!creating && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Ticket-Typen für Formulare, Listenfilter und die Detail-Sidebar.
          </p>
          <Button
            type="button"
            onClick={startCreate}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden />
            Neuen Ticket-Typ anlegen
          </Button>
        </div>
      )}

      {creating && (
        <Card className="rounded-[2rem] shadow-sm border-slate-200">
          <CardHeader>
            <CardTitle>Neuen Ticket-Typ anlegen</CardTitle>
            <CardDescription>
              Optionale Beschreibung und Anzeigefarbe — Name und Reihenfolge sind Pflicht.
            </CardDescription>
          </CardHeader>
          <CardContent ref={editorRef}>{renderEditorFields('create')}</CardContent>
        </Card>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-5 py-3 border-b bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500">
          Ticket-Typen ({items.length})
        </div>
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Noch keine Ticket-Typen. Standardwerte werden beim Serverstart angelegt.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((row) => {
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
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 mt-1 sm:mt-0"
                      style={{ backgroundColor: row.color }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#0B1F3A]">{row.name}</p>
                        <span className="text-[10px] font-mono text-slate-400">{row.key}</span>
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
                        aria-label={`„${row.name}“ nach oben`}
                        onClick={() => void move(row, -1)}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${row.name}“ nach unten`}
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
                        aria-controls={isEditing ? `type-editor-${row.id}` : undefined}
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
                      id={`type-editor-${row.id}`}
                      ref={editorRef}
                      role="region"
                      aria-labelledby={`type-editor-heading-${row.id}`}
                      className="px-5 pb-5 pt-1 border-t border-[#1B6CA8]/15 bg-white"
                    >
                      <h3
                        id={`type-editor-heading-${row.id}`}
                        className="text-sm font-bold text-[#0B1F3A] mb-3"
                      >
                        Ticket-Typ bearbeiten: {row.name}
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
        title={pending?.mode === 'delete' ? 'Ticket-Typ löschen' : 'Ticket-Typ deaktivieren'}
        description={`„${pending?.item.name}“ wird von Tickets verwendet. Wählen Sie einen Ersatztyp — Tickets werden umgebucht, nicht gelöscht.`}
        usageCount={pending?.item.usageCount || 0}
        options={items
          .filter((t) => t.id !== pending?.item.id && t.isActive)
          .map((t) => ({ id: t.id, key: t.key, name: t.name }))}
        value={replacementKey}
        onValueChange={setReplacementKey}
        onConfirm={() => void confirmPending()}
        busy={saving}
      />
    </div>
  );
}