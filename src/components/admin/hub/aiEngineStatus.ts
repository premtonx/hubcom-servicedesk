import type { AiProviderHealth } from '../../../types/ai-orchestrator';

/** Map routing model ids to health-check provider ids used by /orchestrator/health. */
export function modelToProviderId(modelId: string): string {
  const id = String(modelId || '').toLowerCase();
  if (id.startsWith('gemini') || id === 'google') return 'google';
  if (id === 'gpt-5' || id.startsWith('gpt') || id === 'openai') return 'openai';
  if (id.startsWith('claude') || id === 'anthropic') return 'anthropic';
  if (id.startsWith('local') || id.startsWith('qwen') || id === 'ollama') return 'local';
  if (id.startsWith('azure')) return 'azure_openai';
  return id;
}

export type ProviderDisplayStatus =
  | 'available'
  | 'not_configured'
  | 'connection_failed'
  | 'timed_out'
  | 'not_checked'
  | 'degraded';

export function classifyProviderStatus(p: AiProviderHealth): ProviderDisplayStatus {
  if (p.status === 'online') return 'available';
  if (p.status === 'missing_key') return 'not_configured';
  if (p.status === 'degraded') {
    if (!p.message || /not configured|missing|no endpoint|endpoint unset/i.test(p.message)) {
      return 'not_configured';
    }
    if (/aborted|timeout|timed out/i.test(p.message)) return 'timed_out';
    return 'degraded';
  }
  // offline
  const msg = p.message || '';
  if (/not probed|not checked/i.test(msg)) return 'not_checked';
  if (/aborted|timeout|timed out/i.test(msg)) return 'timed_out';
  if (!msg || /not configured|missing/i.test(msg)) return 'not_configured';
  return 'connection_failed';
}

export function providerStatusLabel(status: ProviderDisplayStatus): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'not_configured':
      return 'Not configured';
    case 'connection_failed':
      return 'Connection failed';
    case 'timed_out':
      return 'Timed out';
    case 'not_checked':
      return 'Not checked';
    case 'degraded':
      return 'Degraded';
    default:
      return 'Not checked';
  }
}

export function providerNextStep(status: ProviderDisplayStatus, p: AiProviderHealth): string | null {
  switch (status) {
    case 'available':
      return null;
    case 'not_configured':
      return p.provider === 'local'
        ? 'Set a local endpoint URL, then run Detect / Test.'
        : 'Save an API key for this provider, then run Test.';
    case 'timed_out':
      return 'Check network reachability and endpoint availability, then Test again.';
    case 'connection_failed':
      return 'Verify credentials and endpoint, then Test again.';
    case 'degraded':
      return 'Endpoint responded poorly — verify the model server and Test again.';
    case 'not_checked':
      return 'Run Test to perform a live health check. Availability is only shown after a successful check.';
    default:
      return null;
  }
}

export function overallHealthLabel(health: {
  status: 'healthy' | 'degraded' | 'offline';
  killSwitchActive?: boolean;
  providers: AiProviderHealth[];
} | null): string {
  if (!health) return 'Not checked';
  if (health.killSwitchActive) return 'Disabled';
  const classified = health.providers.map(classifyProviderStatus);
  const anyAvailable = classified.includes('available');
  if (health.status === 'healthy' && anyAvailable) return 'Available';
  if (anyAvailable) return 'Partially available';
  if (classified.every((s) => s === 'not_configured')) return 'Not configured';
  if (classified.some((s) => s === 'timed_out')) return 'Timed out';
  if (classified.some((s) => s === 'connection_failed' || s === 'degraded')) return 'Connection failed';
  return 'Not checked';
}

export function formatCheckedAt(iso?: string): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = Date.now() - t;
  if (diff < 60_000) return 'Checked just now';
  if (diff < 3_600_000) return `Checked ${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `Checked ${Math.floor(diff / 3_600_000)} h ago`;
  return `Checked ${new Date(iso).toLocaleString()}`;
}
