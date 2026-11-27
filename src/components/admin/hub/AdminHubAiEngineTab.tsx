import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  CheckCircle2,
  Cloud,
  Cpu,
  Gauge,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Sparkles,
  Timer,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Separator } from '../../ui/separator';
import { Badge } from '../../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import { useTranslation } from '../../../lib/context/I18nContext';
import { persistOrchestratorPatch } from '../../../lib/persistOrchestratorPatch';
import {
  fetchOrchestratorConfig,
  startOrchestratorConfigSync,
  subscribeOrchestratorConfig,
} from '../../../lib/aiOrchestratorClient';
import {
  DEFAULT_ORCHESTRATOR_CONFIG,
  ORCHESTRATOR_MODEL_OPTIONS,
  CRITIC_MODEL_OPTIONS,
  type AiFeatureRouting,
  type AiOrchestratorConfig,
  type AiOrchestratorHealth,
  type AiPlaygroundRunResult,
  type DetectedLocalModel,
} from '../../../types/ai-orchestrator';
import { cn } from '../../../lib/utils';
import type { AdminHubTelemetry } from './adminHubTelemetry';
import {
  classifyProviderStatus,
  formatCheckedAt,
  modelToProviderId,
  overallHealthLabel,
  providerNextStep,
  providerStatusLabel,
} from './aiEngineStatus';

interface AdminHubAiEngineTabProps {
  telemetry: AdminHubTelemetry;
}

const PROVIDER_SECRET_FIELDS = [
  { id: 'google', label: 'Google Gemini API Key' },
  { id: 'openai', label: 'OpenAI API Key' },
  { id: 'anthropic', label: 'Anthropic API Key' },
  { id: 'azure_openai', label: 'Azure OpenAI API Key' },
  { id: 'local', label: 'Local Gateway Token (Optional)' },
];

const TASK_ROWS: Array<{
  id: keyof AiFeatureRouting;
  emoji: string;
  title: string;
  description: string;
  tooltip: string;
}> = [
  {
    id: 'smart_reply',
    emoji: '🎯',
    title: 'Primary Model',
    description: 'Chat & Ticket drafting',
    tooltip:
      'Handles customer-facing replies and draft suggestions. Use your most capable chat model for high-quality, on-brand responses.',
  },
  {
    id: 'sentiment_analysis',
    emoji: '⚡',
    title: 'Triage & Categorization',
    description: 'Fast tagging of inbound emails',
    tooltip:
      'Quickly tags priority, sentiment, and category for incoming emails. Prefer a low-latency model to keep triage instant.',
  },
  {
    id: 'escalation_analysis',
    emoji: '🔍',
    title: 'Sentiment & Escalation',
    description: 'Detects urgency and emotion',
    tooltip:
      'Analyzes customer tone to detect urgency or high emotion and triggers escalations. Needs strong emotional-intelligence capability.',
  },
  {
    id: 'root_cause_analysis',
    emoji: '🧠',
    title: 'Deep Reasoning',
    description: 'Complex multi-step diagnostic solver',
    tooltip:
      'Performs deep root-cause analysis on complex incidents. Requires strong multi-step reasoning — use your most advanced model.',
  },
  {
    id: 'ticket_summarization',
    emoji: '📝',
    title: 'Thread Summarization',
    description: 'Briefs for human agents',
    tooltip:
      'Generates concise TL;DR summaries of support threads so human agents get quick context before diving in.',
  },
];

function statusIconForDisplay(status: ReturnType<typeof classifyProviderStatus>) {
  if (status === 'available') return <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden />;
  if (status === 'not_configured' || status === 'not_checked') {
    return <XCircle className="w-4 h-4 text-amber-500" aria-hidden />;
  }
  if (status === 'degraded' || status === 'timed_out') {
    return <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden />;
  }
  return <XCircle className="w-4 h-4 text-red-500" aria-hidden />;
}

function FeatureInfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex shrink-0 items-center text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 rounded-sm"
        aria-label={text}
      >
        <Info className="w-3.5 h-3.5" />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[300px] text-left leading-snug font-normal normal-case tracking-normal"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function AdminHubAiEngineTab({ telemetry: _telemetry }: AdminHubAiEngineTabProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiOrchestratorConfig>(DEFAULT_ORCHESTRATOR_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [secretStatus, setSecretStatus] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<AiOrchestratorHealth | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState('');
  const [detectedModels, setDetectedModels] = useState<DetectedLocalModel[]>([]);
  const [isDetectingModels, setIsDetectingModels] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; latencyMs?: number; message: string }>
  >({});
  const [testingTask, setTestingTask] = useState<keyof AiFeatureRouting | null>(null);
  const [testOutputs, setTestOutputs] = useState<Record<string, AiPlaygroundRunResult>>({});
  const [bulkRoutingModel, setBulkRoutingModel] = useState<string>(
    ORCHESTRATOR_MODEL_OPTIONS[0]?.value ?? 'gemini-flash',
  );
  const [simpleModel, setSimpleModel] = useState('gemini-flash');

  const loadHealth = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/orchestrator/health');
      setHealth(res.data);
      setHealthCheckedAt(new Date().toISOString());
    } catch {
      /* keep previous health; do not invent a fake healthy state */
    }
  }, []);

  useEffect(() => {
    startOrchestratorConfigSync();
    let alive = true;
    void axios
      .get('/api/admin/orchestrator/config')
      .then((res) => {
        if (!alive) return;
        const next = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...res.data };
        setConfig(next);
        setSecretStatus(
          res.data?.secretStatus && typeof res.data.secretStatus === 'object'
            ? res.data.secretStatus
            : {},
        );
        setEndpointDraft(next.endpointUrl || '');
        setSimpleModel(next.featureRouting?.smart_reply ?? next.triageModel ?? 'gemini-flash');
        void fetchOrchestratorConfig(true);
      })
      .catch((err) => {
        console.warn('Orchestrator config unavailable', err);
        toast.error(t('admin.hubAi.loadError', 'Could not load workspace AI routing.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    void loadHealth();
    const healthInterval = window.setInterval(loadHealth, 20_000);

    const unsubscribe = subscribeOrchestratorConfig((next) => {
      setConfig(next);
      setEndpointDraft(next.endpointUrl || '');
    });

    return () => {
      alive = false;
      unsubscribe();
      window.clearInterval(healthInterval);
    };
  }, [t, loadHealth]);

  const persistPatch = useCallback(
    async (patch: Partial<AiOrchestratorConfig>) => {
      if (config.configLocked) {
        toast.error(t('admin.hubAi.locked', 'Configuration is locked. Unlock it in the AI Orchestrator.'));
        return;
      }
      setSaving(true);
      setConfig((prev) => ({
        ...prev,
        ...patch,
        featureRouting: patch.featureRouting ?? prev.featureRouting,
      }));
      try {
        const saved = await persistOrchestratorPatch(patch);
        setConfig(saved);
        if (patch.endpointUrl !== undefined) setEndpointDraft(saved.endpointUrl || '');
        toast.success(t('aiOrchestrator.featureRouting.savedWorkspace', 'Saved to the workspace database.'));
      } catch (err: unknown) {
        const message = axios.isAxiosError(err)
          ? err.response?.data?.error || err.message
          : t('admin.hubAi.saveError', 'Could not save workspace AI routing.');
        toast.error(String(message));
        try {
          const res = await axios.get('/api/admin/orchestrator/config');
          const next = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...res.data };
          setConfig(next);
          setSecretStatus(
            res.data?.secretStatus && typeof res.data.secretStatus === 'object'
              ? res.data.secretStatus
              : {},
          );
          setEndpointDraft(next.endpointUrl || '');
        } catch {
          /* keep optimistic state if reload fails */
        }
      } finally {
        setSaving(false);
      }
    },
    [config.configLocked, t],
  );

  useEffect(() => {
    if (loading) return;
    const trimmed = endpointDraft.trim();
    if (trimmed === (config.endpointUrl || '').trim()) return;
    const timer = window.setTimeout(() => {
      void persistPatch({ endpointUrl: trimmed });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [config.endpointUrl, endpointDraft, loading, persistPatch]);

  const persistRouting = (next: AiFeatureRouting) => {
    void persistPatch({ featureRouting: next });
  };

  const modelAvailability = useMemo(() => {
    const map = new Map<string, { selectable: boolean; reason?: string }>();
    for (const opt of ORCHESTRATOR_MODEL_OPTIONS) {
      const providerId = modelToProviderId(opt.value);
      const provider = health?.providers?.find((p) => p.provider === providerId);
      if (!provider) {
        map.set(opt.value, {
          selectable: false,
          reason: 'Not checked — run a provider Test before routing tasks to this model.',
        });
        continue;
      }
      const status = classifyProviderStatus(provider);
      if (status === 'available') {
        map.set(opt.value, { selectable: true });
      } else {
        map.set(opt.value, {
          selectable: false,
          reason: `${providerStatusLabel(status)}. ${providerNextStep(status, provider) || ''}`.trim(),
        });
      }
    }
    return map;
  }, [health]);

  const applyRoutingToAll = (value: string) => {
    const availability = modelAvailability.get(value);
    if (availability && !availability.selectable) {
      toast.error(availability.reason || 'Model is not available for routing.');
      return;
    }
    const differing = TASK_ROWS.filter((row) => config.featureRouting[row.id] !== value);
    if (differing.length > 0) {
      const ok = window.confirm(
        t(
          'admin.hubAi.applyAllConfirm',
          '„Auf alle anwenden“ setzt das gewählte Modell für alle Aufgaben und überschreibt vorhandene Aufgaben-Overrides. Fortfahren?',
        ),
      );
      if (!ok) return;
    }
    const next = { ...config.featureRouting };
    for (const row of TASK_ROWS) next[row.id] = value;
    persistRouting(next);
    toast.success(
      t(
        'admin.hubAi.applyAllDone',
        'Global/bulk model applied to all tasks (per-task overrides replaced).',
      ),
    );
  };

  const applySimpleModel = (value: string) => {
    setSimpleModel(value);
    applyRoutingToAll(value);
  };

  const applyBulkRouting = () => {
    if (!bulkRoutingModel) return;
    applyRoutingToAll(bulkRoutingModel);
  };

  const handleSaveSecrets = async () => {
    const nonEmpty = Object.fromEntries(
      Object.entries(secrets ?? {}).filter(([, v]) => String(v || '').trim()),
    );
    if (Object.keys(nonEmpty ?? {}).length === 0) {
      toast.info(t('admin.hubAi.noKeysToSave', 'No new API keys to save.'));
      return;
    }
    setSaving(true);
    try {
      const res = await axios.post('/api/admin/orchestrator/config', { secrets: nonEmpty });
      setSecrets({});
      if (res.data?.secretStatus) setSecretStatus(res.data.secretStatus);
      toast.success(
        t(
          'admin.hubAi.secretsSavedServer',
          'API keys saved on the server (encrypted at rest). Keys are never returned to the browser.',
        ),
      );
      void loadHealth();
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to save API keys.';
      toast.error(String(message));
    } finally {
      setSaving(false);
    }
  };

  const handleClearSecret = async (providerId: string) => {
    const ok = window.confirm(
      t(
        'admin.hubAi.clearKeyConfirm',
        'Remove the stored API key for this provider? This cannot be undone without saving a new key.',
      ),
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await axios.post('/api/admin/orchestrator/config', { clearSecrets: [providerId] });
      if (res.data?.secretStatus) setSecretStatus(res.data.secretStatus);
      else setSecretStatus((prev) => ({ ...prev, [providerId]: false }));
      setSecrets((s) => ({ ...s, [providerId]: '' }));
      toast.success(t('admin.hubAi.keyRemoved', 'Stored API key removed.'));
      void loadHealth();
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'Failed to remove API key.';
      toast.error(String(message));
    } finally {
      setSaving(false);
    }
  };

  const handleDetectModels = async () => {
    setIsDetectingModels(true);
    try {
      const res = await axios.get('/api/admin/orchestrator/models', {
        params: { endpoint: config.endpointUrl || undefined },
      });
      setDetectedModels(res.data.models || []);
      toast.success(
        t('admin.hubAi.modelsDetected', 'Local models detected:') + ` ${res.data.models?.length ?? 0}`,
      );
    } catch {
      toast.error(t('admin.hubAi.modelsDetectError', 'Model detection failed. Check endpoint URL.'));
    } finally {
      setIsDetectingModels(false);
    }
  };

  const handleTestProvider = async (provider: string) => {
    setTestingProvider(provider);
    try {
      const res = await axios.post('/api/admin/orchestrator/test');
      const results = (res.data?.results ?? []) as Array<{
        provider: string;
        label: string;
        success: boolean;
        latencyMs?: number;
        message: string;
      }>;
      const match = results.find((r) => r.provider === provider);
      if (match) {
        setTestResults((prev) => ({ ...prev, [provider]: match }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [provider]: { success: false, message: 'No result for this provider.' },
        }));
      }
      void loadHealth();
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [provider]: { success: false, message: 'Provider test failed.' },
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  const handleTestPrompt = async (taskId: keyof AiFeatureRouting) => {
    const task = TASK_ROWS.find((row) => row.id === taskId);
    if (!task) return;
    setTestingTask(taskId);
    const model = config.featureRouting[taskId];
    try {
      const res = await axios.post('/api/admin/orchestrator/playground', {
        prompt: `You are the "${task.title}" engine. ${task.tooltip.replace(/\./g, ' ')} Produce a brief sample output for testing.`,
        models: [model],
      });
      const results = (res.data?.results ?? []) as AiPlaygroundRunResult[];
      if (results[0]) {
        setTestOutputs((prev) => ({ ...prev, [taskId]: results[0] }));
      }
    } catch {
      setTestOutputs((prev) => ({
        ...prev,
        [taskId]: {
          model,
          label: model,
          output: 'Test failed.',
          latencyMs: 0,
          confidence: 0,
          success: false,
        },
      }));
    } finally {
      setTestingTask(null);
    }
  };

  const readOnly = config.configLocked;
  const isSimple = config.modelMode !== 'advanced';
  const healthLabel = overallHealthLabel(health);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">
            {t('admin.hubAi.title', 'Kern-KI & Modelle')}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {t(
              'admin.hubAi.subtitle',
              'Active engine routing, local Ollama/OpenAI endpoints, and live latency.',
            )}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-600 mt-2 inline-flex items-center gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {t(
              'aiOrchestrator.featureRouting.workspaceScope',
              'Workspace-wide · saved to the database',
            )}
          </p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-1">
          <Badge
            variant="outline"
            className={cn(
              healthLabel === 'Available'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : healthLabel === 'Partially available' || healthLabel === 'Degraded'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-slate-50 text-slate-700',
            )}
          >
            <Activity className="w-3 h-3 mr-1" aria-hidden />
            {healthLabel}
          </Badge>
          {healthCheckedAt ? (
            <span className="text-[10px] text-slate-400 font-mono">{formatCheckedAt(healthCheckedAt)}</span>
          ) : (
            <span className="text-[10px] text-slate-400">Not checked yet</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <div id="admin-hub-ai-orchestrator" className="space-y-8 scroll-mt-4">
          {/* 1. Model endpoint and provider credentials */}
          <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 xl:p-8 shadow-sm space-y-6 min-w-0">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <Server className="w-4 h-4" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">
                  {t('admin.hubAi.sectionCredentials', 'Model endpoint and provider credentials')}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(
                    'admin.hubAi.sectionCredentialsDesc',
                    'Configure the local/OpenAI-compatible endpoint and replace provider API keys. Secrets are stored encrypted on the server and are never returned to the browser.',
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t('admin.hubAi.endpointLabel', 'Local / OpenAI-Compatible Endpoint')}</Label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={endpointDraft}
                  disabled={readOnly}
                  onChange={(event) => setEndpointDraft(event.target.value)}
                  placeholder={t('admin.hubAi.endpointUnset', 'Not configured')}
                  className="sm:flex-1 bg-white focus-visible:ring-2 focus-visible:ring-primary/40"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDetectingModels || readOnly}
                  onClick={handleDetectModels}
                  className="focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {isDetectingModels ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {t('admin.hubAi.detectModels', 'Detect Local Models')}
                </Button>
              </div>
              {detectedModels.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {detectedModels.map((m) => (
                    <Badge key={m.id} variant="outline" className="text-xs">
                      {m.name} ({m.provider})
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <Separator />

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                {t('admin.hubAi.providerKeys', 'Provider API Keys')}
              </p>
              <p className="text-[10px] text-muted-foreground mb-4">
                {t(
                  'admin.hubAi.keysHintAccurate',
                  'Keys are sent to the server over your authenticated session and stored encrypted at rest (AES-GCM). The browser never receives saved secret values — only a configured / not configured status.',
                )}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {PROVIDER_SECRET_FIELDS.map(({ id, label }) => {
                  const configured = Boolean(secretStatus[id]);
                  return (
                    <div key={id} className="space-y-2 rounded-xl border border-slate-100 p-3 bg-slate-50/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Cloud className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
                          <Label className="text-xs truncate">{label}</Label>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[9px] font-bold uppercase shrink-0',
                            configured
                              ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                              : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {configured ? 'Configured' : 'Not configured'}
                        </Badge>
                      </div>
                      <Input
                        type="password"
                        disabled={readOnly}
                        value={secrets[id] || ''}
                        onChange={(e) => setSecrets((s) => ({ ...s, [id]: e.target.value }))}
                        placeholder={configured ? 'Enter new key to replace' : 'Enter API key'}
                        autoComplete="off"
                        className="bg-white focus-visible:ring-2 focus-visible:ring-primary/40"
                      />
                      {configured ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px] text-rose-600 hover:text-rose-700 px-0"
                          disabled={readOnly || saving}
                          onClick={() => void handleClearSecret(id)}
                        >
                          Remove stored key
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 focus-visible:ring-2 focus-visible:ring-primary/40"
                disabled={readOnly || saving}
                onClick={handleSaveSecrets}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {t('admin.hubAi.saveKeys', 'Save API Keys')}
              </Button>
            </div>
          </section>

          {/* 2. Provider/model connection status */}
          <section className="bg-white border border-slate-200/80 rounded-[2rem] p-5 sm:p-6 xl:p-8 shadow-sm space-y-4 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                  <Gauge className="w-4 h-4" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">
                    {t('admin.hubAi.sectionStatus', 'Provider / model connection status')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t(
                      'admin.hubAi.sectionStatusDesc',
                      'Statuses come from live health checks. “Available” is shown only after a successful probe.',
                    )}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">auto-refresh 20s</span>
            </div>

            <div className="space-y-2">
              {(health?.providers ?? []).map((p) => {
                const display = classifyProviderStatus(p);
                const result = testResults[p.provider];
                const testing = testingProvider === p.provider;
                const next = providerNextStep(display, p);
                const checked = formatCheckedAt(p.lastSuccessAt) || (result ? 'Checked just now' : null);
                return (
                  <div
                    key={p.provider}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-white min-w-0"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {statusIconForDisplay(display)}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{p.label}</p>
                        <p className="text-[11px] text-slate-600 font-semibold">
                          {providerStatusLabel(display)}
                          {display === 'available' && p.latencyMs != null ? ` · ${p.latencyMs}ms` : ''}
                        </p>
                        {checked ? (
                          <p className="text-[10px] text-slate-400 font-mono">{checked}</p>
                        ) : null}
                        {next ? <p className="text-[10px] text-slate-500 mt-0.5">{next}</p> : null}
                        {p.message && display !== 'available' && display !== 'not_checked' ? (
                          <p className="text-[10px] text-slate-400 mt-0.5 break-words font-mono">
                            {p.message}
                          </p>
                        ) : null}
                        {result ? (
                          <p
                            className={cn(
                              'text-[10px] font-semibold mt-0.5',
                              result.success ? 'text-emerald-600' : 'text-red-600',
                            )}
                          >
                            Manual test:{' '}
                            {result.success
                              ? `OK${result.latencyMs != null ? ` ${result.latencyMs}ms` : ''}`
                              : result.message}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] px-2.5 shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40"
                      disabled={testing}
                      onClick={() => handleTestProvider(p.provider)}
                    >
                      {testing ? (
                        <Loader2 className="w-3 h-3 animate-spin mr-1" />
                      ) : (
                        <Play className="w-3 h-3 mr-1" />
                      )}
                      Test
                    </Button>
                  </div>
                );
              })}
              {(health?.providers ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No provider health data yet. Wait for the next check or refresh.
                </p>
              ) : null}
            </div>
          </section>

          {/* 3. Routing mode and per-task model routing */}
          <section className="bg-white border border-indigo-200/60 rounded-[2rem] p-5 sm:p-6 xl:p-8 shadow-sm space-y-5 min-w-0">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <Cpu className="w-4 h-4" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">
                  {t('admin.hubAi.sectionRouting', 'Routing mode and per-task model routing')}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(
                    'admin.hubAi.sectionRoutingDesc',
                    'Simple Mode uses one global model for every task. Advanced Mode keeps per-task overrides. “Auf alle anwenden” replaces those overrides after confirmation.',
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    {isSimple
                      ? t('admin.hubAi.simpleMode', 'Simple Mode')
                      : t('admin.hubAi.advancedMode', 'Advanced Task Routing')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {isSimple
                      ? t('admin.hubAi.simpleModeDesc', 'One global model powers all AI tasks.')
                      : t('admin.hubAi.advancedModeDesc', 'Each task routes to its own tuned model.')}
                  </p>
                </div>
              </div>
              <Switch
                checked={!isSimple}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  void persistPatch({ modelMode: checked ? 'advanced' : 'simple' })
                }
                aria-label={t('admin.hubAi.advancedMode', 'Advanced Task Routing')}
              />
            </div>

            {isSimple ? (
              <div className="space-y-2">
                <Label>{t('admin.hubAi.globalModel', 'Global Model (all tasks)')}</Label>
                <p className="text-[10px] text-muted-foreground">
                  Changing the global model asks for confirmation if task-specific selections would be
                  overwritten.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Select value={simpleModel} disabled={readOnly} onValueChange={applySimpleModel}>
                    <SelectTrigger className="sm:max-w-[240px] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORCHESTRATOR_MODEL_OPTIONS.map((m) => {
                        const avail = modelAvailability.get(m.value);
                        return (
                          <SelectItem key={m.value} value={m.value} disabled={avail && !avail.selectable}>
                            {m.label}
                            {avail && !avail.selectable ? ' — unavailable' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit focus-visible:ring-2 focus-visible:ring-primary/40"
                    disabled={testingTask === 'smart_reply' || readOnly}
                    onClick={() => handleTestPrompt('smart_reply')}
                  >
                    {testingTask === 'smart_reply' ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Play className="w-4 h-4 mr-2" />
                    )}
                    {t('admin.hubAi.testPrompt', 'Test Prompt')}
                  </Button>
                </div>
                {testOutputs['smart_reply'] ? (
                  <div
                    className={cn(
                      'rounded-xl border p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto',
                      testOutputs['smart_reply'].success
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-red-200 bg-red-50/40',
                    )}
                  >
                    <span className="inline-flex items-center gap-1 font-sans font-bold mb-1">
                      <Timer className="w-3 h-3" /> {testOutputs['smart_reply'].latencyMs}ms
                    </span>
                    <br />
                    {testOutputs['smart_reply'].success
                      ? testOutputs['smart_reply'].output
                      : testOutputs['smart_reply'].error || 'Test failed.'}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl border border-slate-100 bg-slate-50/80">
                  <span className="text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0">
                    {t('aiOrchestrator.featureRouting.bulkRouter', 'Bulk Model Router')}
                  </span>
                  <Select
                    value={bulkRoutingModel}
                    disabled={readOnly}
                    onValueChange={(v) => setBulkRoutingModel(String(v))}
                  >
                    <SelectTrigger className="h-8 w-[min(100%,200px)] bg-white">
                      <SelectValue
                        placeholder={t('aiOrchestrator.featureRouting.selectModel', 'Select model…')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {ORCHESTRATOR_MODEL_OPTIONS.map((m) => {
                        const avail = modelAvailability.get(m.value);
                        return (
                          <SelectItem key={m.value} value={m.value} disabled={avail && !avail.selectable}>
                            {m.label}
                            {avail && !avail.selectable ? ' — unavailable' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 shrink-0 focus-visible:ring-2 focus-visible:ring-primary/40"
                    disabled={readOnly || !bulkRoutingModel}
                    onClick={applyBulkRouting}
                  >
                    {t('aiOrchestrator.featureRouting.applyToAll', 'Apply to All')}
                  </Button>
                  <p className="text-[10px] text-slate-500 w-full">
                    „Auf alle anwenden“ replaces every task’s current model with the selected one after
                    confirmation. Unconfigured or unchecked models cannot be selected.
                  </p>
                </div>

                <div className="space-y-3">
                  {TASK_ROWS.map((task) => {
                    const output = testOutputs[task.id];
                    const testing = testingTask === task.id;
                    const current = config.featureRouting[task.id];
                    const currentAvail = modelAvailability.get(current);
                    return (
                      <div key={task.id} className="p-4 rounded-xl border border-slate-100 bg-white min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex items-center gap-2 min-w-0 sm:w-56 shrink-0">
                            <span className="text-lg leading-none" aria-hidden>
                              {task.emoji}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-slate-800 truncate">{task.title}</p>
                              <p className="text-[10px] text-muted-foreground">{task.description}</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                Current: <span className="font-semibold">{current}</span>
                                {currentAvail && !currentAvail.selectable
                                  ? ' (currently unavailable)'
                                  : ''}
                              </p>
                            </div>
                            <FeatureInfoTooltip text={task.tooltip} />
                          </div>
                          <Select
                            value={current}
                            disabled={readOnly}
                            onValueChange={(value) => {
                              const avail = modelAvailability.get(String(value));
                              if (avail && !avail.selectable) {
                                toast.error(avail.reason || 'Model unavailable');
                                return;
                              }
                              persistRouting({ ...config.featureRouting, [task.id]: String(value) });
                            }}
                          >
                            <SelectTrigger className="h-8 sm:w-[200px] bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORCHESTRATOR_MODEL_OPTIONS.map((m) => {
                                const avail = modelAvailability.get(m.value);
                                const disabled = Boolean(avail && !avail.selectable && m.value !== current);
                                return (
                                  <SelectItem key={m.value} value={m.value} disabled={disabled}>
                                    {m.label}
                                    {disabled ? ' — unavailable' : ''}
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="sm:ml-auto w-fit focus-visible:ring-2 focus-visible:ring-primary/40"
                            disabled={testing || readOnly}
                            onClick={() => handleTestPrompt(task.id)}
                          >
                            {testing ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : (
                              <>
                                <Play className="w-4 h-4 mr-2" />
                                {t('admin.hubAi.testPrompt', 'Test Prompt')}
                              </>
                            )}
                          </Button>
                        </div>
                        {currentAvail && !currentAvail.selectable ? (
                          <p className="mt-2 text-[10px] text-amber-700">{currentAvail.reason}</p>
                        ) : null}
                        {output ? (
                          <div
                            className={cn(
                              'mt-3 rounded-lg border p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto',
                              output.success
                                ? 'border-emerald-200 bg-emerald-50/40'
                                : 'border-red-200 bg-red-50/40',
                            )}
                          >
                            <span className="inline-flex items-center gap-1 font-sans font-bold mb-1">
                              <Timer className="w-3 h-3" /> {output.latencyMs}ms
                            </span>
                            <br />
                            {output.success ? output.output : output.error || 'Test failed.'}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* 4. Advanced automation and evaluation controls */}
          <section className="bg-white border border-teal-200/60 rounded-[2rem] p-5 sm:p-6 xl:p-8 shadow-sm space-y-5 min-w-0">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-teal-50 text-teal-600">
                <RefreshCw className="w-4 h-4" aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">
                  {t(
                    'admin.hubAi.sectionAdvanced',
                    'Advanced automation and evaluation controls',
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t(
                    'admin.hubAi.sectionAdvancedDesc',
                    'Self-critique loop, confidence gate, critic model, swarm detection, and human-diff learning. Values keep existing backend semantics.',
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {t('admin.hubAi.selfCritiqueEngine', 'Self-Critique Engine')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'admin.hubAi.selfCritiqueEngineHelp',
                        'When enabled, AI drafts are reviewed by a critic model before delivery. Disabling skips the evaluator-optimizer loop.',
                      )}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.enableSelfCritiqueLoop}
                  disabled={readOnly}
                  onCheckedChange={(checked) => void persistPatch({ enableSelfCritiqueLoop: checked })}
                  aria-label={t('admin.hubAi.selfCritiqueEngine', 'Self-Critique Engine')}
                />
              </div>

              <div className="p-3 rounded-xl border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t('admin.hubAi.maxIterations', 'Max Self-Critique Iterations')}
                    </Label>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[11px] font-black text-teal-700 border-teal-200 bg-teal-50"
                  >
                    {config.maxCritiqueIterations}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  How many critic→revise cycles may run (1–3). Higher values increase latency and cost.
                </p>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={1}
                  value={Math.min(3, Math.max(1, Number(config.maxCritiqueIterations) || 1))}
                  disabled={readOnly || !config.enableSelfCritiqueLoop}
                  onChange={(e) =>
                    void persistPatch({
                      maxCritiqueIterations: Math.min(3, Math.max(1, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-full accent-teal-600 disabled:opacity-40"
                  aria-label={t('admin.hubAi.maxIterations', 'Max Self-Critique Iterations')}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                  <span>1 · fastest</span>
                  <span>2 · balanced</span>
                  <span>3 · strictest</span>
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-3.5 h-3.5 text-slate-400" aria-hidden />
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t('admin.hubAi.confidenceThreshold', 'Confidence Threshold (High vs Nuanced)')}
                    </Label>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[11px] font-black text-emerald-700 border-emerald-200 bg-emerald-50"
                  >
                    {config.autoDispatchThreshold}%
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Minimum critic confidence (70–99%) required to auto-dispatch without extra review.
                  Existing backend threshold semantics are unchanged.
                </p>
                <input
                  type="range"
                  min={70}
                  max={99}
                  step={1}
                  value={Math.min(99, Math.max(70, Number(config.autoDispatchThreshold) || 70))}
                  disabled={readOnly || !config.enableSelfCritiqueLoop}
                  onChange={(e) =>
                    void persistPatch({
                      autoDispatchThreshold: Math.min(99, Math.max(70, Number(e.target.value) || 70)),
                    })
                  }
                  className="w-full accent-emerald-600 disabled:opacity-40"
                  aria-label={t('admin.hubAi.confidenceThreshold', 'Confidence Threshold (High vs Nuanced)')}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
                  <span>70% · lenient</span>
                  <span>85% · balanced</span>
                  <span>99% · strict</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-slate-400" aria-hidden />
                  <div>
                    <Label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {t('admin.hubAi.criticModel', 'Critic Model')}
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      {t(
                        'admin.hubAi.criticModelHelp',
                        'Model that scores drafts for factual accuracy, policy adherence, and confidence.',
                      )}
                    </p>
                  </div>
                </div>
                <Select
                  value={config.criticModel}
                  disabled={readOnly || !config.enableSelfCritiqueLoop}
                  onValueChange={(value) => void persistPatch({ criticModel: String(value) })}
                >
                  <SelectTrigger className="sm:w-[240px] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRITIC_MODEL_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {t('admin.hubAi.swarmDetector', 'Swarm Detector')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'admin.hubAi.swarmDetectorHelp',
                        'Alerts when many similar unassigned tickets arrive in a short window (potential outage). Thresholds follow existing backend rules.',
                      )}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.enableSwarmDetection}
                  disabled={readOnly}
                  onCheckedChange={(checked) => void persistPatch({ enableSwarmDetection: checked })}
                  aria-label={t('admin.hubAi.swarmDetector', 'Swarm Detector')}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {t('admin.hubAi.humanDiffLearning', 'Human-Diff Feedback Learning')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'admin.hubAi.humanDiffLearningHelp',
                        'Logs substantial human edits to AI drafts so prompts can be refined over time. Does not train models in the browser.',
                      )}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.enableHumanDiffLearning}
                  disabled={readOnly}
                  onCheckedChange={(checked) => void persistPatch({ enableHumanDiffLearning: checked })}
                  aria-label={t('admin.hubAi.humanDiffLearning', 'Human-Diff Feedback Learning')}
                />
              </div>
            </div>
          </section>
        </div>
      )}

    </div>
  );
}
