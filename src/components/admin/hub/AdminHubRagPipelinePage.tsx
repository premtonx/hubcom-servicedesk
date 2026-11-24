import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { useTranslation } from '../../../lib/context/I18nContext';
import { RagEmbeddingAlert } from './rag/RagEmbeddingAlert';
import { RagMetric, RagSourceStatusCard } from './rag/RagStatusCards';
import {
  EMBEDDING_UNREACHABLE_SUMMARY,
  isEmbeddingUnreachableMessage,
  type IndexProgress,
  type RagStatus,
} from './rag/ragTypes';

/**
 * Dedicated RAG pipeline status view nested under Admin-Hub layout.
 * Uses GET /api/rag/status and POST /api/rag/index-pending — no fabricated data.
 */
export default function AdminHubRagPipelinePage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState<'kb' | 'ticket' | null>(null);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await axios.get('/api/rag/status');
      setStatus(res.data as RagStatus);
      setLoadError(null);
      return res.data as RagStatus;
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : String(err);
      setLoadError(message || 'RAG-Status konnte nicht geladen werden.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const runIndexPending = async (type: 'kb' | 'ticket') => {
    setBackfilling(type);
    setIndexError(null);
    const initialMissing =
      type === 'kb'
        ? (status?.kb.missingIndexArticles ?? 0)
        : (status?.tickets.missingIndexTickets ?? 0);
    setIndexProgress({
      type,
      enqueued: 0,
      completed: 0,
      queueDepth: 0,
      missing: initialMissing,
      message: 'Warteschlange wird gefüllt…',
    });
    try {
      const res = await axios.post('/api/rag/index-pending', { type });
      const enqueued = Number(res.data.enqueued || 0);
      setIndexProgress({
        type,
        enqueued,
        completed: 0,
        queueDepth: Number(res.data.queueDepth || 0),
        missing: Math.max(enqueued, initialMissing),
        message:
          enqueued === 0
            ? '✓ Alle Quellen synchronisiert'
            : `⏳ Indexierung läuft... (0/${enqueued} in Bearbeitung)`,
      });

      if (enqueued === 0) {
        setBackfilling(null);
        await loadStatus();
        return;
      }

      const started = Date.now();
      while (Date.now() - started < 90_000) {
        await new Promise((r) => window.setTimeout(r, 2_000));
        const next = await loadStatus();
        if (!next) break;
        const missing =
          type === 'kb' ? next.kb.missingIndexArticles : next.tickets.missingIndexTickets;
        const depth = next.queueDepth ?? 0;
        const completed = Math.max(enqueued - missing, 0);
        const failure =
          next.embeddingError ||
          next.recentFailures?.find((f) => f.lastError)?.lastError ||
          null;
        const unreachable = isEmbeddingUnreachableMessage(failure);

        setIndexProgress({
          type,
          enqueued,
          completed,
          queueDepth: depth,
          missing,
          error: unreachable ? failure : null,
          message:
            missing === 0
              ? '✓ Alle Quellen synchronisiert'
              : `⏳ Indexierung läuft... (${completed}/${enqueued} in Bearbeitung)`,
        });

        if (unreachable) {
          setIndexError(EMBEDDING_UNREACHABLE_SUMMARY);
        }

        if (missing === 0) break;
        if (depth === 0 && missing > 0 && Date.now() - started > 8_000) {
          setIndexError(failure || EMBEDDING_UNREACHABLE_SUMMARY);
          break;
        }
      }
      await loadStatus();
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : String(err);
      setIndexError(message || EMBEDDING_UNREACHABLE_SUMMARY);
      setIndexProgress({
        type,
        enqueued: 0,
        completed: 0,
        queueDepth: 0,
        missing: 0,
        message: 'Indexierung fehlgeschlagen.',
        error: 'failed',
      });
    } finally {
      setBackfilling(null);
    }
  };

  const kb = status?.kb;
  const tickets = status?.tickets;
  const embeddingBlocked = Boolean(status?.embeddingError || indexError);

  return (
    <div className="p-4 sm:p-6 lg:p-8 pb-20 max-w-5xl w-full space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-black text-slate-900">
            {t('admin.rag.pipelineTitle', 'RAG Pipeline Status')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              'admin.rag.pipelineSubtitle',
              'Indexierte Quellen, Chunks, Warteschlange und fehlgeschlagene Embedding-Jobs.',
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            void loadStatus();
          }}
          className="focus-visible:ring-2 focus-visible:ring-primary/40 shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          Aktualisieren
        </Button>
      </div>

      {indexError || status?.embeddingError ? (
        <RagEmbeddingAlert
          summary={indexError || EMBEDDING_UNREACHABLE_SUMMARY}
          detail={status?.embeddingError}
        />
      ) : null}

      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert">
          <p className="font-bold">Status konnte nicht geladen werden</p>
          <p className="text-[11px] mt-1 break-words font-mono">{loadError}</p>
        </div>
      ) : null}

      {loading && !status ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          Lade Pipeline-Status…
        </div>
      ) : status ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <RagMetric label="Queue" value={status.queueDepth} />
            <RagMetric label="KB Chunks" value={kb?.indexedChunks ?? 0} />
            <RagMetric label="Ticket Chunks" value={tickets?.indexedChunks ?? 0} />
            <RagMetric
              label="Tenant"
              value={String(status.tenantId || '—').slice(0, 12)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RagSourceStatusCard
              title={t('admin.rag.kbTitle', 'Wissensbasis-Artikel')}
              total={kb?.publishedArticles ?? 0}
              indexed={kb?.indexedArticles ?? 0}
              chunks={kb?.indexedChunks ?? 0}
              missing={kb?.missingIndexArticles ?? 0}
              kind="kb"
              onIndexPending={() => void runIndexPending('kb')}
              backfilling={backfilling === 'kb'}
              progress={indexProgress?.type === 'kb' ? indexProgress : null}
              indexingBlocked={embeddingBlocked}
            />
            <RagSourceStatusCard
              title={t('admin.rag.ticketsTitle', 'Gelöste Tickets')}
              total={tickets?.totalResolvedClosed ?? 0}
              indexed={tickets?.indexedTickets ?? 0}
              chunks={tickets?.indexedChunks ?? 0}
              missing={tickets?.missingIndexTickets ?? 0}
              kind="ticket"
              onIndexPending={() => void runIndexPending('ticket')}
              backfilling={backfilling === 'ticket'}
              progress={indexProgress?.type === 'ticket' ? indexProgress : null}
              indexingBlocked={embeddingBlocked}
            />
          </div>

          {(status.sampledMissingKb?.length || status.sampledMissingTickets?.length) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
                Ausstehende Quellen (Stichprobe)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 mb-1">KB ohne Index</p>
                  {status.sampledMissingKb?.length ? (
                    <ul className="space-y-1 font-mono text-slate-500 break-all">
                      {status.sampledMissingKb.map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">Keine</p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-slate-700 mb-1">Tickets ohne Index</p>
                  {status.sampledMissingTickets?.length ? (
                    <ul className="space-y-1 font-mono text-slate-500 break-all">
                      {status.sampledMissingTickets.map((id) => (
                        <li key={id}>{id}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400">Keine</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
              Kürzliche Job-Fehler
            </h2>
            {!status.recentFailures?.length ? (
              <p className="text-sm text-slate-500">Keine kürzlichen VECTOR-Job-Fehler gemeldet.</p>
            ) : (
              <ul className="space-y-2">
                {status.recentFailures.map((job) => (
                  <li
                    key={job.id}
                    className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-[11px] min-w-0"
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge className="text-[9px] font-bold uppercase">{job.jobType}</Badge>
                      <span className="text-slate-400 font-mono truncate">{job.id}</span>
                      <span className="text-slate-400 ml-auto shrink-0">
                        {job.updatedAt ? new Date(job.updatedAt).toLocaleString() : ''}
                      </span>
                    </div>
                    <p className="text-rose-700 break-words whitespace-pre-wrap">
                      {job.lastError || 'Kein Fehlertext'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
