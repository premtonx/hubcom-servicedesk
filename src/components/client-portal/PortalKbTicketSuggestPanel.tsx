/**
 * Live KB deflection suggestions under ticket create subject field.
 */

import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import {
  clientPortalApi,
  type PortalKbSuggestHit,
} from '../../services/clientPortalApi';

type Props = {
  subject: string;
  descriptionPlain?: string;
  className?: string;
  onResolved?: () => void;
};

function openArticlePreview(id: string) {
  const url = `/portal/kb/${encodeURIComponent(id)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function PortalKbTicketSuggestPanel({
  subject,
  descriptionPlain = '',
  className,
  onResolved,
}: Props) {
  const [hits, setHits] = useState<PortalKbSuggestHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const query = `${subject} ${descriptionPlain}`.trim();

  useEffect(() => {
    setDismissed(false);
  }, [subject]);

  useEffect(() => {
    if (query.trim().length < 4) {
      setHits([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void clientPortalApi
        .suggestKbArticles(query)
        .then((articles) => {
          if (!active) return;
          setHits(articles);
        })
        .catch(() => {
          if (!active) return;
          setHits([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  if (dismissed) return null;
  if (!loading && hits.length === 0) return null;

  const markResolved = async (id: string) => {
    setResolvingId(id);
    try {
      await clientPortalApi.markKbDeflected(id);
      onResolved?.();
    } catch {
      /* still allow leaving the form */
      onResolved?.();
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 space-y-2.5',
        className,
      )}
      role="region"
      aria-label="Mögliche Lösungen aus Ihrer Wissensdatenbank"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-sky-700 shrink-0" />
          <p className="text-xs font-black text-sky-900 uppercase tracking-wide">
            Mögliche Lösungen aus Ihrer Wissensdatenbank
          </p>
        </div>
        <button
          type="button"
          className="text-sky-500 hover:text-sky-800 p-0.5"
          onClick={() => setDismissed(true)}
          aria-label="Vorschläge ausblenden"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading && hits.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-sky-700 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Passende Artikel werden gesucht…
        </div>
      ) : (
        <ul className="space-y-1.5">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => openArticlePreview(hit.id)}
                className="w-full text-left rounded-lg border border-sky-100 bg-white px-3 py-2.5 hover:border-sky-300 hover:bg-sky-50/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{hit.title}</p>
                    {hit.category_name ? (
                      <p className="text-[10px] font-semibold text-sky-700 mt-0.5">
                        {hit.category_name}
                      </p>
                    ) : null}
                    {hit.snippet ? (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{hit.snippet}</p>
                    ) : null}
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hits.length > 0 ? (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto text-xs border-emerald-200 text-emerald-800 hover:bg-emerald-50"
            disabled={Boolean(resolvingId)}
            onClick={() => void markResolved(hits[0].id)}
          >
            {resolvingId ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            )}
            Das hat mein Problem gelöst
          </Button>
        </div>
      ) : null}
    </div>
  );
}
