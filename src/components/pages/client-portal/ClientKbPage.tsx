import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { cn } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { sanitizeTimelineHtml } from '../../../lib/sanitize-html';

type KbArticle = {
  id: string;
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  visibility: string;
  organizationId?: string | null;
  updatedAt?: string;
  createdAt?: string;
};

type ScopeTab = 'all' | 'organization' | 'shared_portal';

const SCOPE_TABS: Array<{ id: ScopeTab; label: string }> = [
  { id: 'all', label: 'Alle Artikel' },
  { id: 'organization', label: 'Firmen-Anleitungen' },
  { id: 'shared_portal', label: 'Hubcom Guides' },
];

export default function ClientKbPage() {
  const { isOrgWide } = useClientPortalSession();
  const canWrite = isOrgWide; // CLIENT_ADMIN | CLIENT_SUPPORTER
  const [articles, setArticles] = useState<KbArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<ScopeTab>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftCategory, setDraftCategory] = useState('Allgemein');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/portal/kb', {
        params: { scope, q: search || undefined },
        withCredentials: true,
      });
      setArticles(Array.isArray(res.data?.articles) ? res.data.articles : []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Wissensdatenbank konnte nicht geladen werden.');
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, [scope, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of articles) {
      if (a.category) set.add(String(a.category));
    }
    return ['all', ...Array.from(set).sort()];
  }, [articles]);

  const filtered = useMemo(() => {
    if (category === 'all') return articles;
    return articles.filter(
      (a) => String(a.category || '').toLowerCase() === category.toLowerCase(),
    );
  }, [articles, category]);

  const selected = filtered.find((a) => a.id === selectedId) || null;

  const createArticle = async () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      toast.error('Titel und Inhalt sind erforderlich.');
      return;
    }
    setSaving(true);
    try {
      const res = await axios.post(
        '/api/portal/kb',
        {
          title: draftTitle.trim(),
          content: draftContent.trim().replace(/\n/g, '<br/>'),
          category: draftCategory.trim() || 'Allgemein',
        },
        { withCredentials: true },
      );
      toast.success('Artikel veröffentlicht.');
      setComposerOpen(false);
      setDraftTitle('');
      setDraftContent('');
      setDraftCategory('Allgemein');
      await load();
      if (res.data?.article?.id) setSelectedId(res.data.article.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Artikel konnte nicht erstellt werden.');
    } finally {
      setSaving(false);
    }
  };

  const deleteArticle = async (id: string) => {
    if (!confirm('Artikel wirklich löschen?')) return;
    try {
      await axios.delete(`/api/portal/kb/${encodeURIComponent(id)}`, { withCredentials: true });
      toast.success('Artikel gelöscht.');
      if (selectedId === id) setSelectedId(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#F8F9FA]">
      <div className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4 pb-20">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">Wissensdatenbank</h1>
              <p className="text-sm text-slate-500 font-medium">
                Firmen-Anleitungen und Hubcom Guides
              </p>
            </div>
          </div>
          {canWrite ? (
            <Button
              className="h-9 rounded-xl gap-1.5 bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold"
              onClick={() => setComposerOpen(true)}
            >
              <Plus className="w-4 h-4" />
              Neuer Artikel
            </Button>
          ) : null}
        </header>

        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 pb-0">
          {SCOPE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setScope(tab.id);
                setSelectedId(null);
              }}
              className={cn(
                'px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors',
                scope === tab.id
                  ? 'border-[#1B6CA8] text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="h-12 flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl px-3">
          <div className="relative flex-1 min-w-[160px] max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Suchen…"
              className="h-8 pl-8 text-xs bg-slate-50/80 border-slate-200/80 rounded-md"
            />
          </div>
          <select
            className="h-8 text-xs font-medium border border-slate-200 rounded-md px-2 bg-slate-50"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Kategorie"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'Alle Kategorien' : c}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm min-h-[24rem]">
            {loading ? (
              <div className="py-16 text-center text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                Artikel werden geladen…
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-sm">Keine Artikel gefunden.</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors',
                        selectedId === a.id && 'bg-sky-50/80',
                      )}
                    >
                      <p className="text-sm font-bold text-slate-900 line-clamp-1">{a.title}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                        {a.visibility === 'shared_portal' ? 'Hubcom Guide' : 'Firmen-Anleitung'}
                        {a.category ? ` · ${a.category}` : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl shadow-sm min-h-[24rem] p-5 sm:p-6">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-400 py-20">
                Artikel auswählen, um den Inhalt zu lesen.
              </div>
            ) : (
              <article className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl font-black tracking-tight text-slate-900">
                      {selected.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1 font-medium">
                      {selected.visibility === 'shared_portal' ? 'Hubcom Guide' : 'Firmen-Anleitung'}
                      {selected.category ? ` · ${selected.category}` : ''}
                    </p>
                  </div>
                  {canWrite && selected.visibility === 'organization' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-rose-600 border-rose-200 hover:bg-rose-50"
                      onClick={() => void deleteArticle(selected.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Löschen
                    </Button>
                  ) : null}
                </div>
                <div
                  className="prose prose-sm max-w-none text-slate-700"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeTimelineHtml(selected.content || ''),
                  }}
                />
              </article>
            )}
          </div>
        </div>
      </div>

      {composerOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900">Neuer Firmen-Artikel</h3>
              <button type="button" onClick={() => setComposerOpen(false)} aria-label="Schließen">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Wird nur für Ihre Organisation veröffentlicht (nicht für andere Kunden).
            </p>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Titel</Label>
              <Input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Kategorie</Label>
              <Input value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold">Inhalt</Label>
              <textarea
                className="w-full min-h-[140px] rounded-xl border border-slate-200 p-3 text-sm"
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="Schritte, Hinweise, Links…"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setComposerOpen(false)}>
                Abbrechen
              </Button>
              <Button
                className="bg-[#1B6CA8] hover:bg-[#155a8a] text-white font-bold"
                disabled={saving}
                onClick={() => void createArticle()}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Veröffentlichen
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
