/**
 * Portal-safe KI-Assistent — uses /api/portal/kb/ai-ask + ai-generate only.
 * Replaces staff KBAutopilotDashboard inside KnowledgeBaseWorkbench portal mode.
 */

import { useState } from 'react';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import type { KbWorkbenchAdapter } from '../../lib/kb/kb-workbench-adapter';

type Props = {
  adapter: KbWorkbenchAdapter;
  canGenerate: boolean;
  onApplyGenerated?: (article: { title: string; content: string }) => void;
  onBackToKb?: () => void;
};

export function PortalKbAiAssistantPanel({
  adapter,
  canGenerate,
  onApplyGenerated,
  onBackToKb,
}: Props) {
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ title: string; content: string } | null>(null);

  const handleAsk = async () => {
    const q = askQuery.trim();
    if (!q || !adapter.askPortalAi) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const result = await adapter.askPortalAi(q);
      setAskAnswer(result.answer);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'KI-Suche fehlgeschlagen.');
    } finally {
      setAskLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate || !adapter.generatePortalArticle || !subject.trim()) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const result = await adapter.generatePortalArticle({
        subject: subject.trim(),
        description: description.trim(),
      });
      setGenerated(result);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'KI-Generierung fehlgeschlagen.');
    } finally {
      setGenLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            KI-Assistent
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Fragen Sie Ihre Organisations-Dokumentation oder generieren Sie einen Artikelentwurf.
          </p>
        </div>
        {onBackToKb ? (
          <Button type="button" variant="outline" size="sm" onClick={onBackToKb}>
            Zurück
          </Button>
        ) : null}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Hubcom KI fragen
        </h3>
        <Textarea
          value={askQuery}
          onChange={(e) => setAskQuery(e.target.value)}
          placeholder="Hubcom KI fragen oder Dokumentation durchsuchen…"
          rows={3}
        />
        <Button type="button" onClick={() => void handleAsk()} disabled={askLoading || !askQuery.trim()}>
          {askLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
          Fragen
        </Button>
        {askError ? <p className="text-sm text-rose-600">{askError}</p> : null}
        {askAnswer ? (
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-700 whitespace-pre-wrap">
            {askAnswer}
          </div>
        ) : null}
      </section>

      {canGenerate ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <Wand2 className="w-3.5 h-3.5" />
            KI generieren
          </h3>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Thema / Titel"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Kurzbeschreibung oder Ticket-Kontext (optional)"
            rows={4}
          />
          <Button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={genLoading || !subject.trim()}
          >
            {genLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
            Artikel entwerfen
          </Button>
          {genError ? <p className="text-sm text-rose-600">{genError}</p> : null}
          {generated ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4">
                <p className="text-sm font-bold text-slate-900">{generated.title}</p>
                <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap max-h-64 overflow-auto">
                  {generated.content}
                </div>
              </div>
              {onApplyGenerated ? (
                <Button type="button" onClick={() => onApplyGenerated(generated)}>
                  Im Editor öffnen
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
