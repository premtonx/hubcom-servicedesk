import { useCallback, useEffect, useState, type FormEvent } from 'react';
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

const EMPTY = { name: '', description: '', color: '#1B6CA8', isActive: true };

export function CategoriesSection() {
  const [items, setItems] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: CategoryRow;
  } | null>(null);
  const [replacementId, setReplacementId] = useState('');

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

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY);
  };

  const startEdit = (cat: CategoryRow) => {
    setEditingId(cat.id);
    setForm({
      name: cat.name,
      description: cat.description,
      color: cat.color,
      isActive: cat.isActive,
    });
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
      if (editingId) {
        await ticketCategoryService.update(editingId, form);
        toast.success('Kategorie aktualisiert.');
      } else {
        await ticketCategoryService.create(form);
        toast.success('Kategorie angelegt.');
      }
      resetForm();
      await load();
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
        } as any);
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

  return (
    <div className="space-y-6">
      <SurfaceHint
        text="Kategorien erscheinen im Ticket-Formular, in Filtern, der Ticketliste und der Detail-Sidebar."
      />

      <Card className="rounded-[2rem] shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle>{editingId ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</CardTitle>
          <CardDescription>
            Aktive Kategorien stehen in Dropdowns und Filtern zur Verfügung.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="z. B. First Level Support"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cat-color">Farbe</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cat-color"
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-12 h-10 p-1 rounded-xl"
                    aria-label="Kategoriefarbe"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="rounded-xl font-mono text-xs"
                    aria-label="Farbcode"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-desc">Beschreibung</Label>
              <Textarea
                id="cat-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-xl min-h-[72px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <div>
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
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : editingId ? (
                  <Pencil className="w-4 h-4 mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                {editingId ? 'Speichern' : 'Kategorie anlegen'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" className="rounded-xl" onClick={resetForm}>
                  Abbrechen
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500">
          Vorhandene Kategorien ({items.length})
        </div>
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Noch keine Kategorien. Legen Sie die erste Kategorie oben an.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((cat) => (
              <div
                key={cat.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60',
                  editingId === cat.id && 'bg-[#E8F1F8]/40',
                )}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5"
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
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{cat.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label="Nach oben"
                    onClick={() => void move(cat, -1)}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label="Nach unten"
                    onClick={() => void move(cat, 1)}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label="Bearbeiten"
                    onClick={() => startEdit(cat)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-red-600"
                    aria-label="Löschen"
                    onClick={() => void onDelete(cat)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ReplacementDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.mode === 'delete' ? 'Kategorie löschen' : 'Kategorie deaktivieren'
        }
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
