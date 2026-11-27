import { getDocDirect, setDocDirect } from '../postgres-backend.js';
import {
  DEFAULT_TIME_TRACKING_SETTINGS,
  type TimeMonthlySyncDay,
  type TimeTrackingGraphConfig,
  type TimeTrackingMonthlySyncConfig,
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
  if (value === 'hourly' || value === 'daily' || value === 'monthly' || value === 'disabled') {
    return value;
  }
  return DEFAULT_TIME_TRACKING_SETTINGS.syncInterval;
}

function asDayOfMonth(value: unknown): TimeMonthlySyncDay {
  if (value === 'last') return 'last';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 28) return Math.floor(n);
  return DEFAULT_TIME_TRACKING_SETTINGS.monthlySharePointSync.dayOfMonth;
}

function asBerlinTime(value: unknown): string {
  const raw = String(value || '').trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  return DEFAULT_TIME_TRACKING_SETTINGS.monthlySharePointSync.timeBerlin;
}

export function normalizeTimeTrackingSettings(
  raw: Partial<TimeTrackingSettings> | Record<string, unknown> | undefined,
): TimeTrackingSettings {
  const source = (raw ?? {}) as Partial<TimeTrackingSettings>;
  const graphRaw = (source.graph ?? {}) as Partial<TimeTrackingGraphConfig>;
  const monthlyRaw = (source.monthlySharePointSync ?? {}) as Partial<TimeTrackingMonthlySyncConfig>;
  return {
    standardHourlyRate: asNumber(
      source.standardHourlyRate,
      DEFAULT_TIME_TRACKING_SETTINGS.standardHourlyRate,
    ),
    specialHourlyRate: asNumber(
      source.specialHourlyRate,
      DEFAULT_TIME_TRACKING_SETTINGS.specialHourlyRate,
    ),
    syncInterval: asInterval(source.syncInterval),
    graph: {
      enabled: graphRaw.enabled === true,
      tenantId: String(graphRaw.tenantId ?? ''),
      clientId: String(graphRaw.clientId ?? ''),
      clientSecret: String(graphRaw.clientSecret ?? ''),
      hasClientSecret:
        graphRaw.hasClientSecret === true || Boolean(String(graphRaw.clientSecret ?? '').trim()),
      siteId: String(graphRaw.siteId ?? ''),
      driveId: String(graphRaw.driveId ?? ''),
      workbookPathOrId: String(graphRaw.workbookPathOrId ?? ''),
      worksheetName: String(
        graphRaw.worksheetName || DEFAULT_TIME_TRACKING_SETTINGS.graph.worksheetName,
      ),
      tableName: String(graphRaw.tableName || DEFAULT_TIME_TRACKING_SETTINGS.graph.tableName),
    },
    monthlySharePointSync: {
      enabled: monthlyRaw.enabled === true,
      dayOfMonth: asDayOfMonth(monthlyRaw.dayOfMonth),
      timeBerlin: asBerlinTime(monthlyRaw.timeBerlin),
      lastRunAt: monthlyRaw.lastRunAt ? String(monthlyRaw.lastRunAt) : null,
      lastRunExported:
        typeof monthlyRaw.lastRunExported === 'number' ? monthlyRaw.lastRunExported : 0,
      lastRunError: monthlyRaw.lastRunError ? String(monthlyRaw.lastRunError) : null,
      lastRunPeriodKey: monthlyRaw.lastRunPeriodKey
        ? String(monthlyRaw.lastRunPeriodKey)
        : null,
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
  patch: Partial<TimeTrackingSettings> & {
    graph?: Partial<TimeTrackingGraphConfig>;
    monthlySharePointSync?: Partial<TimeTrackingMonthlySyncConfig>;
  },
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

  const nextMonthly: TimeTrackingMonthlySyncConfig = {
    ...current.monthlySharePointSync,
    ...(patch.monthlySharePointSync || {}),
  };

  const next = normalizeTimeTrackingSettings({
    ...current,
    ...patch,
    graph: nextGraph,
    monthlySharePointSync: nextMonthly,
  });

  await setDocDirect(MODULE_COLLECTION, MODULE_DOC_ID, {
    ...existingDoc,
    timeTracking: {
      ...next,
      graph: {
        ...next.graph,
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
      hasClientSecret:
        Boolean(String(settings.graph.clientSecret || '').trim()) ||
        settings.graph.hasClientSecret === true,
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
  return Math.round(value * 4) / 4;
}

/** Berlin calendar YYYY-MM-DD for "now". */
export function berlinTodayIso(now = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now) || now.toISOString().slice(0, 10)
  );
}

/** Berlin HH:mm for "now". */
export function berlinTimeHm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
}

export function lastDayOfBerlinMonth(isoDay: string): number {
  const [y, m] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** Period key for monthly lock: YYYY-MM + dayOfMonth setting. */
export function monthlySyncPeriodKey(
  settings: TimeTrackingMonthlySyncConfig,
  now = new Date(),
): string {
  const today = berlinTodayIso(now);
  const ym = today.slice(0, 7);
  return `${ym}:${settings.dayOfMonth}`;
}

export function shouldRunMonthlySharePointSync(
  settings: TimeTrackingSettings,
  now = new Date(),
): boolean {
  const cfg = settings.monthlySharePointSync;
  if (!cfg.enabled || !settings.graph.enabled) return false;
  const today = berlinTodayIso(now);
  const day = Number(today.slice(8, 10));
  const last = lastDayOfBerlinMonth(today);
  const dueDay = cfg.dayOfMonth === 'last' ? last : Number(cfg.dayOfMonth);
  if (day !== dueDay) return false;
  const hm = berlinTimeHm(now);
  if (hm < cfg.timeBerlin) return false;
  const period = monthlySyncPeriodKey(cfg, now);
  if (cfg.lastRunPeriodKey === period) return false;
  return true;
}
