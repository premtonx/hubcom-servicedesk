import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, AlertTriangle, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { Switch } from '../../ui/switch';
import { Badge } from '../../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import {
  ticketConfigService,
  type StatusWithUsage,
} from '../../../services/ticketConfigService';
import {
  STATUS_WORKFLOW_KINDS,
  statusColorConflictWarning,
  type StatusWorkflowKind,
} from '../../../lib/ticket-config/types';
import { cn } from '../../../lib/utils';
import { ReplacementDialog } from './ReplacementDialog';
import { SurfaceHint } from './SurfaceHint';

const EMPTY = {
  name: '',
  description: '',
  color: '#3B82F6',
  isActive: true,
  workflowKind: 'open' as StatusWorkflowKind,
};

const WORKFLOW_LABEL: Record<StatusWorkflowKind, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  closed: 'Closed / resolved',
};

export function StatusesSection() {
  const [items, setItems] = useState<StatusWithUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [colorAck, setColorAck] = useState(false);
  const [pending, setPending] = useState<{
    mode: 'deactivate' | 'delete';
    item: StatusWithUsage;
  } | null>(null);
  const [replacementKey, setReplacementKey] = useState('');

  const colorWarning = useMemo(
    () => statusColorConflictWarning(form.workflowKind, form.color),
    [form.workflowKind, form.color],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await ticketConfigService.listStatuses(false));
    } catch (err: any) {
      toast.error(err?.message || 'Statusliste konnte nicht geladen werden.');
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
    setColorAck(false);
  };

  const startEdit = (row: StatusWithUsage) => {
    setEditingId(row.id);
    setForm({
      name: row.name,
      description: row.description,
      color: row.color,
      isActive: row.isActive,
      workflowKind: row.workflowKind,
    });
    setColorAck(false);
  };

  const persist = async (extra?: { replacementKey?: string; isActive?: boolean }) => {
    const payload = {
      ...form,
      isActive: extra?.isActive ?? form.isActive,
      replacementKey: extra?.replacementKey,
    };
    if (editingId) {
      await ticketConfigService.updateStatus(editingId, payload);
      toast.success('Status aktualisiert.');
    } else {
      await ticketConfigService.createStatus(payload);
      toast.success('Status angelegt.');
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
    if (colorWarning && !colorAck) {
      toast.message('Bitte die Farbwarnung bestätigen oder die Farbe anpassen.');
      return;
    }
    if (editingId && !form.isActive) {
      const current = items.find((s) => s.id === editingId);
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
        const current = items.find((s) => s.id === editingId);
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
        await ticketConfigService.removeStatus(pending.item.id, replacementKey);
        toast.success('Status gelöscht und Tickets umgebucht.');
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

  const onDelete = async (row: StatusWithUsage) => {
    if ((row.usageCount || 0) > 0) {
      setPending({ mode: 'delete', item: row });
      setReplacementKey('');
      return;
    }
    if (!window.confirm(`Status „${row.name}“ wirklich löschen?`)) return;
    try {
      await ticketConfigService.removeStatus(row.id);
      toast.success('Status gelöscht.');
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

  const move = async (row: StatusWithUsage, direction: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((s) => s.id === row.id);
    const swap = sorted[idx + direction];
    if (!swap) return;
    try {
      await Promise.all([
        ticketConfigService.updateStatus(row.id, { sortOrder: swap.sortOrder }),
        ticketConfigService.updateStatus(swap.id, { sortOrder: row.sortOrder }),
      ]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Sortierung fehlgeschlagen.');
    }
  };

  return (
    <div className="space-y-6">
      <SurfaceHint text="Statuswerte steuern Ticketformulare, Listenfilter, Bulk-Aktionen und die Detail-Sidebar. Die Workflow-Bedeutung (Open / In progress / Waiting / Closed) bleibt unabhängig vom Anzeigenamen sichtbar." />

      <Card className="rounded-[2rem] shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle>{editingId ? 'Status bearbeiten' : 'Neuen Status anlegen'}</CardTitle>
          <CardDescription>
            Jeder Status braucht eine Workflow-Bedeutung — der Label-Text allein reicht nicht.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="st-name">Anzeigename</Label>
                <Input
                  id="st-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="z. B. Wartet auf Kunde"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-workflow">Workflow-Bedeutung</Label>
                <Select
                  value={form.workflowKind}
                  onValueChange={(v) => {
                    setForm((f) => ({ ...f, workflowKind: v as StatusWorkflowKind }));
                    setColorAck(false);
                  }}
                >
                  <SelectTrigger id="st-workflow" className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_WORKFLOW_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label} — {k.hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="st-desc">Beschreibung</Label>
                <Textarea
                  id="st-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="rounded-xl min-h-[64px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-color">Farbe</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="st-color"
                    type="color"
                    value={form.color}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, color: e.target.value }));
                      setColorAck(false);
                    }}
                    className="w-12 h-10 p-1 rounded-xl"
                    aria-label="Statusfarbe"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, color: e.target.value }));
                      setColorAck(false);
                    }}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>
            </div>
            {colorWarning && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                <div className="space-y-2 flex-1">
                  <p>{colorWarning}</p>
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colorAck}
                      onChange={(e) => setColorAck(e.target.checked)}
                      className="rounded border-amber-300"
                    />
                    Farbe trotzdem verwenden
                  </label>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-[#0B1F3A]">Aktiv</p>
                <p className="text-xs text-slate-500">
                  Inaktive Statuswerte erscheinen nicht in Auswahlfeldern.
                </p>
              </div>
              <Switch
                checked={form.isActive}
                onCheckedChange={(isActive) => setForm((f) => ({ ...f, isActive }))}
                aria-label="Status aktiv"
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
                {editingId ? 'Speichern' : 'Status anlegen'}
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
          Statusliste ({items.length})
        </div>
        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">
            Noch keine Statuswerte. Standardwerte werden beim Serverstart angelegt.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((row) => (
              <div
                key={row.id}
                className={cn(
                  'flex items-center gap-3 px-5 py-4 hover:bg-slate-50/60',
                  editingId === row.id && 'bg-[#E8F1F8]/40',
                )}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/5"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-[#0B1F3A]">{row.name}</p>
                    <Badge variant="outline" className="text-[9px] font-bold uppercase">
                      {WORKFLOW_LABEL[row.workflowKind]}
                    </Badge>
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
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{row.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Nach oben" onClick={() => void move(row, -1)}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Nach unten" onClick={() => void move(row, 1)}>
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
        title={pending?.mode === 'delete' ? 'Status löschen' : 'Status deaktivieren'}
        description={`„${pending?.item.name}“ (${WORKFLOW_LABEL[pending?.item.workflowKind || 'open']}) wird von Tickets verwendet. Wählen Sie einen Ersatzstatus — Tickets werden umgebucht, nicht gelöscht.`}
        usageCount={pending?.item.usageCount || 0}
        options={items
          .filter((s) => s.id !== pending?.item.id && s.isActive)
          .map((s) => ({ id: s.id, key: s.key, name: `${s.name} · ${WORKFLOW_LABEL[s.workflowKind]}` }))}
        value={replacementKey}
        onValueChange={setReplacementKey}
        onConfirm={() => void confirmPending()}
        busy={saving}
      />
    </div>
  );
}
