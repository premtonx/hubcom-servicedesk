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
import {
  ticketConfigService,
  type PriorityWithUsage,
} from '../../../services/ticketConfigService';
import { RECOMMENDED_PRIORITY_COLORS } from '../../../lib/ticket-config/types';
import { cn } from '../../../lib/utils';
import { ReplacementDialog } from './ReplacementDialog';
import { SurfaceHint } from './SurfaceHint';

const EMPTY = {
  name: '',
  description: '',
  color: RECOMMENDED_PRIORITY_COLORS.medium,
  isActive: true,
};

export function PrioritiesSection() {
  const [items, setItems] = useState<PriorityWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: PriorityWithUsage;
  } | null>(null);
  const [replacementKey, setReplacementKey] = useState('');

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

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY);
  };

  const startEdit = (row: PriorityWithUsage) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description,
      color: row.color,
      isActive: row.isActive,
    });
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

  return (
    <div className="space-y-6">
      <SurfaceHint text="Prioritäten erscheinen in Ticketformularen, Filtern, der Ticketliste und der Detail-Sidebar. Die Reihenfolge unten läuft von niedrigster zu höchster Priorität. Farben dienen der Anzeige — sie ändern keine SLA-Regeln." />

      <Card className="rounded-[2rem] shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle>{editingId ? 'Priorität bearbeiten' : 'Neue Priorität'}</CardTitle>
          <CardDescription>
            Empfohlene Farben: Low grau, Medium blau, High orange, Urgent rot.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="pr-name">Name</Label>
                <Input
                  id="pr-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="z. B. Medium"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-color">Farbe</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="pr-color"
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-12 h-10 p-1 rounded-xl"
                    aria-label="Prioritätsfarbe"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="rounded-xl font-mono text-xs"
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
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50"
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
            <div className="space-y-1.5">
              <Label htmlFor="pr-desc">Beschreibung</Label>
              <Textarea
                id="pr-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-xl min-h-[64px]"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <div>
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
                {editingId ? 'Speichern' : 'Priorität anlegen'}
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
        <div className="px-5 py-3 border-b bg-slate-50/80 flex items-center justify-between gap-3">
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
            {sorted.map((row, index) => (
              <div
                key={row.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60',
                  editingId === row.id && 'bg-[#E8F1F8]/40',
                )}
              >
                <span
                  className="text-[10px] font-black text-slate-400 w-6 tabular-nums"
                  title="Rang (1 = niedrigste)"
                >
                  {index + 1}
                </span>
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5"
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
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{row.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Niedriger einstufen" onClick={() => void move(row, -1)}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Höher einstufen" onClick={() => void move(row, 1)}>
                    <ArrowDown className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Bearbeiten" onClick={() => startEdit(row)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600" aria-label="Löschen" onClick={() => void onDelete(row)}>
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
