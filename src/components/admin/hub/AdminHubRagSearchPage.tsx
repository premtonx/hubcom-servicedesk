import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, Search } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { useTranslation } from '../../../lib/context/I18nContext';
import { RagEmbeddingAlert } from './rag/RagEmbeddingAlert';
import {
  EMBEDDING_UNREACHABLE_SUMMARY,
  isEmbeddingUnreachableMessage,
  type RagSearchHit,
  type RagStatus,
} from './rag/ragTypes';

/**
 * Dedicated similarity-search test nested under Admin-Hub.
 * Calls POST /api/rag/search only — never fabricates hits.
 */
export default function AdminHubRagSearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RagSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [minSimilarity] = useState(0.65);

  const loadStatus = useCallback(async () => {
    try {
      const res = await axios.get('/api/rag/status');
      setStatus(res.data as RagStatus);
    } catch {
      /* status banner is optional for search page */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setSearchError('Bitte eine Suchanfrage eingeben.');
      setHits(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setHits(null);
    try {
      const res = await axios.post('/api/rag/search', {
        query: q,
        limit: 8,
        minSimilarity,
      });
      setHits(Array.isArray(res.data?.hits) ? res.data.hits : []);
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : String(err);
      setSearchError(message || 'Ähnlichkeitssuche fehlgeschlagen.');
      setHits(null);
    } finally {
      setSearching(false);
    }
  };

  const embeddingDetail = status?.embeddingError || null;
  const showEmbeddingAlert =
    Boolean(embeddingDetail) || isEmbeddingUnreachableMessage(searchError);

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 max-w-5xl w-full space-y-6 min-w-0">
      <div className="min-w-0">
        <h1 className="text-lg font-black text-slate-900">
          {t('admin.rag.searchTitle', 'Similarity Search Test')}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {t(
            'admin.rag.searchSubtitle',
            'End-to-End-Abfrage gegen den Vektorspeicher (cosine ≥ Schwellwert).',
          )}
        </p>
      </div>

      {showEmbeddingAlert ? (
        <RagEmbeddingAlert
          summary={
            isEmbeddingUnreachableMessage(searchError)
              ? EMBEDDING_UNREACHABLE_SUMMARY
              : embeddingDetail
                ? EMBEDDING_UNREACHABLE_SUMMARY
                : null
          }
          detail={embeddingDetail || searchError}
        />
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Search className="w-3.5 h-3.5 text-blue-600" aria-hidden />
          {t('admin.rag.searchTest', 'Ähnlichkeitssuche (End-to-End)')}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="z. B. Passwort zurücksetzen"
            aria-label={t('admin.rag.searchQuery', 'Suchanfrage')}
            className="focus-visible:ring-2 focus-visible:ring-primary/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
          />
          <Button
            size="sm"
            onClick={() => void runSearch()}
            disabled={searching}
            className="shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {searching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="w-3.5 h-3.5" aria-hidden />
            )}
            Suchen
          </Button>
        </div>

        {searchError && !isEmbeddingUnreachableMessage(searchError) ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900" role="alert">
            <p className="font-bold text-xs">Suche fehlgeschlagen</p>
            <p className="text-[11px] mt-1 break-words font-mono">{searchError}</p>
          </div>
        ) : null}

        {searching ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            Suche läuft…
          </div>
        ) : null}

        {hits !== null && !searching ? (
          <div className="space-y-2" aria-live="polite">
            <p className="text-[11px] text-slate-500">
              {hits.length} Treffer (cosine ≥ {minSimilarity}) — Workspace-
              {status?.tenantId || 'default'} (
              <span className="font-semibold text-emerald-600">tenant-isoliert</span>)
            </p>
            {hits.length === 0 ? (
              <p className="text-[11px] text-slate-400 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center">
                Keine Treffer für diese Anfrage. Indexierung und Embedding-Endpunkt prüfen.
              </p>
            ) : (
              hits.map((hit, i) => (
                <div
                  key={hit.id || `${hit.sourceId}-${i}`}
                  className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 min-w-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-700 truncate">
                      {hit.title || hit.sourceId || 'Untitled'}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {typeof hit.similarityScore === 'number' ? (
                        <Badge className="text-[10px] font-bold bg-emerald-50 text-emerald-700">
                          {(hit.similarityScore * 100).toFixed(1)}%
                        </Badge>
                      ) : null}
                      <Badge className="text-[10px] font-bold uppercase">
                        {hit.sourceType === 'RESOLVED_TICKET' || hit.sourceType === 'resolved_ticket'
                          ? 'Ticket'
                          : 'KB'}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 break-words">
                    {String(hit.content || hit.chunkContent || '').slice(0, 320) ||
                      'Kein Ausschnitt geliefert.'}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
