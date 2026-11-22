import { getDocDirect, setDocDirect } from '../postgres-backend.js';
import {
  DEFAULT_TIME_TRACKING_SETTINGS,
  type TimeTrackingGraphConfig,
  type TimeTrackingSettings,
  type TimeSyncInterval,
} from './types.js';

const MODULE_COLLECTION = 'module_config';
const MODULE_DOC_ID = 'global';

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function asInterval(value: unknown): TimeSyncInterval {
  if (value === 'hourly' || value === 'daily' || value === 'disabled') return value;
  return DEFAULT_TIME_TRACKING_SETTINGS.syncInterval;
}

export function normalizeTimeTrackingSettings(
  raw: Partial<TimeTrackingSettings> | Record<string, unknown> | undefined,
): TimeTrackingSettings {
  const source = (raw ?? {}) as Partial<TimeTrackingSettings>;
  const graphRaw = (source.graph ?? {}) as Partial<TimeTrackingGraphConfig>;
  return {
    standardHourlyRate: asNumber(source.standardHourlyRate, DEFAULT_TIME_TRACKING_SETTINGS.standardHourlyRate),
    specialHourlyRate: asNumber(source.specialHourlyRate, DEFAULT_TIME_TRACKING_SETTINGS.specialHourlyRate),
    syncInterval: asInterval(source.syncInterval),
    graph: {
      enabled: graphRaw.enabled === true,
      tenantId: String(graphRaw.tenantId ?? ''),
      clientId: String(graphRaw.clientId ?? ''),
      clientSecret: String(graphRaw.clientSecret ?? ''),
      hasClientSecret: graphRaw.hasClientSecret === true || Boolean(String(graphRaw.clientSecret ?? '').trim()),
      siteId: String(graphRaw.siteId ?? ''),
      driveId: String(graphRaw.driveId ?? ''),
      workbookPathOrId: String(graphRaw.workbookPathOrId ?? ''),
      worksheetName: String(graphRaw.worksheetName || DEFAULT_TIME_TRACKING_SETTINGS.graph.worksheetName),
      tableName: String(graphRaw.tableName || DEFAULT_TIME_TRACKING_SETTINGS.graph.tableName),
    },
  };
}

/** Lädt Zeiterfassungs-Einstellungen aus module_config/global. */
export async function loadTimeTrackingSettings(): Promise<TimeTrackingSettings> {
  const doc = await getDocDirect(MODULE_COLLECTION, MODULE_DOC_ID);
  const nested = (doc?.timeTracking ?? {}) as Record<string, unknown>;
  return normalizeTimeTrackingSettings(nested);
}

/**
 * Persistiert Zeiterfassungs-Einstellungen in module_config/global.
 * Leeres clientSecret behält das bisherige Secret.
 */
export async function saveTimeTrackingSettings(
  patch: Partial<TimeTrackingSettings> & { graph?: Partial<TimeTrackingGraphConfig> },
): Promise<TimeTrackingSettings> {
  const existingDoc = (await getDocDirect(MODULE_COLLECTION, MODULE_DOC_ID)) || {};
  const current = normalizeTimeTrackingSettings(existingDoc.timeTracking);
  const nextGraph: TimeTrackingGraphConfig = {
    ...current.graph,
    ...(patch.graph || {}),
  };
  const incomingSecret = String(patch.graph?.clientSecret ?? '').trim();
  if (!incomingSecret) {
    nextGraph.clientSecret = current.graph.clientSecret;
  } else {
    nextGraph.clientSecret = incomingSecret;
  }
  nextGraph.hasClientSecret = Boolean(String(nextGraph.clientSecret || '').trim());

  const next = normalizeTimeTrackingSettings({
    ...current,
    ...patch,
    graph: nextGraph,
  });

  await setDocDirect(MODULE_COLLECTION, MODULE_DOC_ID, {
    ...existingDoc,
    timeTracking: {
      ...next,
      graph: {
        ...next.graph,
        // Persist secret, but clients get hasClientSecret via redact.
        clientSecret: next.graph.clientSecret,
      },
    },
  });

  return next;
}

/** Entfernt Secrets für API-Antworten. */
export function redactTimeTrackingSettings(settings: TimeTrackingSettings): TimeTrackingSettings {
  return {
    ...settings,
    graph: {
      ...settings.graph,
      clientSecret: '',
      hasClientSecret: Boolean(String(settings.graph.clientSecret || '').trim()) || settings.graph.hasClientSecret === true,
    },
  };
}

export function resolveHourlyRate(settings: TimeTrackingSettings, sonderzahlung: boolean): number {
  return sonderzahlung ? settings.specialHourlyRate : settings.standardHourlyRate;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundHours(value: number): number {
  // 0,25er-Schritte
  return Math.round(value * 4) / 4;
}
