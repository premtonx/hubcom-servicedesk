import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { cn } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';

type VaultSecret = {
  id: string;
  name: string;
  category: string;
  notes?: string | null;
  masked_value: string;
  client_visible: boolean;
  updated_at?: string;
};

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Alle Typen' },
  { id: 'password', label: 'Passwort' },
  { id: 'api_key', label: 'API-Schlüssel' },
  { id: 'certificate', label: 'Zertifikat' },
  { id: 'license', label: 'Lizenz' },
  { id: 'note', label: 'Notiz' },
];

function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label || id;
}

export default function ClientVaultPage() {
  const { isOrgWide, isClientAdmin, loading: sessionLoading } = useClientPortalSession();
  const [secrets, setSecrets] = useState<VaultSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<VaultSecret | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState('password');
  const [draftValue, setDraftValue] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/portal/vault', {
        params: {
          q: search || undefined,
          category: category !== 'all' ? category : undefined,
        },
        withCredentials: true,
      });
      setSecrets(Array.isArray(res.data?.secrets) ? res.data.secrets : []);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        toast.error('Kein Zugriff auf den Tresor.');
      } else {
        toast.error(err?.response?.data?.error || 'Tresor konnte nicht geladen werden.');
      }
      setSecrets([]);
    } finally {
      setLoading(false);
    }
  }, [search, category]);

  useEffect(() => {
    if (!isOrgWide) return;
    void load();
  }, [isOrgWide, load]);

  const filtered = useMemo(() => secrets, [secrets]);

  if (sessionLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm p-12">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Laden…
      </div>
    );
  }

  // CLIENT_USER (and any non org-wide role) must never see Tresor.
  if (!isOrgWide) {
    return <Navigate to="/portal/dashboard" replace />;
  }

  const openCreate = () => {
    setEditing(null);
    setDraftName('');
    setDraftCategory('password');
    setDraftValue('');
    setDraftNotes('');
    setComposerOpen(true);
  };

  const openEdit = (secret: VaultSecret) => {
    setEditing(secret);
    setDraftName(secret.name);
    setDraftCategory(secret.category || 'password');
    setDraftValue('');
    setDraftNotes(secret.notes || '');
    setComposerOpen(true);
  };

  const save = async () => {
    if (!draftName.trim()) {
      toast.error('Bezeichnung ist erforderlich.');
      return;
    }
    if (!editing && !draftValue.trim()) {
      toast.error('Geheimniswert ist erforderlich.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await axios.patch(
          `/api/portal/vault/${encodeURIComponent(editing.id)}`,
          {
            name: draftName.trim(),
            category: draftCategory,
            notes: draftNotes.trim() || null,
            ...(draftValue.trim() ? { value: draftValue } : {}),
          },
          { withCredentials: true },
        );
        toast.success('Eintrag aktualisiert.');
      } else {
        await axios.post(
          '/api/portal/vault',
          {
            name: draftName.trim(),
            category: draftCategory,
            notes: draftNotes.trim() || null,
            value: draftValue,
          },
          { withCredentials: true },
        );
        toast.success('Eintrag erstellt.');
      }
      setComposerOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const reveal = async (id: string, purpose: 'reveal' | 'copy' = 'reveal') => {
    try {
      const res = await axios.post(
        `/api/portal/vault/${encodeURIComponent(id)}/reveal`,
        { purpose },
        { withCredentials: true },
      );
      const value = String(res.data?.value || '');
      if (purpose === 'copy') {
        await navigator.clipboard.writeText(value);
        toast.success('In Zwischenablage kopiert.');
      } else {
        setRevealed((prev) => ({ ...prev, [id]: value }));
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Anzeigen fehlgeschlagen.');
    }
  };

  const hide = (id: string) => {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const remove = async (id: string) => {
    if (!isClientAdmin) return;
    if (!confirm('Eintrag wirklich löschen?')) return;
    try {
      await axios.delete(`/api/portal/vault/${encodeURIComponent(id)}`, {
        withCredentials: true,
      });
      toast.success('Eintrag gelöscht.');
      hide(id);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#F8F9FA]">
      <div className="max-w-[1200px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4 pb-20">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">Tresor</h1>
              <p className="text-sm text-slate-500 font-medium">
                Firmeneigene Zugangsdaten — verschlüsselt gespeichert
              </p>
            </div>
          </div>
          <Button
            className="h-9 rounded-xl gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold"
            onClick={openCreate}
          >
            <Plus className="w-4 h-4" />
            Neuer Eintrag
          </Button>
        </header>

        <div className="flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3 text-xs font-semibold text-sky-900">
          <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0" />
          AES-256-GCM verschlüsselt · Nur für Ihr Unternehmen &amp; Hubcom Support sichtbar
        </div>

        <div className="h-12 flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl px-3">
          <div className="relative flex-1 min-w-[160px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="h-8 pl-8 text-xs bg-slate-50/80 border-slate-200/80 rounded-md"
              autoComplete="off"
            />
          </div>
          <select
            className="h-8 text-xs font-medium border border-slate-200 rounded-md px-2 bg-slate-50"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Typ"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              Tresor wird geladen…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">Keine Einträge.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100 bg-slate-50/80">
                    <th className="py-2.5 px-4 font-semibold">Bezeichnung</th>
                    <th className="py-2.5 px-3 font-semibold">Typ</th>
                    <th className="py-2.5 px-3 font-semibold">Wert</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((secret) => {
                    const shown = revealed[secret.id];
                    return (
                      <tr key={secret.id} className="border-b border-slate-50">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900">{secret.name}</p>
                          {secret.notes ? (
                            <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                              {secret.notes}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                            {categoryLabel(secret.category)}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-700">
                          {shown || secret.masked_value}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Anzeigen"
                              onClick={() =>
                                shown ? hide(secret.id) : void reveal(secret.id, 'reveal')
                              }
                            >
                              {shown ? (
                                <EyeOff className="w-3.5 h-3.5" />
                              ) : (
                                <Eye className="w-3.5 h-3.5" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-[#1B6CA8]"
                              title="Kopieren"
                              onClick={() => void reveal(secret.id, 'copy')}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title="Bearbeiten"
                              onClick={() => openEdit(secret)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {isClientAdmin ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-600"
                                title="Löschen"
                                onClick={() => void remove(secret.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">
                {editing ? 'Eintrag bearbeiten' : 'Neuer Tresor-Eintrag'}
              </h3>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label="Schließen">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Bezeichnung</Label>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoComplete="off"
                name="portal-vault-name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Typ</Label>
              <select
                className="w-full h-9 rounded-lg border border-slate-200 px-2 text-sm"
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
              >
                {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">
                Geheimniswert{editing ? ' (leer = unverändert)' : ''}
              </Label>
              <Input
                type="password"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                autoComplete="new-password"
                name="portal-vault-value"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Notiz (optional)</Label>
              <textarea
                className="w-full min-h-[80px] rounded-xl border border-slate-200 p-3 text-sm"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposerOpen(false)}>
                Abbrechen
              </Button>
              <Button
                className={cn('bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold')}
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Speichern
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
