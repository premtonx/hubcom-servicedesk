import { AlertTriangle, CheckCircle2, Database, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '../../../ui/badge';
import { Button } from '../../../ui/button';
import { cn } from '../../../../lib/utils';
import type { IndexProgress } from './ragTypes';

export function RagMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 py-2 px-1 text-center min-w-0">
      <div className="text-lg font-black text-slate-800 truncate">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

export function RagSourceStatusCard({
  title,
  total,
  indexed,
  chunks,
  missing,
  kind,
  onIndexPending,
  backfilling,
  progress,
  indexingBlocked,
}: {
  title: string;
  total: number;
  indexed: number;
  chunks: number;
  missing: number;
  kind: 'kb' | 'ticket';
  onIndexPending: () => void;
  backfilling: boolean;
  progress: IndexProgress | null;
  /** When embedding endpoint is down, do not imply success via enabled “synced” CTA alone. */
  indexingBlocked?: boolean;
}) {
  const syncedLabel =
    kind === 'kb' ? '✓ Alle Artikel synchronisiert' : '✓ Alle Tickets synchronisiert';
  const actionLabel =
    missing === 0 && !backfilling
      ? syncedLabel
      : backfilling
        ? `⏳ Indexierung läuft... (${progress?.completed ?? 0}/${progress?.enqueued || missing} in Bearbeitung)`
        : `⚡ Jetzt in RAG indexieren (${missing} ausstehend)`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Database className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden />
          <h3 className="text-sm font-black text-slate-900 truncate">{title}</h3>
        </div>
        <Badge
          className={cn(
            'text-[10px] font-bold uppercase shrink-0',
            missing === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
          )}
        >
          {missing === 0 ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" aria-hidden /> Vollständig
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden /> {missing} offen
            </span>
          )}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <RagMetric label="Quellen" value={indexed} />
        <RagMetric label="Chunks" value={chunks} />
        <RagMetric label="Total" value={total} />
      </div>
      <Button
        variant={missing === 0 && !backfilling ? 'secondary' : 'outline'}
        size="sm"
        className="w-full focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={onIndexPending}
        disabled={backfilling || missing === 0}
        title={
          indexingBlocked && missing > 0
            ? 'Embedding-Endpunkt prüfen — Indexierung kann fehlschlagen'
            : undefined
        }
      >
        {backfilling ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="w-3.5 h-3.5" aria-hidden />
        )}
        {actionLabel}
      </Button>
      {progress?.message ? (
        <p className="text-[11px] text-slate-500 font-medium" aria-live="polite">
          {progress.message}
          {backfilling && progress.queueDepth > 0 ? ` · Queue ${progress.queueDepth}` : ''}
        </p>
      ) : null}
    </div>
  );
}
