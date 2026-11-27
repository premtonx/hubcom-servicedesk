import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
export type LocalServerType = 'ollama' | 'openai_compatible';

export interface MandantenKiSettings {
  ai_mode: OrgAiMode;
  local_server_type: LocalServerType;
  local_llm_endpoint: string;
  local_llm_model: string;
  local_embedding_endpoint: string;
  local_embedding_model: string;
  local_ai_api_key_set: boolean;
  model_ticket_summary: string;
  model_ticket_reply: string;
  model_kb_assistant: string;
  model_rag_embedding: string;
  strict_local_only: boolean;
  include_shared_kb_in_rag: boolean;
  last_embedding_model: string | null;
  needs_reindex: boolean;
}

interface MandantenKiRagCardProps {
  organizationId?: string | null;
  mode: 'admin' | 'portal';
  className?: string;
  organizationName?: string | null;
}

const emptySettings = (): MandantenKiSettings => ({
  ai_mode: 'global_default',
  local_server_type: 'ollama',
  local_llm_endpoint: '',
  local_llm_model: 'llama3',
  local_embedding_endpoint: '',
  local_embedding_model: 'nomic-embed-text',
  local_ai_api_key_set: false,
  model_ticket_summary: '',
  model_ticket_reply: '',
  model_kb_assistant: '',
  model_rag_embedding: '',
  strict_local_only: true,
  include_shared_kb_in_rag: false,
  last_embedding_model: null,
  needs_reindex: false,
});

type FeatureKey =
  | 'model_ticket_summary'
  | 'model_ticket_reply'
  | 'model_kb_assistant'
  | 'model_rag_embedding';

const FEATURE_FIELDS: Array<{
  key: FeatureKey;
  label: string;
  hint: string;
}> = [
  {
    key: 'model_ticket_summary',
    label: 'Ticket-Zusammenfassung & Analyse',
    hint: 'KI-Sync, Detailanalyse, Triage',
  },
  {
    key: 'model_ticket_reply',
    label: 'Antwortvorschläge & KI-Copilot',
    hint: 'KI-vorgeschlagene Strategie, Entwürfe',
  },
  {
    key: 'model_kb_assistant',
    label: 'Wissensdatenbank-Assistent',
    hint: 'KI fragen, KI generieren',
  },
  {
    key: 'model_rag_embedding',
    label: 'RAG-Modell (Text-Vektoren / Suche)',
    hint: 'Indexierung & semantische Suche',
  },
];

function ModelField({
  label,
  hint,
  value,
  fallback,
  models,
  onChange,
  allowCustom,
}: {
  label: string;
  hint: string;
  value: string;
  fallback: string;
  models: string[];
  onChange: (v: string) => void;
  allowCustom: boolean;
}) {
  const effective = value || fallback || '';
  const options = useMemo(() => {
    const set = new Set(models);
    if (effective) set.add(effective);
    if (fallback) set.add(fallback);
    return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [models, effective, fallback]);

  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-bold text-slate-900">{label}</Label>
      <p className="text-[11px] text-slate-500 -mt-0.5">{hint}</p>
      {options.length > 0 && !allowCustom ? (
        <Select value={effective || undefined} onValueChange={onChange}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Modell wählen" />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          list={`models-${label}`}
          className="text-sm font-mono"
          value={value}
          placeholder={fallback || 'Modellname'}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
      {options.length > 0 && allowCustom ? (
        <datalist id={`models-${label}`}>
          {options.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

/**
 * KI & Lokaler Server — Mandanten-KI Einstellungen (100 % deutsche UI).
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
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [connectionHint, setConnectionHint] = useState<string | null>(null);
  const [ragStatus, setRagStatus] = useState({ indexedCount: 0, totalCount: 0 });
  const [embeddingChanged, setEmbeddingChanged] = useState(false);

  const orgIdKey = String(organizationId || '').trim();
  const basePath =
    mode === 'admin'
      ? `/api/admin/organizations/${encodeURIComponent(orgIdKey)}/ai-settings`
      : '/api/portal/ai-settings';
  const fetchGenRef = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (mode === 'admin' && !orgIdKey) {
        setLoading(false);
        return;
      }
      const gen = ++fetchGenRef.current;
      setLoading(true);
      try {
        const res = await axios.get(basePath, { withCredentials: true, signal });
        if (signal?.aborted || gen !== fetchGenRef.current) return;
        const next = res.data?.settings as MandantenKiSettings | undefined;
        if (next) setSettings({ ...emptySettings(), ...next });
        if (res.data?.ragStatus) {
          setRagStatus({
            indexedCount: Number(res.data.ragStatus.indexedCount || 0),
            totalCount: Number(res.data.ragStatus.totalCount || 0),
          });
        }
        setApiKeyDraft('');
        setEmbeddingChanged(false);
      } catch (err: any) {
        if (
          signal?.aborted ||
          gen !== fetchGenRef.current ||
          err?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          axios.isCancel?.(err)
        ) {
          return;
        }
        toast.error(
          err?.response?.data?.error || 'KI-Einstellungen konnten nicht geladen werden.',
        );
      } finally {
        if (gen === fetchGenRef.current && !signal?.aborted) setLoading(false);
      }
    },
    [basePath, mode, orgIdKey],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => {
      ac.abort();
      fetchGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional primitive gate
  }, [mode, orgIdKey, basePath]);

  const save = async () => {
    if (mode === 'admin' && !organizationId) {
      toast.error('Organisation fehlt.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ai_mode: settings.ai_mode,
        local_server_type: settings.local_server_type,
        local_llm_endpoint: settings.local_llm_endpoint,
        local_llm_model: settings.local_llm_model,
        local_embedding_endpoint: settings.local_embedding_endpoint,
        local_embedding_model:
          settings.model_rag_embedding || settings.local_embedding_model,
        model_ticket_summary: settings.model_ticket_summary,
        model_ticket_reply: settings.model_ticket_reply,
        model_kb_assistant: settings.model_kb_assistant,
        model_rag_embedding: settings.model_rag_embedding,
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
      toast.success('Einstellungen gespeichert.');
      if (embeddingChanged) {
        toast.message(
          'RAG-Modell geändert — bitte Wissensdatenbank neu indexieren.',
        );
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const testAndLoadModels = async () => {
    setTesting(true);
    setConnectionHint(null);
    try {
      const res = await axios.post(
        `${basePath}/models`,
        {
          endpoint: settings.local_llm_endpoint,
          serverType: settings.local_server_type,
        },
        { withCredentials: true },
      );
      const models: string[] = Array.isArray(res.data?.models) ? res.data.models : [];
      setDiscoveredModels(models);
      if (res.data?.ok || res.data?.success) {
        if (res.data?.serverType === 'ollama' || res.data?.serverType === 'openai_compatible') {
          setSettings((s) => ({ ...s, local_server_type: res.data.serverType }));
        }
        setConnectionHint(res.data?.message || 'Verbindung erfolgreich.');
        toast.success(res.data?.message || 'Verbindung erfolgreich.');
      } else {
        const msg =
          res.data?.message ||
          'Lokaler KI-Server ist unter dieser Adresse nicht erreichbar.';
        setConnectionHint(msg);
        toast.error(msg);
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        'Lokaler KI-Server ist unter dieser Adresse nicht erreichbar.';
      setConnectionHint(msg);
      toast.error(msg);
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
          'Wissensdatenbank wird neu indexiert.',
      );
      setEmbeddingChanged(false);
      await load();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error || 'Neuindexierung fehlgeschlagen.',
      );
    } finally {
      setReindexing(false);
    }
  };

  const localMode = settings.ai_mode === 'org_local_ai';
  const orgLabel = organizationName?.trim() || 'Mandant';
  const chatFallback = settings.local_llm_model || 'llama3';
  const embFallback =
    settings.model_rag_embedding || settings.local_embedding_model || 'nomic-embed-text';
  const modelsOffline = discoveredModels.length === 0;

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
          KI-Einstellungen werden geladen…
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
          <h3 className="text-sm font-black text-slate-900">KI &amp; Lokaler Server</h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5 leading-relaxed">
            Eigenen lokalen KI-Server (Ollama oder OpenAI-kompatibel) nur für Tickets und
            Wissensdatenbank dieses Mandanten nutzen — getrennt von Hubcom.
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
              strict_local_only: v === 'org_local_ai' ? true : s.strict_local_only,
            }))
          }
        >
          <SelectTrigger id="mandanten-ai-mode" className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global_default">Standard (Hubcom)</SelectItem>
            <SelectItem value="org_local_ai">Eigener lokaler KI-Server</SelectItem>
            <SelectItem value="disabled">KI deaktiviert</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {localMode && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mandanten-server-type">Server-Typ</Label>
              <Select
                value={settings.local_server_type}
                onValueChange={(v) =>
                  setSettings((s) => ({
                    ...s,
                    local_server_type: v as LocalServerType,
                  }))
                }
              >
                <SelectTrigger id="mandanten-server-type" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ollama">Ollama</SelectItem>
                  <SelectItem value="openai_compatible">OpenAI-kompatibel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="mandanten-llm-endpoint">Server-Adresse (URL)</Label>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mandanten-emb-endpoint">
              Separater Embedding-Server (optional)
            </Label>
            <Input
              id="mandanten-emb-endpoint"
              placeholder="Leer = gleiche Server-Adresse"
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
              Zugangsschlüssel / Bearer{settings.local_ai_api_key_set ? ' — hinterlegt' : ''}{' '}
              (optional)
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mandanten-fallback-model">Standard-Chatmodell (Fallback)</Label>
            <Input
              id="mandanten-fallback-model"
              placeholder="llama3"
              value={settings.local_llm_model}
              onChange={(e) =>
                setSettings((s) => ({ ...s, local_llm_model: e.target.value }))
              }
              className="text-sm"
            />
            <p className="text-[11px] text-slate-400">
              Wird verwendet, wenn für eine Funktion kein eigenes Modell gewählt ist.
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 space-y-3">
            <p className="text-xs font-black text-slate-800 uppercase tracking-wide">
              Modelle je KI-Bereich
            </p>
            <div className="grid gap-4">
              {FEATURE_FIELDS.map((f) => (
                <ModelField
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  value={settings[f.key]}
                  fallback={
                    f.key === 'model_rag_embedding' ? embFallback : chatFallback
                  }
                  models={discoveredModels}
                  allowCustom={modelsOffline}
                  onChange={(v) => {
                    setSettings((s) => ({ ...s, [f.key]: v }));
                    if (f.key === 'model_rag_embedding') setEmbeddingChanged(true);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                Kein Cloud-Fallback (100 % lokal)
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Bei unerreichbarem Server erscheint: „Lokaler KI-Server ist unter dieser Adresse
                nicht erreichbar.“ — kein externes Cloud-Modell.
              </p>
            </div>
            <Switch
              checked={settings.strict_local_only}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, strict_local_only: Boolean(v) }))
              }
              aria-label="Kein Cloud-Fallback"
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                Hubcom-Wissensartikel in der Suche
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Standard aus — nur eigene Artikel. Aktivieren, um zusätzlich freigegebene
                Hubcom-Artikel einzubeziehen.
              </p>
            </div>
            <Switch
              checked={settings.include_shared_kb_in_rag}
              onCheckedChange={(v) =>
                setSettings((s) => ({ ...s, include_shared_kb_in_rag: Boolean(v) }))
              }
              aria-label="Hubcom-Wissensartikel in der Suche"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 space-y-2">
            <p className="text-sm font-bold text-slate-900">RAG-Status</p>
            <p className="text-xs text-slate-600">
              {ragStatus.indexedCount} von {ragStatus.totalCount} Wissensartikeln im
              KI-Wissensspeicher
            </p>
            {(settings.needs_reindex || embeddingChanged) && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                RAG-Modell geändert — bestehende Vektoren bitte mit „Wissensdatenbank neu
                indexieren“ neu aufbauen.
              </p>
            )}
          </div>

          {connectionHint ? (
            <p
              className={cn(
                'text-xs rounded-lg px-3 py-2 border',
                connectionHint.includes('erfolgreich') || connectionHint.includes('OK')
                  ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                  : 'text-rose-800 bg-rose-50 border-rose-200',
              )}
            >
              {connectionHint}
            </p>
          ) : null}
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
              onClick={() => void testAndLoadModels()}
              disabled={saving || testing || reindexing}
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Wifi className="w-4 h-4 mr-2" />
              )}
              Verbindung testen &amp; Modelle laden
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
              Wissensdatenbank neu indexieren
            </Button>
          </>
        )}
      </div>
      {localMode && orgLabel !== 'Mandant' ? (
        <p className="text-[11px] text-slate-400">Indexierung gilt nur für {orgLabel}.</p>
      ) : null}
    </section>
  );
}
