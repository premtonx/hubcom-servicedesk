/**
 * Builds the Admin-Hub Übersicht payload from real probes only.
 * No fabricated SLA %, clamped latency, or simulated subsystem health.
 */

import type { Request } from 'express';
import {
  getDocsDirect,
  queryDb,
} from './postgres-backend.js';
import { getOrchestratorHealth } from './ai-orchestrator-service.js';
import { loadRagStatus } from './ai/rag-status.js';
import { listEmailChannels } from './email-ingestion/channel-store.js';
import { safeErrorMessage } from './safe-log.js';
import type {
  AdminHubActionItem,
  AdminHubSubsystemState,
  AdminHubSubsystemStatus,
  AdminHubTelemetry,
} from './admin-hub-telemetry.js';
import { worstSubsystemState } from './admin-hub-telemetry.js';

const WORKSPACE_ID = 'default';
const TENANT_ID = 'default';

function nowIso(): string {
  return new Date().toISOString();
}

async function probeControlPlane(): Promise<AdminHubSubsystemStatus> {
  const checkedAt = nowIso();
  try {
    await queryDb('SELECT 1');
    return {
      id: 'control-plane',
      label: 'Control Plane',
      state: 'ok',
      detail: 'API und Datenbank erreichbar',
      checkedAt,
      href: '/admin?tab=system',
    };
  } catch (err) {
    return {
      id: 'control-plane',
      label: 'Control Plane',
      state: 'error',
      detail: safeErrorMessage(err, 'Datenbank nicht erreichbar'),
      checkedAt,
      href: '/admin?tab=system',
    };
  }
}

async function probeAiModels(): Promise<{
  subsystem: AdminHubSubsystemStatus;
  actions: AdminHubActionItem[];
  primaryModel: string | null;
  providers: AdminHubTelemetry['providers'];
}> {
  const checkedAt = nowIso();
  const actions: AdminHubActionItem[] = [];
  try {
    const health = await getOrchestratorHealth(WORKSPACE_ID);
    const providers = (health.providers ?? []).map((p) => ({
      provider: p.provider,
      label: p.label,
      status: p.status,
      latencyMs: p.latencyMs,
    }));

    let state: AdminHubSubsystemState = 'error';
    let detail = health.label || 'KI-Status unbekannt';

    if (health.killSwitchActive) {
      state = 'error';
      detail = 'Kill-Switch aktiv — KI deaktiviert';
      actions.push({
        id: 'ai-kill-switch',
        title: 'KI-Kill-Switch ist aktiv',
        detail: 'Anfragen werden blockiert, bis der Kill-Switch in Kern-KI & Modelle deaktiviert wird.',
        severity: 'error',
        href: '/admin?tab=ai-engine',
      });
    } else if (health.status === 'healthy') {
      state = 'ok';
      detail = health.primaryModel
        ? `Bereit · Primärmodell: ${health.primaryModel}`
        : 'Alle konfigurierten Anbieter erreichbar';
    } else if (health.status === 'degraded') {
      state = 'degraded';
      detail = 'Mindestens ein Anbieter ist eingeschränkt oder ohne Schlüssel';
      actions.push({
        id: 'ai-degraded',
        title: 'KI-Anbieter eingeschränkt',
        detail: detail,
        severity: 'warning',
        href: '/admin?tab=ai-engine',
      });
    } else {
      state = providers.length === 0 ? 'not_configured' : 'error';
      detail =
        providers.length === 0
          ? 'Keine KI-Anbieter konfiguriert'
          : 'Kein erreichbarer KI-Anbieter';
      actions.push({
        id: 'ai-offline',
        title: providers.length === 0 ? 'KI-Anbieter fehlen' : 'KI-Anbieter nicht erreichbar',
        detail,
        severity: providers.length === 0 ? 'warning' : 'error',
        href: '/admin?tab=ai-engine',
      });
    }

    if (health.budgetExceeded) {
      actions.push({
        id: 'ai-budget',
        title: 'KI-Budget überschritten',
        detail: 'Das konfigurierte Nutzungsbudget ist ausgeschöpft.',
        severity: 'warning',
        href: '/admin?tab=ai-engine',
      });
      if (state === 'ok') state = 'degraded';
    }

    for (const p of providers) {
      if (p.status === 'missing_key') {
        actions.push({
          id: `ai-key-${p.provider}`,
          title: `API-Schlüssel fehlt: ${p.label}`,
          detail: 'Anbieter ist konfiguriert, aber ohne gültigen Schlüssel.',
          severity: 'warning',
          href: '/admin?tab=ai-engine',
        });
      } else if (p.status === 'offline') {
        actions.push({
          id: `ai-off-${p.provider}`,
          title: `Anbieter offline: ${p.label}`,
          detail: 'Live-Probe meldet keine Erreichbarkeit.',
          severity: 'error',
          href: '/admin?tab=ai-engine',
        });
      }
    }

    return {
      subsystem: {
        id: 'ai-models',
        label: 'AI / Modelle',
        state,
        detail,
        checkedAt,
        href: '/admin?tab=ai-engine',
      },
      actions,
      primaryModel: health.primaryModel ?? null,
      providers,
    };
  } catch (err) {
    return {
      subsystem: {
        id: 'ai-models',
        label: 'AI / Modelle',
        state: 'unknown',
        detail: safeErrorMessage(err, 'KI-Status konnte nicht geladen werden'),
        checkedAt,
        href: '/admin?tab=ai-engine',
      },
      actions: [
        {
          id: 'ai-probe-failed',
          title: 'KI-Statusprüfung fehlgeschlagen',
          detail: safeErrorMessage(err, 'Orchestrator-Health nicht erreichbar'),
          severity: 'error',
          href: '/admin?tab=ai-engine',
        },
      ],
      primaryModel: null,
      providers: [],
    };
  }
}

async function probeRag(tenantId: string): Promise<{
  subsystem: AdminHubSubsystemStatus;
  actions: AdminHubActionItem[];
  activeVectors: number;
  knowledgeArticles: number;
}> {
  const checkedAt = nowIso();
  try {
    const rag = await loadRagStatus(tenantId);
    const vectors = rag.kb.indexedChunks + rag.tickets.indexedChunks;
    const articles = rag.kb.totalArticles;
    const actions: AdminHubActionItem[] = [];
    let state: AdminHubSubsystemState = 'ok';
    let detail = `${rag.kb.indexedArticles} KB-Artikel indexiert · ${vectors.toLocaleString('de-DE')} Chunks`;

    if (rag.embeddingError) {
      state = 'error';
      detail = rag.embeddingError;
      actions.push({
        id: 'rag-embedding-error',
        title: 'Embedding-Fehler',
        detail: rag.embeddingError,
        severity: 'error',
        href: '/admin/rag/pipeline',
      });
    }

    const failures = rag.recentFailures ?? [];
    if (failures.length > 0) {
      if (state === 'ok') state = 'degraded';
      const first = failures[0];
      actions.push({
        id: 'rag-job-failures',
        title: 'Fehlgeschlagene Index-Jobs',
        detail: first.lastError || `${failures.length} kürzliche Fehler in der Vektor-Warteschlange`,
        severity: 'error',
        href: '/admin/rag/pipeline',
      });
    }

    if (rag.kb.missingIndexArticles > 0) {
      if (state === 'ok') state = 'degraded';
      actions.push({
        id: 'rag-missing-kb',
        title: `${rag.kb.missingIndexArticles} veröffentlichte Artikel ohne Index`,
        detail: 'In RAG & Wissensbasis ausstehende Artikel indexieren.',
        severity: 'warning',
        href: '/admin?tab=rag',
      });
      if (state !== 'error') {
        detail = `${rag.kb.missingIndexArticles} Artikel ohne Index`;
      }
    }

    const embedder = rag.activeEmbeddingProvider as { kind?: string } | null | undefined;
    if ((!embedder || embedder.kind === 'none') && state === 'ok') {
      state = 'not_configured';
      detail = 'Kein Embedding-Anbieter aktiv';
      actions.push({
        id: 'rag-no-embedder',
        title: 'Embedding-Anbieter fehlt',
        detail: 'Für die Wissensdatenbank ist kein aktiver Embedding-Anbieter gesetzt.',
        severity: 'warning',
        href: '/admin?tab=rag',
      });
    }

    return {
      subsystem: {
        id: 'knowledge',
        label: 'Wissensdatenbank',
        state,
        detail,
        checkedAt,
        href: '/admin?tab=rag',
      },
      actions,
      activeVectors: vectors,
      knowledgeArticles: articles,
    };
  } catch (err) {
    return {
      subsystem: {
        id: 'knowledge',
        label: 'Wissensdatenbank',
        state: 'unknown',
        detail: safeErrorMessage(err, 'RAG-Status nicht verfügbar'),
        checkedAt,
        href: '/admin?tab=rag',
      },
      actions: [
        {
          id: 'rag-probe-failed',
          title: 'Wissensdatenbank-Status fehlgeschlagen',
          detail: safeErrorMessage(err, 'RAG-Status konnte nicht geladen werden'),
          severity: 'error',
          href: '/admin/rag/pipeline',
        },
      ],
      activeVectors: 0,
      knowledgeArticles: 0,
    };
  }
}

async function probeEmail(): Promise<{
  subsystem: AdminHubSubsystemStatus;
  actions: AdminHubActionItem[];
}> {
  const checkedAt = nowIso();
  try {
    const channels = await listEmailChannels();
    const enabled = channels.filter((c) => c.enabled !== false && c.status !== 'disabled');
    const actions: AdminHubActionItem[] = [];

    if (channels.length === 0) {
      return {
        subsystem: {
          id: 'email',
          label: 'E-Mail',
          state: 'not_configured',
          detail: 'Kein E-Mail-Kanal konfiguriert',
          checkedAt,
          href: '/admin/email-channels',
        },
        actions: [
          {
            id: 'email-none',
            title: 'E-Mail-Kanal fehlt',
            detail: 'Legen Sie unter Mail & Schnittstellen einen Kanal an.',
            severity: 'warning',
            href: '/admin/email-channels',
          },
        ],
      };
    }

    const broken = enabled.filter(
      (c) => c.status === 'auth_error' || c.status === 'failed' || c.lastTestOk === false,
    );
    const pending = enabled.filter((c) => c.status === 'pending');
    const healthy = enabled.filter(
      (c) =>
        c.status === 'connected' ||
        c.status === 'verified' ||
        c.status === 'active' ||
        (!c.status && c.enabled !== false),
    );

    let state: AdminHubSubsystemState = 'ok';
    let detail = `${healthy.length} von ${enabled.length || channels.length} Kanälen betriebsbereit`;

    for (const c of broken) {
      actions.push({
        id: `email-err-${c.id}`,
        title: `E-Mail-Kanal gestört: ${c.email || c.name || c.id}`,
        detail: c.lastError || `Status: ${c.status}`,
        severity: 'error',
        href: '/admin/email-channels',
      });
    }
    for (const c of pending) {
      actions.push({
        id: `email-pending-${c.id}`,
        title: `E-Mail-Kanal ausstehend: ${c.email || c.name || c.id}`,
        detail: 'Verifizierung oder Verbindung noch nicht abgeschlossen.',
        severity: 'warning',
        href: '/admin/email-channels',
      });
    }

    if (broken.length > 0) {
      state = 'error';
      detail = `${broken.length} Kanal/Kanäle mit Fehler`;
    } else if (pending.length > 0 || healthy.length === 0) {
      state = 'degraded';
      detail =
        healthy.length === 0
          ? 'Kein aktiver E-Mail-Kanal verbunden'
          : `${pending.length} Kanal/Kanäle ausstehend`;
    }

    const lastCheck = enabled
      .map((c) => c.lastPolledAt || c.lastTestAt || c.updatedAt || null)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (lastCheck) {
      // Prefer channel check time when newer than probe start
      return {
        subsystem: {
          id: 'email',
          label: 'E-Mail',
          state,
          detail,
          checkedAt: String(lastCheck),
          href: '/admin/email-channels',
        },
        actions,
      };
    }

    return {
      subsystem: {
        id: 'email',
        label: 'E-Mail',
        state,
        detail,
        checkedAt,
        href: '/admin/email-channels',
      },
      actions,
    };
  } catch (err) {
    return {
      subsystem: {
        id: 'email',
        label: 'E-Mail',
        state: 'unknown',
        detail: safeErrorMessage(err, 'E-Mail-Status nicht verfügbar'),
        checkedAt,
        href: '/admin/email-channels',
      },
      actions: [
        {
          id: 'email-probe-failed',
          title: 'E-Mail-Statusprüfung fehlgeschlagen',
          detail: safeErrorMessage(err, 'Kanäle konnten nicht geladen werden'),
          severity: 'error',
          href: '/admin/email-channels',
        },
      ],
    };
  }
}

function dedupeActions(items: AdminHubActionItem[]): AdminHubActionItem[] {
  const seen = new Set<string>();
  const out: AdminHubActionItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  // Errors first
  out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  return out;
}

/**
 * Assemble Übersicht telemetry. `req` reserved for future tenant scoping.
 */
export async function buildAdminHubOverview(_req?: Request): Promise<AdminHubTelemetry> {
  const checkedAt = nowIso();

  const [
    controlPlane,
    ai,
    rag,
    email,
    tickets,
    users,
    vaultStores,
    aiUsageRes,
  ] = await Promise.all([
    probeControlPlane(),
    probeAiModels(),
    probeRag(TENANT_ID),
    probeEmail(),
    getDocsDirect('tickets', []).catch(() => []),
    getDocsDirect('users', []).catch(() => []),
    getDocsDirect('geist_vault_encrypted_stores', []).catch(() => []),
    queryDb(
      `SELECT COUNT(*)::int AS total,
              AVG(latency_ms)::float AS avg_latency
       FROM ai_usage_log WHERE workspace_id = $1`,
      [WORKSPACE_ID],
    ).catch(() => ({ rows: [{ total: 0, avg_latency: null }] })),
  ]);

  const subsystems = [controlPlane, ai.subsystem, rag.subsystem, email.subsystem];
  const actionItems = dedupeActions([
    ...ai.actions,
    ...rag.actions,
    ...email.actions,
    ...(controlPlane.state === 'error'
      ? [
          {
            id: 'control-plane-down',
            title: 'Control Plane gestört',
            detail: controlPlane.detail,
            severity: 'error' as const,
            href: controlPlane.href,
          },
        ]
      : []),
  ]);

  const activeAgents = users.filter(
    (u: { status?: string; isActive?: boolean; role?: string }) =>
      u.status === 'active' || u.isActive === true || u.role === 'agent' || u.role === 'admin',
  ).length;

  const aiRow = aiUsageRes.rows[0] as { total?: number; avg_latency?: number | null } | undefined;
  const rawAvg = aiRow?.avg_latency;
  const avgAiLatencyMs =
    rawAvg != null && Number.isFinite(Number(rawAvg)) ? Math.round(Number(rawAvg)) : null;
  const aiRequests = Number(aiRow?.total) || 0;
  const ticketsTotal = tickets.length;
  const vaultSecrets = vaultStores.length;

  const overallState = worstSubsystemState(subsystems.map((s) => s.state));

  return {
    activeAgents,
    ticketsTotal,
    vaultSecrets,
    knowledgeArticles: rag.knowledgeArticles,
    aiRequests,
    activeVectors: rag.activeVectors,
    primaryModel: ai.primaryModel,
    providers: ai.providers,
    avgAiLatencyMs,
    subsystems,
    actionItems,
    overallState,
    checkedAt,
    loadError: null,
    // Transitional aliases — not for SLA display
    ticketsProcessed: ticketsTotal,
    assetsManaged: ticketsTotal + vaultSecrets + rag.knowledgeArticles,
    latencyMs: avgAiLatencyMs ?? undefined,
  };
}
