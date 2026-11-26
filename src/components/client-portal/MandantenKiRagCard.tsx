import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Loader2, RefreshCw, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '../../lib/utils';

export type OrgAiMode = 'global_default' | 'org_local_ai' | 'disabled';

export interface MandantenKiSettings {
  ai_mode: OrgAiMode;
  local_llm_endpoint: string;
  local_llm_model: string;
  local_embedding_endpoint: string;
  local_embedding_model: string;
  local_ai_api_key_set: boolean;
  strict_local_only: boolean;
  include_shared_kb_in_rag: boolean;
  last_embedding_model: string | null;
  needs_reindex: boolean;
}

interface MandantenKiRagCardProps {
  /** Staff Admin-Hub: organization id. Portal CLIENT_ADMIN: omit (session org). */
  organizationId?: string | null;
  mode: 'admin' | 'portal';
  className?: string;
  /** Optional org display name for reindex button label. */
  organizationName?: string | null;
}

const emptySettings = (): MandantenKiSettings => ({
  ai_mode: 'global_default',
  local_llm_endpoint: '',
  local_llm_model: 'llama3',
  local_embedding_endpoint: '',
  local_embedding_model: 'nomic-embed-text',
  local_ai_api_key_set: false,
  strict_local_only: true,
  include_shared_kb_in_rag: false,
  last_embedding_model: null,
  needs_reindex: false,
});

/**
 * Mandanten-KI & RAG (Lokal) — configure org-dedicated Ollama / OpenAI-compat AI.
 */
export function MandantenKiRagCard({
  organizationId,
  mode,
  className,
  organizationName,
}: MandantenKiRagCardProps) {
  const [settings, setSettings] = useState<MandantenKiSettings>(emptySettings());
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const basePath =
    mode === 'admin'
      ? `/api/admin/organizations/${encodeURIComponent(organizationId || '')}/ai-settings`
      : '/api/portal/ai-settings';

  const load = useCallback(async () => {
    if (mode === 'admin' && !organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await axios.get(basePath, { withCredentials: true });
      const next = res.data?.settings as MandantenKiSettings | undefined;
      if (next) setSettings({ ...emptySettings(), ...next });
      setApiKeyDraft('');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'KI-Einstellungen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [basePath, mode, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (mode === 'admin' && !organizationId) {
      toast.error('Organisation fehlt.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ai_mode: settings.ai_mode,
        local_llm_endpoint: settings.local_llm_endpoint,
        local_llm_model: settings.local_llm_model,
        local_embedding_endpoint: settings.local_embedding_endpoint,
        local_embedding_model: settings.local_embedding_model,
        strict_local_only: settings.strict_local_only,
        include_shared_kb_in_rag: settings.include_shared_kb_in_rag,
      };
      if (apiKeyDraft.trim()) {
        payload.local_ai_api_key = apiKeyDraft.trim();
      }
      const res = await axios.put(basePath, payload, { withCredentials: true });
      const next = res.data?.settings as MandantenKiSettings | undefined;
      if (next) setSettings({ ...emptySettings(), ...next });
      setApiKeyDraft('');
      toast.success('Mandanten-KI Einstellungen gespeichert');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await axios.post(
        `${basePath}/test`,
        { endpoint: settings.local_llm_endpoint },
        { withCredentials: true },
      );
      if (res.data?.ok || res.data?.success) {
        toast.success(res.data?.message || 'Verbindung OK');
      } else {
        toast.error(res.data?.message || 'Lokale Mandanten-KI nicht erreichbar');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Verbindungstest fehlgeschlagen');
    } finally {
      setTesting(false);
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await axios.post(`${basePath}/reindex`, {}, { withCredentials: true });
      toast.success(
        res.data?.message ||
          `${organizationName || 'Mandant'} Wissensdatenbank wird neu indexiert (${res.data?.enqueued ?? 0} Artikel)`,
      );
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Reindex fehlgeschlagen');
    } finally {
      setReindexing(false);
    }
  };

  const localMode = settings.ai_mode === 'org_local_ai';
  const orgLabel = organizationName?.trim() || 'Mandant';

  if (loading) {
    return (
      <section
        className={cn(
          'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm',
          className,
        )}
      >
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Mandanten-KI wird geladen…
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          <BrainCircuit className="w-4.5 h-4.5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-black text-slate-900">Mandanten-KI &amp; RAG (Lokal)</h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5 leading-relaxed">
            Dedizierte lokale KI (Ollama / OpenAI-kompatibel) nur für Tickets und Wissensdatenbank
            dieses Mandanten — getrennt von Hubcom Global-KI.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mandanten-ai-mode">KI-Modus</Label>
        <Select
          value={settings.ai_mode}
          onValueChange={(v) =>
            setSettings((s) => ({
              ...s,
              ai_mode: v as OrgAiMode,
              strict_local_only:
                v === 'org_local_ai' ? true : s.strict_local_only,
            }))
          }
        >
          <SelectTrigger id="mandanten-ai-mode" className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global_default">Hubcom Global-KI (Standard)</SelectItem>
            <SelectItem value="org_local_ai">Eigene lokale Mandanten-KI</SelectItem>
            <SelectItem value="disabled">KI deaktiviert</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {localMode && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mandanten-llm-endpoint">Local LLM Endpoint</Label>
            <Input
              id="mandanten-llm-endpoint"
              placeholder="http://10.x.x.x:11434"
              value={settings.local_llm_endpoint}
              onChange={(e) =>
                setSettings((s) => ({ ...s, local_llm_endpoint: e.target.value }))
              }
              className="text-sm font-mono"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mandanten-llm-model">LLM-Modell</Label>
              <Input
                id="mandanten-llm-model"
                placeholder="llama3"
                value={settings.local_llm_model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, local_llm_model: e.target.value }))
                }
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mandanten-emb-model">Embedding-Modell</Label>
              <Input
                id="mandanten-emb-model"
                placeholder="nomic-embed-text"
                value={settings.local_embedding_model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, local_embedding_model: e.target.value }))
                }
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mandanten-emb-endpoint">
              Embedding-Endpoint (optional, sonst LLM-Endpoint)
            </Label>
            <Input
              id="mandanten-emb-endpoint"
              placeholder="http://10.x.x.x:11434"
              value={settings.local_embedding_endpoint}
              onChange={(e) =>
                setSettings((s) => ({ ...s, local_embedding_endpoint: e.target.value }))
              }
              className="text-sm font-mono"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mandanten-api-key">
              API-Key / Bearer (optional)
              {settings.local_ai_api_key_set ? ' — hinterlegt' : ''}
            </Label>
            <Input
              id="mandanten-api-key"
              type="password"
              placeholder={settings.local_ai_api_key_set ? '••••••••' : 'Optional'}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              className="text-sm"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-slate-400">
              Wird AES-256-GCM verschlüsselt gespeichert und nie im Klartext zurückgegeben.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                Strict Local Only (kein Cloud-Fallback)
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Bei unerreichbarer lokaler KI: Fehler „Lokale Mandanten-KI nicht erreichbar“ —
                niemals Gemini / OpenAI / Anthropic.
              </p>
            </div>
            <Switch
              checked={settings.strict_local_only}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, strict_local_only: Boolean(v) }))
              }
              aria-label="Strict Local Only"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">Shared Hubcom-KB in RAG</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Standard aus — nur eigene Artikel. Aktivieren, um zusätzlich Hubcom-Global-Artikel
                einzubeziehen.
              </p>
            </div>
            <Switch
              checked={settings.include_shared_kb_in_rag}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, include_shared_kb_in_rag: Boolean(v) }))
              }
              aria-label="include_shared_kb_in_rag"
            />
          </div>

          {settings.needs_reindex && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Embedding-Modell geändert — bitte RAG-Index für diesen Mandanten neu aufbauen.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="button" onClick={() => void save()} disabled={saving || testing || reindexing}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Speichern
        </Button>
        {localMode && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void testConnection()}
              disabled={saving || testing || reindexing}
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Wifi className="w-4 h-4 mr-2" />
              )}
              Verbindung testen
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reindex()}
              disabled={saving || testing || reindexing}
            >
              {reindexing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {orgLabel} Wissensdatenbank neu indexieren
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
