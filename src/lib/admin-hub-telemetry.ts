/** Shared Admin-Hub Übersicht telemetry types (API + UI). */

export type AdminHubSubsystemState =
  | 'ok'
  | 'degraded'
  | 'error'
  | 'unknown'
  | 'not_configured';

export interface AdminHubSubsystemStatus {
  id: string;
  label: string;
  state: AdminHubSubsystemState;
  detail: string;
  checkedAt: string;
  href: string;
}

export interface AdminHubActionItem {
  id: string;
  title: string;
  detail: string;
  severity: 'warning' | 'error';
  href: string;
}

export interface AdminHubProviderHealth {
  provider: string;
  label: string;
  status: 'online' | 'offline' | 'degraded' | 'missing_key';
  latencyMs?: number;
}

export interface AdminHubTelemetry {
  activeAgents: number;
  ticketsTotal: number;
  vaultSecrets: number;
  knowledgeArticles: number;
  aiRequests: number;
  activeVectors: number;
  primaryModel: string | null;
  providers: AdminHubProviderHealth[];
  avgAiLatencyMs: number | null;
  subsystems: AdminHubSubsystemStatus[];
  actionItems: AdminHubActionItem[];
  overallState: AdminHubSubsystemState;
  checkedAt: string;
  loadError?: string | null;

  /** @deprecated Prefer overallState — was a fabricated SLA percentage. */
  systemHealth?: number;
  /** @deprecated Prefer avgAiLatencyMs. */
  latencyMs?: number;
  /** @deprecated Alias of ticketsTotal. */
  ticketsProcessed?: number;
  /** @deprecated Composite inventory sum — not a health metric. */
  assetsManaged?: number;
}

export const EMPTY_TELEMETRY: AdminHubTelemetry = {
  activeAgents: 0,
  ticketsTotal: 0,
  vaultSecrets: 0,
  knowledgeArticles: 0,
  aiRequests: 0,
  activeVectors: 0,
  primaryModel: null,
  providers: [],
  avgAiLatencyMs: null,
  subsystems: [],
  actionItems: [],
  overallState: 'unknown',
  checkedAt: new Date(0).toISOString(),
  loadError: null,
};

export function worstSubsystemState(
  states: AdminHubSubsystemState[],
): AdminHubSubsystemState {
  const rank: Record<AdminHubSubsystemState, number> = {
    ok: 0,
    not_configured: 1,
    unknown: 2,
    degraded: 3,
    error: 4,
  };
  let worst: AdminHubSubsystemState = 'ok';
  for (const s of states) {
    if (rank[s] > rank[worst]) worst = s;
  }
  return states.length ? worst : 'unknown';
}

export function overallStateLabelDe(state: AdminHubSubsystemState): string {
  switch (state) {
    case 'ok':
      return 'Betriebsbereit';
    case 'degraded':
      return 'Eingeschränkt';
    case 'error':
      return 'Störung';
    case 'not_configured':
      return 'Nicht konfiguriert';
    default:
      return 'Unbekannt';
  }
}
