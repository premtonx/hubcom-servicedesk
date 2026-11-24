import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { EMBEDDING_UNREACHABLE_SUMMARY } from './ragTypes';

interface RagEmbeddingAlertProps {
  /** Short user-facing summary (preferred). */
  summary?: string | null;
  /** Full technical / diagnostic message from the API or job failure. */
  detail?: string | null;
}

/**
 * Prominent embedding-endpoint warning with expandable diagnostics.
 * Does not claim indexing/retrieval success while the endpoint is down.
 */
export function RagEmbeddingAlert({ summary, detail }: RagEmbeddingAlertProps) {
  const userSummary = (summary || EMBEDDING_UNREACHABLE_SUMMARY).trim();
  const technical = (detail || '').trim();
  const showExpand = Boolean(technical && technical !== userSummary && technical.length > 120);
  const [open, setOpen] = useState(false);

  if (!userSummary && !technical) return null;

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="font-bold leading-snug">{userSummary}</p>
            <p className="text-[11px] text-amber-900/80 mt-1">
              Indexierung und Ähnlichkeitssuche können fehlschlagen, solange der Embedding-Endpunkt
              nicht erreichbar ist. Prüfen Sie den Modell-Server bzw. API-Key und die
              Endpunkt-Erreichbarkeit.
            </p>
          </div>

          {technical && !showExpand ? (
            <pre className="text-[11px] font-mono text-amber-900/90 whitespace-pre-wrap break-words bg-amber-100/60 border border-amber-200/80 rounded-lg px-3 py-2 max-h-40 overflow-y-auto">
              {technical}
            </pre>
          ) : null}

          {showExpand ? (
            <div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-amber-800 hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 rounded"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
              >
                {open ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                )}
                {open ? 'Diagnosedetails ausblenden' : 'Diagnosedetails anzeigen'}
              </button>
              {open ? (
                <pre className="mt-2 text-[11px] font-mono text-amber-900/90 whitespace-pre-wrap break-words bg-amber-100/60 border border-amber-200/80 rounded-lg px-3 py-2 max-h-56 overflow-y-auto">
                  {technical}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
