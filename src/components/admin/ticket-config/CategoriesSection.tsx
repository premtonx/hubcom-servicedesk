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
import { ticketCategoryService } from '../../../services/ticketCategoryService';
import type { TicketCategory } from '../../../lib/ticket-categories/types';
import { cn } from '../../../lib/utils';
import { ReplacementDialog } from './ReplacementDialog';
import { SurfaceHint } from './SurfaceHint';

type CategoryRow = TicketCategory & { usageCount?: number };

type CategoryFormState = {
  name: string;
  description: string;
  color: string;
  isActive: boolean;
};

const EMPTY: CategoryFormState = {
  name: '',
  description: '',
  color: '#1B6CA8',
  isActive: true,
};

function formEqual(a: CategoryFormState, b: CategoryFormState): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.color === b.color &&
    a.isActive === b.isActive
  );
}

export function CategoriesSection() {
  const [items, setItems] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CategoryFormState>(EMPTY);
  const [baseline, setBaseline] = useState<CategoryFormState>(EMPTY);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: CategoryRow;
  } | null>(null);
  const [replacementId, setReplacementId] = useState('');
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
      const res = await fetch('/api/ticket-categories?withUsage=1', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Laden fehlgeschlagen');
      setItems(data.categories || []);
    } catch (err: any) {
      toast.error(err?.message || 'Kategorien konnten nicht geladen werden.');
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

  const startEdit = (cat: CategoryRow) => {
    if (editingId === cat.id) return;
    if ((editingId || creating) && !confirmDiscard()) return;
    const next: CategoryFormState = {
      name: cat.name,
      description: cat.description,
      color: cat.color,
      isActive: cat.isActive,
    };
    setCreating(false);
    setEditingId(cat.id);
    setForm(next);
    setBaseline(next);
  };

  const cancelEdit = () => {
    if (!confirmDiscard()) return;
    resetForm();
  };

  const persist = async (extra?: { replacementId?: string; isActive?: boolean }) => {
    const payload = {
      ...form,
      isActive: extra?.isActive ?? form.isActive,
      ...(extra?.replacementId ? { replacementId: extra.replacementId } : {}),
    };
    if (editingId) {
      await ticketCategoryService.update(editingId, payload as Parameters<
        typeof ticketCategoryService.update
      >[1]);
      toast.success('Kategorie aktualisiert.');
    } else {
      await ticketCategoryService.create(form);
      toast.success('Kategorie angelegt.');
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
      const current = items.find((c) => c.id === editingId);
      if (current?.isActive && (current.usageCount || 0) > 0) {
        setPending({ mode: 'deactivate', item: current });
        setReplacementId('');
        return;
      }
    }
    setSaving(true);
    try {
      await persist();
    } catch (err: any) {
      if (err?.code === 'REPLACEMENT_REQUIRED' && editingId) {
        const current = items.find((c) => c.id === editingId);
        if (current) {
          setPending({ mode: 'deactivate', item: current });
          setReplacementId('');
        }
      } else {
        toast.error(err?.message || 'Speichern fehlgeschlagen.');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmPending = async () => {
    if (!pending || !replacementId) return;
    setSaving(true);
    try {
      if (pending.mode === 'delete') {
        await ticketCategoryService.remove(pending.item.id, replacementId);
        toast.success('Kategorie gelöscht und Tickets umgebucht.');
      } else {
        await ticketCategoryService.update(pending.item.id, {
          ...form,
          isActive: false,
          replacementId,
        } as Parameters<typeof ticketCategoryService.update>[1]);
        toast.success('Kategorie deaktiviert und Tickets umgebucht.');
        resetForm();
      }
      setPending(null);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Aktion fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (cat: CategoryRow) => {
    if ((cat.usageCount || 0) > 0) {
      setPending({ mode: 'delete', item: cat });
      setReplacementId('');
      return;
    }
    if (!window.confirm(`Kategorie „${cat.name}“ wirklich löschen?`)) return;
    try {
      await ticketCategoryService.remove(cat.id);
      toast.success('Kategorie gelöscht.');
      if (editingId === cat.id) resetForm();
      await load();
    } catch (err: any) {
      if (err?.code === 'REPLACEMENT_REQUIRED') {
        setPending({ mode: 'delete', item: cat });
        setReplacementId('');
      } else {
        toast.error(err?.message || 'Löschen fehlgeschlagen.');
      }
    }
  };

  const move = async (cat: CategoryRow, direction: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((c) => c.id === cat.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    try {
      await Promise.all([
        ticketCategoryService.update(cat.id, { sortOrder: swap.sortOrder }),
        ticketCategoryService.update(swap.id, { sortOrder: cat.sortOrder }),
      ]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Sortierung fehlgeschlagen.');
    }
  };

  const editingRow = editingId ? items.find((c) => c.id === editingId) : null;

  const renderEditorFields = (mode: 'create' | 'edit') => {
    const nameId = mode === 'edit' ? `cat-name-${editingId}` : 'cat-name-create';
    const descId = mode === 'edit' ? `cat-desc-${editingId}` : 'cat-desc-create';
    const colorId = mode === 'edit' ? `cat-color-${editingId}` : 'cat-color-create';
    const keyHelpId = mode === 'edit' ? `cat-key-${editingId}-help` : undefined;

    return (
      <form onSubmit={onSubmit} className="space-y-4">
        {mode === 'edit' && editingRow && (
          <div className="space-y-1.5 min-w-0">
            <Label htmlFor={`cat-key-${editingId}`}>Interner Schlüssel</Label>
            <Input
              id={`cat-key-${editingId}`}
              value={editingRow.slug}
              readOnly
              className="rounded-xl font-mono text-xs bg-slate-50"
              aria-describedby={keyHelpId}
            />
            <p id={keyHelpId} className="text-[11px] text-slate-500 leading-snug">
              Unveränderlicher Slug, den Tickets speichern. Bleibt beim Umbenennen erhalten.
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
              placeholder="z. B. First Level Support"
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
                aria-label="Kategoriefarbe"
              />
              <Input
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="rounded-xl font-mono text-xs min-w-0 flex-1"
                aria-label="Farbcode"
              />
            </div>
          </div>
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor={descId}>Beschreibung</Label>
          <Textarea
            id={descId}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="rounded-xl min-h-[72px]"
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0B1F3A]">Aktiv</p>
            <p className="text-xs text-slate-500">
              Deaktivierte Kategorien sind in Dropdowns ausgeblendet.
            </p>
          </div>
          <Switch
            checked={form.isActive}
            onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
            aria-label="Kategorie aktiv"
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
            {mode === 'edit' ? 'Speichern' : 'Kategorie anlegen'}
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
      <SurfaceHint text="Kategorien erscheinen im Ticket-Formular, in Filtern, der Ticketliste und der Detail-Sidebar." />

      {!creating && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Kategorien für Formulare, Listenfilter und die Detail-Sidebar.
          </p>
          <Button
            type="button"
            onClick={startCreate}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden />
            Neue Kategorie anlegen
          </Button>
        </div>
      )}

      {creating && (
        <Card className="rounded-[2rem] shadow-sm border-slate-200">
          <CardHeader>
            <CardTitle>Neue Kategorie anlegen</CardTitle>
            <CardDescription>
              Aktive Kategorien stehen in Dropdowns und Filtern zur Verfügung.
            </CardDescription>
          </CardHeader>
          <CardContent ref={editorRef}>{renderEditorFields('create')}</CardContent>
        </Card>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <div className="px-5 py-3 border-b bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500">
          Vorhandene Kategorien ({items.length})
        </div>
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Noch keine Kategorien. Legen Sie die erste Kategorie an.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((cat) => {
              const isEditing = editingId === cat.id;
              return (
                <div key={cat.id} className={cn(isEditing && 'bg-[#E8F1F8]/35')}>
                  <div
                    className={cn(
                      'flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-3 px-5 py-4 hover:bg-slate-50/60',
                      isEditing && 'hover:bg-transparent',
                    )}
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5 mt-1 sm:mt-0"
                      style={{ backgroundColor: cat.color }}
                      title={cat.color}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#0B1F3A]">{cat.name}</p>
                        {!cat.isActive && (
                          <Badge className="bg-slate-100 text-slate-600 border-none text-[9px]">
                            Inaktiv
                          </Badge>
                        )}
                        <Badge
                          className="border-none text-[9px] text-white"
                          style={{ backgroundColor: cat.color }}
                        >
                          {cat.slug}
                        </Badge>
                        {(cat.usageCount || 0) > 0 && (
                          <span className="text-[10px] font-bold text-slate-400">
                            {cat.usageCount} Tickets
                          </span>
                        )}
                      </div>
                      {cat.description && (
                        <p className="text-xs text-slate-500 mt-0.5 break-words">
                          {cat.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${cat.name}“ nach oben`}
                        onClick={() => void move(cat, -1)}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${cat.name}“ nach unten`}
                        onClick={() => void move(cat, 1)}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        aria-label={`„${cat.name}“ bearbeiten`}
                        aria-expanded={isEditing}
                        aria-controls={isEditing ? `category-editor-${cat.id}` : undefined}
                        ref={(el) => {
                          editButtonRefs.current[cat.id] = el;
                        }}
                        onClick={() => startEdit(cat)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-red-600"
                        aria-label={`„${cat.name}“ löschen`}
                        onClick={() => void onDelete(cat)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isEditing && (
                    <div
                      id={`category-editor-${cat.id}`}
                      ref={editorRef}
                      role="region"
                      aria-labelledby={`category-editor-heading-${cat.id}`}
                      className="px-5 pb-5 pt-1 border-t border-[#1B6CA8]/15 bg-white"
                    >
                      <h3
                        id={`category-editor-heading-${cat.id}`}
                        className="text-sm font-bold text-[#0B1F3A] mb-3"
                      >
                        Kategorie bearbeiten: {cat.name}
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
        title={pending?.mode === 'delete' ? 'Kategorie löschen' : 'Kategorie deaktivieren'}
        description={`„${pending?.item.name}“ ist noch in Tickets hinterlegt. Wählen Sie eine Ersatzkategorie — bestehende Ticketdaten werden umgebucht, nicht gelöscht.`}
        usageCount={pending?.item.usageCount || 0}
        options={items
          .filter((c) => c.id !== pending?.item.id && c.isActive)
          .map((c) => ({ id: c.id, name: c.name }))}
        value={replacementId}
        onValueChange={setReplacementId}
        onConfirm={() => void confirmPending()}
        busy={saving}
      />
    </div>
  );
}