import { useEffect, useState, type FormEvent } from 'react';
import { FolderTree, Loader2, Pencil, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ticketCategoryService } from '../../services/ticketCategoryService';
import type { TicketCategory } from '../../lib/ticket-categories/types';
import { useTranslation } from '../../lib/context/I18nContext';
import { cn } from '../../lib/utils';

const EMPTY_FORM = {
  name: '',
  description: '',
  color: '#1B6CA8',
  isActive: true,
};

export default function TicketCategoriesAdminPage() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = async () => {
    setLoading(true);
    try {
      setCategories(await ticketCategoryService.list(false));
    } catch (err: any) {
      toast.error(err?.message || 'Kategorien konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (cat: TicketCategory) => {
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
      toast.error(err?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('Diese Kategorie wirklich löschen?')) return;
    try {
      await ticketCategoryService.remove(id);
      toast.success('Kategorie gelöscht.');
      if (editingId === id) resetForm();
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Löschen fehlgeschlagen.');
    }
  };

  const move = async (cat: TicketCategory, direction: -1 | 1) => {
    const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
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
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#fafafa]">
      <div className="p-8 max-w-5xl mx-auto space-y-8 pb-20">
<div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E8F1F8] flex items-center justify-center">
            <FolderTree className="w-5 h-5 text-[#1B6CA8]" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#0B1F3A] tracking-tight">
              {t('ticketCategories.adminTitle', 'Ticket-Kategorien')}
            </h1>
            <p className="text-sm text-slate-500">
              {t(
                'ticketCategories.adminDesc',
                'Kategorien erstellen, umbenennen, farblich markieren, sortieren oder deaktivieren.',
              )}
            </p>
          </div>
        </div>

        <Card className="rounded-[2rem] shadow-sm border-slate-200">
          <CardHeader>
            <CardTitle>{editingId ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</CardTitle>
            <CardDescription>
              Aktive Kategorien erscheinen im Ticket-Dropdown und in den Filtern.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="z. B. First Level Support"
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Farbe</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className="w-12 h-10 p-1 rounded-xl"
                    />
                    <Input
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className="rounded-xl"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Beschreibung</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="rounded-xl min-h-[72px]"
                />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#0B1F3A]">Aktiv</p>
                  <p className="text-xs text-slate-500">Deaktivierte Kategorien sind im Dropdown ausgeblendet.</p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
                >
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : editingId ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
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
            Vorhandene Kategorien ({categories.length})
          </div>
          {loading ? (
            <div className="p-12 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : categories.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-500">Noch keine Kategorien vorhanden.</p>
          ) : (
            <div className="divide-y">
              {categories.map((cat) => (
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
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[#0B1F3A]">{cat.name}</p>
                      {!cat.isActive && (
                        <Badge className="bg-slate-100 text-slate-600 border-none text-[9px]">Inaktiv</Badge>
                      )}
                      <Badge
                        className="border-none text-[9px] text-white"
                        style={{ backgroundColor: cat.color }}
                      >
                        {cat.slug}
                      </Badge>
                    </div>
                    {cat.description && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">{cat.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => void move(cat, -1)}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => void move(cat, 1)}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => startEdit(cat)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-red-600"
                      onClick={() => void onDelete(cat.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
