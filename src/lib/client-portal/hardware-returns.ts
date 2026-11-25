/**
 * Per-organization Hardware-Rücklieferungen & Service-Level module.
 * Gated by organizations.hardware_returns_enabled (default false).
 */

import { randomUUID } from 'crypto';
import {
  encryptEmailChannelSecret,
  isEncryptedEmailSecret,
} from '../email-ingestion/channel-secret-crypto.js';
import { getDocsDirect, queryDb, withPgTransaction } from '../postgres-backend.js';
import { getOrganization } from './organizations.js';
import { isClientPortalRole } from './roles.js';
import { toIsoDateOnly } from './hardware-returns-dates.js';

export { toIsoDateOnly, formatDateDeOnly } from './hardware-returns-dates.js';

export type HardwareRoleToken = 'employee' | 'project_manager' | 'manager' | 'ceo';

export interface HardwareStageRecipients {
  to_roles: HardwareRoleToken[];
  cc_roles: HardwareRoleToken[];
  extra_to: string[];
  extra_cc: string[];
}

export interface HardwareMailTemplate {
  subject: string;
  body: string;
}

export interface HardwareReturnsCatalogs {
  statuses: string[];
  device_types: string[];
  service_levels: string[];
  slas: string[];
  shipping_methods: string[];
}

export const DEFAULT_HARDWARE_RETURNS_CATALOGS: HardwareReturnsCatalogs = {
  statuses: ['Neu', 'Warten auf Third Level', 'In Bearbeitung', 'Geschlossen'],
  device_types: [
    'VL2E Adapter',
    'Secutest Pro',
    'Secutest S2 N+10',
    'PRCD Adapter',
    'BT Adapter',
    'Tablet & Dockingstation',
  ],
  service_levels: ['1', '2', '3'],
  slas: ['Niedrig', 'Normal', 'Hoch'],
  shipping_methods: [
    'Standard',
    'Express',
    'E-9 Express',
    'E-1030 Express',
    'E-1200 Express',
    'E-Samstag Express',
    'Samstag',
  ],
};

export interface M365DirectorySyncConfig {
  enabled: boolean;
  /** Optional Entra Security/M365 Group Object ID — sync only that group's members. */
  entra_group_id: string | null;
  /** Optional credential overrides (else org M365 Send-As / Graph channel). */
  tenant_id: string | null;
  client_id: string | null;
  /** Encrypted at rest with EMAIL_CHANNEL_SECRET_KEY; redacted in API responses. */
  client_secret: string | null;
  client_secret_set: boolean;
  last_synced_at: string | null;
  last_sync_count: number;
  last_sync_error: string | null;
}

export interface HardwareReturnsConfig {
  auto_send_enabled: boolean;
  mail1_days_after_delivery: number;
  mail2_days_after_mail1: number;
  mail3_days_after_mail2: number;
  ceo_name: string | null;
  ceo_email: string | null;
  fallback_manager_email: string | null;
  /** Org-scoped display prefix for return numbers (e.g. DPG → #DPG-1). */
  id_prefix: string;
  catalogs: HardwareReturnsCatalogs;
  m365_directory_sync: M365DirectorySyncConfig;
  stage_recipients: {
    mail1: HardwareStageRecipients;
    mail2: HardwareStageRecipients;
    mail3: HardwareStageRecipients;
  };
  templates: {
    mail1: HardwareMailTemplate;
    mail2: HardwareMailTemplate;
    mail3: HardwareMailTemplate;
  };
}

export interface HardwareStageOverride {
  to: string[];
  cc: string[];
}

/** Free-form org-configured status string (default "Neu"). Legacy English values still accepted. */
export type HardwareReturnStatus = string;

export interface HardwareReturnActivityEntry {
  at: string;
  type: string;
  actor?: string | null;
  message?: string | null;
  to?: string[];
  cc?: string[];
  stage?: 1 | 2 | 3;
  meta?: Record<string, unknown>;
}

export interface TicketHardwareReturnRecord {
  id: string;
  organization_id: string;
  /** Legacy soft link — nullable; standalone returns keep this null. */
  ticket_id: string | null;
  return_number: string | null;
  /** Betreff — optional/nullable (no longer required). */
  subject: string | null;
  employee_name: string | null;
  employee_email: string | null;
  assignee_name: string | null;
  /** Bearbeiter user id (defaults to creator). */
  assignee_user_id: string | null;
  /** Synced M365 directory employee when selected. */
  directory_user_id: string | null;
  status: HardwareReturnStatus;
  description: string | null;
  activity_log: HardwareReturnActivityEntry[];
  external_ref_id: string | null;
  /** Free-form service level (catalog-driven; was 1|2|3). */
  service_level: string | null;
  /** SLA label (default Normal). */
  sla: string | null;
  time_sl1_minutes: number;
  time_sl2_minutes: number;
  time_sl3_minutes: number;
  exported: boolean;
  exported_at: string | null;
  request_type: string | null;
  device_details: string | null;
  device_old_type: string | null;
  device_old_serial: string | null;
  device_new_type: string | null;
  device_new_serial: string | null;
  employee_phone: string | null;
  employee_mobile: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
  manager_name: string | null;
  manager_email: string | null;
  ceo_email_override: string | null;
  stage_recipients_override: {
    mail1?: HardwareStageOverride;
    mail2?: HardwareStageOverride;
    mail3?: HardwareStageOverride;
  } | null;
  solution_summary: string | null;
  shipping_method: string | null;
  shipping_reference: string | null;
  return_required: boolean;
  delivery_date: string | null;
  return_due_date: string | null;
  auto_reminder_enabled: boolean;
  /** Optional per-record mail schedule overrides (NULL → org defaults 14/7/7). */
  mail1_scheduled_date: string | null;
  mail2_scheduled_date: string | null;
  mail3_scheduled_date: string | null;
  mail1_sent_at: string | null;
  mail1_sent_recipients: HardwareStageOverride | null;
  mail2_sent_at: string | null;
  mail2_sent_recipients: HardwareStageOverride | null;
  mail3_sent_at: string | null;
  mail3_sent_recipients: HardwareStageOverride | null;
  returned: boolean;
  returned_at: string | null;
  created_at: string;
  updated_at: string;
}

export type TicketHardwareReturnInput = Partial<
  Omit<TicketHardwareReturnRecord, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

/** Legacy English statuses kept for older rows; new default is German "Neu". */
const LEGACY_STATUS_MAP: Record<string, string> = {
  pending: 'in_progress',
  on_hold: 'waiting',
  waiting_customer: 'waiting',
  resolved: 'closed',
};

export function normalizeHardwareReturnStatus(raw: unknown): HardwareReturnStatus {
  const original = String(raw ?? '').trim();
  if (!original) return 'Neu';
  const key = original.toLowerCase().replace(/-/g, '_');
  if (LEGACY_STATUS_MAP[key]) return LEGACY_STATUS_MAP[key];
  // Allow any org-configured status string (including German catalogs).
  return original.slice(0, 120);
}

/** Uppercase alphanumeric prefix from org name (e.g. "DPG" → "DPG", "Acme Corp" → "AC"). */
export function deriveIdPrefixFromOrgName(name: string): string {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    const acronym = words
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, '').charAt(0))
      .join('')
      .toUpperCase();
    if (acronym.length >= 2) return acronym.slice(0, 12);
  }
  const alnum = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toUpperCase();
  return (alnum || 'ORG').slice(0, 12);
}

export function formatReturnNumber(prefix: string, seq: number): string {
  const clean = String(prefix || 'ORG')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12) || 'ORG';
  const n = Math.max(1, Math.floor(Number(seq) || 1));
  return `${clean}-${n}`;
}

/** Display form with leading hash (#DPG-1). */
export function formatReturnNumberDisplay(returnNumber: string | null | undefined): string {
  const raw = String(returnNumber || '').trim();
  if (!raw) return '';
  return raw.startsWith('#') ? raw : `#${raw}`;
}

/** Missing / UUID-slice / RL-LEGACY placeholders need sequential backfill. */
export function needsReturnNumberBackfill(returnNumber: string | null | undefined): boolean {
  const raw = String(returnNumber || '').trim();
  if (!raw) return true;
  if (/^RL-LEGACY-/i.test(raw)) return true;
  // Bare UUID slice e.g. c6175496
  if (/^[0-9a-f]{6,12}$/i.test(raw)) return true;
  return false;
}

function asCatalogList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out = raw
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 0 && x.length <= 200)
    .slice(0, 100);
  return out.length ? out : [...fallback];
}

function mergeCatalogs(
  patch: Partial<HardwareReturnsCatalogs> | undefined,
): HardwareReturnsCatalogs {
  const base = DEFAULT_HARDWARE_RETURNS_CATALOGS;
  if (!patch || typeof patch !== 'object') {
    return {
      statuses: [...base.statuses],
      device_types: [...base.device_types],
      service_levels: [...base.service_levels],
      slas: [...base.slas],
      shipping_methods: [...base.shipping_methods],
    };
  }
  return {
    statuses: asCatalogList(patch.statuses, base.statuses),
    device_types: asCatalogList(patch.device_types, base.device_types),
    service_levels: asCatalogList(patch.service_levels, base.service_levels),
    slas: asCatalogList(patch.slas, base.slas),
    shipping_methods: asCatalogList(patch.shipping_methods, base.shipping_methods),
  };
}

const ROLE_TOKENS: HardwareRoleToken[] = ['employee', 'project_manager', 'manager', 'ceo'];

function defaultStage(to: HardwareRoleToken[], cc: HardwareRoleToken[]): HardwareStageRecipients {
  return { to_roles: to, cc_roles: cc, extra_to: [], extra_cc: [] };
}

export function defaultM365DirectorySyncConfig(): M365DirectorySyncConfig {
  return {
    enabled: false,
    entra_group_id: null,
    tenant_id: null,
    client_id: null,
    client_secret: null,
    client_secret_set: false,
    last_synced_at: null,
    last_sync_count: 0,
    last_sync_error: null,
  };
}

export function defaultHardwareReturnsConfig(): HardwareReturnsConfig {
  return {
    auto_send_enabled: false,
    mail1_days_after_delivery: 14,
    mail2_days_after_mail1: 7,
    mail3_days_after_mail2: 7,
    ceo_name: null,
    ceo_email: null,
    fallback_manager_email: null,
    id_prefix: 'DPG',
    catalogs: mergeCatalogs(undefined),
    m365_directory_sync: defaultM365DirectorySyncConfig(),
    stage_recipients: {
      mail1: defaultStage(['employee'], []),
      mail2: defaultStage(['employee'], ['project_manager']),
      mail3: defaultStage(['employee'], ['project_manager', 'manager', 'ceo']),
    },
    templates: {
      mail1: {
        subject: 'Erinnerung: Hardware-Rücklieferung fällig',
        body:
          'Sehr geehrte/r {{employee_name}},\n\nbitte denken Sie an die Rücklieferung der bereitgestellten Hardware.\nFällig am: {{return_due_date}}\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
      },
      mail2: {
        subject: '2. Erinnerung: Hardware-Rücklieferung überfällig',
        body:
          'Sehr geehrte/r {{employee_name}},\n\ndie Rücklieferung ist überfällig (Fällig am {{return_due_date}}).\nBitte veranlassen Sie die Rückgabe umgehend.\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
      },
      mail3: {
        subject: 'Letzte Mahnung: Hardware-Rücklieferung',
        body:
          'Sehr geehrte/r {{employee_name}},\n\ndies ist die letzte Mahnung zur Hardware-Rücklieferung (Fällig am {{return_due_date}}).\nDer/die Vorgesetzte und die Geschäftsführung wurden in CC gesetzt.\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
      },
    },
  };
}

function asRoleList(raw: unknown): HardwareRoleToken[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => String(r || '').trim())
    .filter((r): r is HardwareRoleToken => ROLE_TOKENS.includes(r as HardwareRoleToken));
}

function asEmailList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.includes('@') && e.length <= 320)
    .slice(0, 20);
}

function mergeStage(
  base: HardwareStageRecipients,
  patch: Partial<HardwareStageRecipients> | undefined,
): HardwareStageRecipients {
  if (!patch || typeof patch !== 'object') return { ...base, to_roles: [...base.to_roles], cc_roles: [...base.cc_roles], extra_to: [...base.extra_to], extra_cc: [...base.extra_cc] };
  return {
    to_roles: patch.to_roles !== undefined ? asRoleList(patch.to_roles) : [...base.to_roles],
    cc_roles: patch.cc_roles !== undefined ? asRoleList(patch.cc_roles) : [...base.cc_roles],
    extra_to: patch.extra_to !== undefined ? asEmailList(patch.extra_to) : [...base.extra_to],
    extra_cc: patch.extra_cc !== undefined ? asEmailList(patch.extra_cc) : [...base.extra_cc],
  };
}

function mergeTemplate(
  base: HardwareMailTemplate,
  patch: Partial<HardwareMailTemplate> | undefined,
): HardwareMailTemplate {
  if (!patch || typeof patch !== 'object') return { ...base };
  return {
    subject:
      patch.subject !== undefined
        ? String(patch.subject || '').trim().slice(0, 500) || base.subject
        : base.subject,
    body:
      patch.body !== undefined
        ? String(patch.body || '').trim().slice(0, 20_000) || base.body
        : base.body,
  };
}

/** Normalize stored/partial JSON into a full config with safe defaults. */
export function normalizeHardwareReturnsConfig(raw: unknown): HardwareReturnsConfig {
  const defaults = defaultHardwareReturnsConfig();
  const src =
    raw == null
      ? {}
      : typeof raw === 'string'
        ? (JSON.parse(raw || '{}') as Record<string, unknown>)
        : (raw as Record<string, unknown>);

  const stageSrc =
    src.stage_recipients && typeof src.stage_recipients === 'object'
      ? (src.stage_recipients as Record<string, Partial<HardwareStageRecipients>>)
      : {};
  const templateSrc =
    src.templates && typeof src.templates === 'object'
      ? (src.templates as Record<string, Partial<HardwareMailTemplate>>)
      : {};

  const catalogSrc =
    src.catalogs && typeof src.catalogs === 'object'
      ? (src.catalogs as Partial<HardwareReturnsCatalogs>)
      : undefined;
  const rawPrefix =
    src.id_prefix == null || String(src.id_prefix).trim() === ''
      ? defaults.id_prefix
      : String(src.id_prefix)
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase()
          .slice(0, 12) || defaults.id_prefix;
  const syncSrc =
    src.m365_directory_sync && typeof src.m365_directory_sync === 'object'
      ? (src.m365_directory_sync as Partial<M365DirectorySyncConfig> & Record<string, unknown>)
      : undefined;

  return {
    auto_send_enabled: src.auto_send_enabled === true,
    mail1_days_after_delivery:
      Number.isFinite(Number(src.mail1_days_after_delivery)) && Number(src.mail1_days_after_delivery) >= 0
        ? Math.min(365, Math.floor(Number(src.mail1_days_after_delivery)))
        : defaults.mail1_days_after_delivery,
    mail2_days_after_mail1:
      Number.isFinite(Number(src.mail2_days_after_mail1)) && Number(src.mail2_days_after_mail1) >= 0
        ? Math.min(365, Math.floor(Number(src.mail2_days_after_mail1)))
        : defaults.mail2_days_after_mail1,
    mail3_days_after_mail2:
      Number.isFinite(Number(src.mail3_days_after_mail2)) && Number(src.mail3_days_after_mail2) >= 0
        ? Math.min(365, Math.floor(Number(src.mail3_days_after_mail2)))
        : defaults.mail3_days_after_mail2,
    ceo_name:
      src.ceo_name == null || String(src.ceo_name).trim() === ''
        ? null
        : String(src.ceo_name).trim().slice(0, 200),
    ceo_email:
      src.ceo_email == null || String(src.ceo_email).trim() === ''
        ? null
        : String(src.ceo_email).trim().toLowerCase().slice(0, 320),
    fallback_manager_email:
      src.fallback_manager_email == null || String(src.fallback_manager_email).trim() === ''
        ? null
        : String(src.fallback_manager_email).trim().toLowerCase().slice(0, 320),
    id_prefix: rawPrefix,
    catalogs: mergeCatalogs(catalogSrc),
    m365_directory_sync: mergeM365DirectorySync(defaults.m365_directory_sync, syncSrc),
    stage_recipients: {
      mail1: mergeStage(defaults.stage_recipients.mail1, stageSrc.mail1),
      mail2: mergeStage(defaults.stage_recipients.mail2, stageSrc.mail2),
      mail3: mergeStage(defaults.stage_recipients.mail3, stageSrc.mail3),
    },
    templates: {
      mail1: mergeTemplate(defaults.templates.mail1, templateSrc.mail1),
      mail2: mergeTemplate(defaults.templates.mail2, templateSrc.mail2),
      mail3: mergeTemplate(defaults.templates.mail3, templateSrc.mail3),
    },
  };
}

function mergeM365DirectorySync(
  base: M365DirectorySyncConfig,
  patch: (Partial<M365DirectorySyncConfig> & Record<string, unknown>) | undefined,
): M365DirectorySyncConfig {
  if (!patch || typeof patch !== 'object') return { ...base };
  const rawSecret =
    patch.client_secret !== undefined ? String(patch.client_secret ?? '').trim() : undefined;
  let clientSecret = base.client_secret;
  let secretSet = Boolean(base.client_secret) || base.client_secret_set;
  if (rawSecret !== undefined) {
    if (!rawSecret || rawSecret === '••••••••') {
      // Keep existing encrypted secret when masked/empty patch.
      clientSecret = base.client_secret;
      secretSet = Boolean(base.client_secret) || base.client_secret_set;
    } else if (isEncryptedEmailSecret(rawSecret)) {
      clientSecret = rawSecret;
      secretSet = true;
    } else {
      clientSecret = encryptEmailChannelSecret(rawSecret);
      secretSet = true;
    }
  }
  return {
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : base.enabled,
    entra_group_id:
      patch.entra_group_id !== undefined
        ? patch.entra_group_id == null || String(patch.entra_group_id).trim() === ''
          ? null
          : String(patch.entra_group_id).trim().slice(0, 80)
        : base.entra_group_id,
    tenant_id:
      patch.tenant_id !== undefined
        ? patch.tenant_id == null || String(patch.tenant_id).trim() === ''
          ? null
          : String(patch.tenant_id).trim().slice(0, 80)
        : base.tenant_id,
    client_id:
      patch.client_id !== undefined
        ? patch.client_id == null || String(patch.client_id).trim() === ''
          ? null
          : String(patch.client_id).trim().slice(0, 80)
        : base.client_id,
    client_secret: clientSecret,
    client_secret_set: secretSet,
    last_synced_at:
      patch.last_synced_at !== undefined
        ? (() => {
            if (!patch.last_synced_at) return null;
            const d = new Date(String(patch.last_synced_at));
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
          })()
        : base.last_synced_at,
    last_sync_count:
      patch.last_sync_count !== undefined
        ? Math.max(0, Math.floor(Number(patch.last_sync_count) || 0))
        : base.last_sync_count,
    last_sync_error:
      patch.last_sync_error !== undefined
        ? patch.last_sync_error == null || String(patch.last_sync_error).trim() === ''
          ? null
          : String(patch.last_sync_error).trim().slice(0, 2000)
        : base.last_sync_error,
  };
}

/** Redact secrets before returning hardware_returns_config to clients. */
export function sanitizeHardwareReturnsConfigForClient(
  config: HardwareReturnsConfig | null | undefined,
): HardwareReturnsConfig | null {
  if (!config) return null;
  const sync = config.m365_directory_sync || defaultM365DirectorySyncConfig();
  return {
    ...config,
    m365_directory_sync: {
      ...sync,
      client_secret: sync.client_secret || sync.client_secret_set ? '••••••••' : null,
      client_secret_set: Boolean(sync.client_secret) || sync.client_secret_set,
    },
  };
}

/** Resolve id_prefix from config, falling back to org name derivation. */
export function resolveHardwareReturnIdPrefix(params: {
  config?: HardwareReturnsConfig | null;
  organizationName?: string | null;
}): string {
  const fromConfig = String(params.config?.id_prefix || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
  if (fromConfig) return fromConfig;
  return deriveIdPrefixFromOrgName(params.organizationName || '');
}

export function isHardwareReturnsEnabled(org: {
  hardware_returns_enabled?: boolean | null;
} | null | undefined): boolean {
  return Boolean(org?.hardware_returns_enabled);
}

export async function orgHasHardwareReturnsEnabled(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId) return false;
  const org = await getOrganization(organizationId);
  return isHardwareReturnsEnabled(org as any);
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nullStr(v: unknown, max = 2000): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function nullEmail(v: unknown): string | null {
  const s = nullStr(v, 320);
  return s ? s.toLowerCase() : null;
}

function parseStageOverride(raw: unknown): TicketHardwareReturnRecord['stage_recipients_override'] {
  if (raw == null) return null;
  const src =
    typeof raw === 'string'
      ? (JSON.parse(raw || 'null') as Record<string, unknown> | null)
      : (raw as Record<string, unknown>);
  if (!src || typeof src !== 'object') return null;
  const out: NonNullable<TicketHardwareReturnRecord['stage_recipients_override']> = {};
  for (const key of ['mail1', 'mail2', 'mail3'] as const) {
    const stage = src[key];
    if (!stage || typeof stage !== 'object') continue;
    out[key] = {
      to: asEmailList((stage as any).to),
      cc: asEmailList((stage as any).cc),
    };
  }
  return Object.keys(out).length ? out : null;
}

function parseSentRecipients(raw: unknown): HardwareStageOverride | null {
  if (raw == null) return null;
  const src =
    typeof raw === 'string'
      ? (JSON.parse(raw || 'null') as Record<string, unknown> | null)
      : (raw as Record<string, unknown>);
  if (!src || typeof src !== 'object') return null;
  return {
    to: asEmailList(src.to),
    cc: asEmailList(src.cc),
  };
}

function parseActivityLog(raw: unknown): HardwareReturnActivityEntry[] {
  if (raw == null) return [];
  const src =
    typeof raw === 'string' ? (JSON.parse(raw || '[]') as unknown) : raw;
  if (!Array.isArray(src)) return [];
  return src
    .filter((e) => e && typeof e === 'object')
    .map((e: any) => ({
      at: String(e.at || ''),
      type: String(e.type || 'note'),
      actor: e.actor != null ? String(e.actor) : null,
      message: e.message != null ? String(e.message) : null,
      to: Array.isArray(e.to) ? e.to.map((x: unknown) => String(x)) : undefined,
      cc: Array.isArray(e.cc) ? e.cc.map((x: unknown) => String(x)) : undefined,
      stage: e.stage === 1 || e.stage === 2 || e.stage === 3 ? e.stage : undefined,
      meta: e.meta && typeof e.meta === 'object' ? e.meta : undefined,
    }))
    .slice(-500);
}

export function mapHardwareRow(row: any): TicketHardwareReturnRecord {
  const returned = row.returned === true || row.returned === 't';
  const slRaw =
    row.service_level == null || String(row.service_level).trim() === ''
      ? null
      : String(row.service_level).trim().slice(0, 80);
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    ticket_id: row.ticket_id == null || row.ticket_id === '' ? null : String(row.ticket_id),
    return_number: nullStr(row.return_number, 120),
    subject: nullStr(row.subject, 500),
    employee_name: nullStr(row.employee_name, 255),
    employee_email: nullEmail(row.employee_email),
    assignee_name: nullStr(row.assignee_name, 255),
    assignee_user_id: nullStr(row.assignee_user_id, 128),
    directory_user_id: nullStr(row.directory_user_id, 128),
    status: returned ? (row.status ? normalizeHardwareReturnStatus(row.status) : 'returned') : normalizeHardwareReturnStatus(row.status),
    description: nullStr(row.description, 100_000),
    activity_log: parseActivityLog(row.activity_log),
    external_ref_id: nullStr(row.external_ref_id, 120),
    service_level: slRaw,
    sla: nullStr(row.sla, 80) || 'Normal',
    time_sl1_minutes: Math.max(0, Number(row.time_sl1_minutes) || 0),
    time_sl2_minutes: Math.max(0, Number(row.time_sl2_minutes) || 0),
    time_sl3_minutes: Math.max(0, Number(row.time_sl3_minutes) || 0),
    exported: row.exported === true || row.exported === 't',
    exported_at: row.exported_at ? new Date(row.exported_at).toISOString() : null,
    request_type: nullStr(row.request_type, 200),
    device_details: nullStr(row.device_details, 4000),
    device_old_type: nullStr(row.device_old_type, 200),
    device_old_serial: nullStr(row.device_old_serial, 200),
    device_new_type: nullStr(row.device_new_type, 200),
    device_new_serial: nullStr(row.device_new_serial, 200),
    employee_phone: nullStr(row.employee_phone, 80),
    employee_mobile: nullStr(row.employee_mobile, 80),
    project_manager_name: nullStr(row.project_manager_name, 200),
    project_manager_email: nullEmail(row.project_manager_email),
    manager_name: nullStr(row.manager_name, 200),
    manager_email: nullEmail(row.manager_email),
    ceo_email_override: nullEmail(row.ceo_email_override),
    stage_recipients_override: parseStageOverride(row.stage_recipients_override),
    solution_summary: nullStr(row.solution_summary, 8000),
    shipping_method: nullStr(row.shipping_method, 120),
    shipping_reference: nullStr(row.shipping_reference, 200),
    return_required: row.return_required === true || row.return_required === 't',
    delivery_date: toIsoDateOnly(row.delivery_date),
    return_due_date: toIsoDateOnly(row.return_due_date),
    auto_reminder_enabled:
      row.auto_reminder_enabled !== false && row.auto_reminder_enabled !== 'f',
    mail1_scheduled_date: toIsoDateOnly(row.mail1_scheduled_date),
    mail2_scheduled_date: toIsoDateOnly(row.mail2_scheduled_date),
    mail3_scheduled_date: toIsoDateOnly(row.mail3_scheduled_date),
    mail1_sent_at: row.mail1_sent_at ? new Date(row.mail1_sent_at).toISOString() : null,
    mail1_sent_recipients: parseSentRecipients(row.mail1_sent_recipients),
    mail2_sent_at: row.mail2_sent_at ? new Date(row.mail2_sent_at).toISOString() : null,
    mail2_sent_recipients: parseSentRecipients(row.mail2_sent_recipients),
    mail3_sent_at: row.mail3_sent_at ? new Date(row.mail3_sent_at).toISOString() : null,
    mail3_sent_recipients: parseSentRecipients(row.mail3_sent_recipients),
    returned,
    returned_at: row.returned_at ? new Date(row.returned_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

/** Client-safe projection (no internal-only secrets — none today). */
export function sanitizeHardwareReturnForClient(
  row: TicketHardwareReturnRecord,
): TicketHardwareReturnRecord {
  return { ...row };
}

export function normalizeHardwareReturnInput(
  input: TicketHardwareReturnInput,
  opts?: { existing?: TicketHardwareReturnRecord | null; mail1Days?: number },
): TicketHardwareReturnInput {
  const existing = opts?.existing || null;
  const mail1Days = opts?.mail1Days ?? 14;
  const next: TicketHardwareReturnInput = { ...(existing || {}), ...input };

  if (input.service_level !== undefined) {
    next.service_level =
      input.service_level == null || String(input.service_level).trim() === ''
        ? null
        : String(input.service_level).trim().slice(0, 80);
  }
  if (input.sla !== undefined) {
    next.sla =
      input.sla == null || String(input.sla).trim() === ''
        ? 'Normal'
        : String(input.sla).trim().slice(0, 80);
  }
  for (const key of ['time_sl1_minutes', 'time_sl2_minutes', 'time_sl3_minutes'] as const) {
    if (input[key] !== undefined) {
      next[key] = Math.max(0, Math.min(24 * 60 * 30, Math.floor(Number(input[key]) || 0)));
    }
  }
  if (input.delivery_date !== undefined) {
    next.delivery_date = toIsoDateOnly(input.delivery_date);
  } else if (existing?.delivery_date !== undefined) {
    // Re-normalize existing so a stale "Fri Nov 20" never reaches PG DATE columns.
    next.delivery_date = toIsoDateOnly(existing.delivery_date);
  }
  // Auto-default return_due_date = delivery_date + N days when delivery set and due not explicitly provided.
  if (input.delivery_date !== undefined && input.return_due_date === undefined) {
    if (next.delivery_date) {
      next.return_due_date = addDaysIso(next.delivery_date, mail1Days);
    }
  } else if (input.return_due_date !== undefined) {
    next.return_due_date = toIsoDateOnly(input.return_due_date);
  } else if (existing?.return_due_date !== undefined) {
    next.return_due_date = toIsoDateOnly(existing.return_due_date);
  }

  for (const key of [
    'mail1_scheduled_date',
    'mail2_scheduled_date',
    'mail3_scheduled_date',
  ] as const) {
    if (input[key] !== undefined) {
      next[key] = toIsoDateOnly(input[key]);
    } else if (existing?.[key] !== undefined) {
      next[key] = toIsoDateOnly(existing[key]);
    }
  }

  if (input.stage_recipients_override !== undefined) {
    next.stage_recipients_override = parseStageOverride(input.stage_recipients_override);
  }

  if (input.subject !== undefined) {
    // Betreff is optional — empty/null stays null (no forced "Hardware" default).
    next.subject = nullStr(input.subject, 500);
  }
  if (input.employee_name !== undefined) {
    next.employee_name = nullStr(input.employee_name, 255);
  }
  if (input.employee_email !== undefined) {
    next.employee_email = nullEmail(input.employee_email);
  }
  if (input.assignee_name !== undefined) {
    next.assignee_name = nullStr(input.assignee_name, 255);
  }
  if (input.assignee_user_id !== undefined) {
    next.assignee_user_id = nullStr(input.assignee_user_id, 128);
  }
  if (input.directory_user_id !== undefined) {
    next.directory_user_id = nullStr(input.directory_user_id, 128);
  }
  if (input.status !== undefined) {
    next.status = normalizeHardwareReturnStatus(input.status);
  }
  if (input.description !== undefined) {
    next.description = nullStr(input.description, 100_000);
  }
  if (input.return_number !== undefined) {
    next.return_number = nullStr(input.return_number, 120);
  }
  if (input.ticket_id !== undefined) {
    next.ticket_id =
      input.ticket_id == null || String(input.ticket_id).trim() === ''
        ? null
        : String(input.ticket_id).trim().slice(0, 255);
  }
  if (input.activity_log !== undefined && Array.isArray(input.activity_log)) {
    next.activity_log = input.activity_log;
  }

  next.external_ref_id =
    input.external_ref_id !== undefined ? nullStr(input.external_ref_id, 120) : next.external_ref_id;
  next.request_type =
    input.request_type !== undefined ? nullStr(input.request_type, 200) : next.request_type;
  next.device_details =
    input.device_details !== undefined ? nullStr(input.device_details, 4000) : next.device_details;
  next.device_old_type =
    input.device_old_type !== undefined ? nullStr(input.device_old_type, 200) : next.device_old_type;
  next.device_old_serial =
    input.device_old_serial !== undefined
      ? nullStr(input.device_old_serial, 200)
      : next.device_old_serial;
  next.device_new_type =
    input.device_new_type !== undefined ? nullStr(input.device_new_type, 200) : next.device_new_type;
  next.device_new_serial =
    input.device_new_serial !== undefined
      ? nullStr(input.device_new_serial, 200)
      : next.device_new_serial;
  next.employee_phone =
    input.employee_phone !== undefined ? nullStr(input.employee_phone, 80) : next.employee_phone;
  next.employee_mobile =
    input.employee_mobile !== undefined ? nullStr(input.employee_mobile, 80) : next.employee_mobile;
  next.project_manager_name =
    input.project_manager_name !== undefined
      ? nullStr(input.project_manager_name, 200)
      : next.project_manager_name;
  next.project_manager_email =
    input.project_manager_email !== undefined
      ? nullEmail(input.project_manager_email)
      : next.project_manager_email;
  next.manager_name =
    input.manager_name !== undefined ? nullStr(input.manager_name, 200) : next.manager_name;
  next.manager_email =
    input.manager_email !== undefined ? nullEmail(input.manager_email) : next.manager_email;
  next.ceo_email_override =
    input.ceo_email_override !== undefined
      ? nullEmail(input.ceo_email_override)
      : next.ceo_email_override;
  next.solution_summary =
    input.solution_summary !== undefined
      ? nullStr(input.solution_summary, 8000)
      : next.solution_summary;
  next.shipping_method =
    input.shipping_method !== undefined ? nullStr(input.shipping_method, 120) : next.shipping_method;
  next.shipping_reference =
    input.shipping_reference !== undefined
      ? nullStr(input.shipping_reference, 200)
      : next.shipping_reference;

  if (input.return_required !== undefined) next.return_required = Boolean(input.return_required);
  if (input.auto_reminder_enabled !== undefined) {
    next.auto_reminder_enabled = Boolean(input.auto_reminder_enabled);
  }
  if (input.exported !== undefined) {
    next.exported = Boolean(input.exported);
    if (next.exported && !next.exported_at) next.exported_at = new Date().toISOString();
    if (!next.exported) next.exported_at = null;
  }
  if (input.returned !== undefined) {
    next.returned = Boolean(input.returned);
    if (next.returned && input.returned_at === undefined && !next.returned_at) {
      next.returned_at = new Date().toISOString();
    }
    // Not-returned must never keep a stale returned_at (even if client also sends one).
    if (!next.returned) next.returned_at = null;
  }
  if (input.returned_at !== undefined && next.returned) {
    const raw = input.returned_at ? new Date(String(input.returned_at)) : null;
    if (raw && Number.isNaN(raw.getTime())) {
      throw Object.assign(new Error('Ungültiger returned_at Zeitstempel.'), { status: 400 });
    }
    next.returned_at = raw ? raw.toISOString() : null;
  }
  if (!next.returned) next.returned_at = null;

  return next;
}

export async function getHardwareReturnById(
  id: string,
): Promise<TicketHardwareReturnRecord | null> {
  const res = await queryDb(
    `SELECT * FROM ticket_hardware_returns WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  if (!res.rowCount) return null;
  return mapHardwareRow(res.rows[0]);
}

export async function getHardwareReturnByTicketId(
  ticketId: string,
): Promise<TicketHardwareReturnRecord | null> {
  const res = await queryDb(
    `SELECT * FROM ticket_hardware_returns WHERE ticket_id = $1 LIMIT 1`,
    [ticketId],
  );
  if (!res.rowCount) return null;
  return mapHardwareRow(res.rows[0]);
}

/**
 * Resolve by hardware-return UUID first, then legacy ticket_id (transition).
 */
export async function resolveHardwareReturnByParam(
  idOrTicketId: string,
  organizationId?: string | null,
): Promise<TicketHardwareReturnRecord | null> {
  const raw = String(idOrTicketId || '').trim();
  if (!raw) return null;
  const uuidLike =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
  let row: TicketHardwareReturnRecord | null = null;
  if (uuidLike) {
    row = await getHardwareReturnById(raw);
  }
  if (!row) {
    row = await getHardwareReturnByTicketId(raw);
  }
  if (!row && organizationId) {
    const byNumber = await queryDb(
      `SELECT * FROM ticket_hardware_returns
       WHERE organization_id = $1 AND (return_number = $2 OR external_ref_id = $2)
       LIMIT 1`,
      [organizationId, raw],
    );
    if (byNumber.rowCount) row = mapHardwareRow(byNumber.rows[0]);
  }
  if (row && organizationId && row.organization_id !== organizationId) return null;
  return row;
}

/**
 * Atomically allocate the next return_number for an org
 * (`UPDATE organizations SET hardware_returns_seq = hardware_returns_seq + 1 … RETURNING`).
 * Prefer calling inside withPgTransaction together with the INSERT.
 */
export async function allocateReturnNumber(
  organizationId: string,
  opts?: { prefix?: string | null; organizationName?: string | null; client?: { query: typeof queryDb } },
): Promise<string> {
  const q = opts?.client?.query?.bind(opts.client) || queryDb;
  const org = await getOrganization(organizationId);
  const prefix = resolveHardwareReturnIdPrefix({
    config: opts?.prefix
      ? ({ id_prefix: opts.prefix } as HardwareReturnsConfig)
      : org?.hardware_returns_config,
    organizationName: opts?.organizationName || org?.name,
  });
  const res = await q(
    `UPDATE organizations
     SET hardware_returns_seq = hardware_returns_seq + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING hardware_returns_seq`,
    [organizationId],
  );
  if (!res.rowCount) {
    throw Object.assign(new Error('Organization not found.'), { status: 404 });
  }
  return formatReturnNumber(prefix, Number(res.rows[0].hardware_returns_seq));
}

export async function appendHardwareReturnActivity(
  id: string,
  entry: HardwareReturnActivityEntry,
): Promise<TicketHardwareReturnRecord | null> {
  const res = await queryDb(
    `UPDATE ticket_hardware_returns
     SET activity_log = COALESCE(activity_log, '[]'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [id, JSON.stringify([entry])],
  );
  if (!res.rowCount) return null;
  return mapHardwareRow(res.rows[0]);
}

export async function deleteHardwareReturn(params: {
  id: string;
  organizationId: string;
}): Promise<boolean> {
  const res = await queryDb(
    `DELETE FROM ticket_hardware_returns
     WHERE id = $1::uuid AND organization_id = $2
     RETURNING id`,
    [params.id, params.organizationId],
  );
  return Boolean(res.rowCount);
}

/** Persist hardware-return fields by primary id (standalone). */
export async function updateHardwareReturnById(params: {
  id: string;
  organizationId: string;
  input: TicketHardwareReturnInput;
  mail1Days?: number;
}): Promise<TicketHardwareReturnRecord> {
  const existing = await getHardwareReturnById(params.id);
  if (!existing || existing.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  const normalized = normalizeHardwareReturnInput(params.input, {
    existing,
    mail1Days: params.mail1Days,
  });
  const res = await queryDb(
    `UPDATE ticket_hardware_returns SET
      ticket_id = $2,
      return_number = $3,
      subject = $4,
      employee_name = $5,
      employee_email = $6,
      assignee_name = $7,
      assignee_user_id = $8,
      directory_user_id = $9,
      status = $10,
      description = $11,
      activity_log = COALESCE($12::jsonb, activity_log),
      external_ref_id = $13,
      service_level = $14,
      sla = $15,
      time_sl1_minutes = $16,
      time_sl2_minutes = $17,
      time_sl3_minutes = $18,
      exported = $19,
      exported_at = $20,
      request_type = $21,
      device_details = $22,
      device_old_type = $23,
      device_old_serial = $24,
      device_new_type = $25,
      device_new_serial = $26,
      employee_phone = $27,
      employee_mobile = $28,
      project_manager_name = $29,
      project_manager_email = $30,
      manager_name = $31,
      manager_email = $32,
      ceo_email_override = $33,
      stage_recipients_override = $34::jsonb,
      solution_summary = $35,
      shipping_method = $36,
      shipping_reference = $37,
      return_required = $38,
      delivery_date = $39,
      return_due_date = $40,
      auto_reminder_enabled = $41,
      mail1_scheduled_date = $42,
      mail2_scheduled_date = $43,
      mail3_scheduled_date = $44,
      returned = $45,
      returned_at = $46,
      updated_at = NOW()
    WHERE id = $1::uuid
    RETURNING *`,
    [
      params.id,
      normalized.ticket_id ?? null,
      normalized.return_number ?? existing.return_number,
      normalized.subject ?? null,
      normalized.employee_name ?? null,
      normalized.employee_email ?? null,
      normalized.assignee_name ?? null,
      normalized.assignee_user_id ?? null,
      normalized.directory_user_id ?? null,
      normalized.status || existing.status || 'Neu',
      normalized.description ?? null,
      normalized.activity_log ? JSON.stringify(normalized.activity_log) : null,
      normalized.external_ref_id ?? null,
      normalized.service_level ?? null,
      normalized.sla ?? existing.sla ?? 'Normal',
      normalized.time_sl1_minutes ?? 0,
      normalized.time_sl2_minutes ?? 0,
      normalized.time_sl3_minutes ?? 0,
      Boolean(normalized.exported),
      normalized.exported_at ?? null,
      normalized.request_type ?? null,
      normalized.device_details ?? null,
      normalized.device_old_type ?? null,
      normalized.device_old_serial ?? null,
      normalized.device_new_type ?? null,
      normalized.device_new_serial ?? null,
      normalized.employee_phone ?? null,
      normalized.employee_mobile ?? null,
      normalized.project_manager_name ?? null,
      normalized.project_manager_email ?? null,
      normalized.manager_name ?? null,
      normalized.manager_email ?? null,
      normalized.ceo_email_override ?? null,
      normalized.stage_recipients_override
        ? JSON.stringify(normalized.stage_recipients_override)
        : null,
      normalized.solution_summary ?? null,
      normalized.shipping_method ?? null,
      normalized.shipping_reference ?? null,
      Boolean(normalized.return_required),
      normalized.delivery_date ?? null,
      normalized.return_due_date ?? null,
      normalized.auto_reminder_enabled !== false,
      normalized.mail1_scheduled_date ?? null,
      normalized.mail2_scheduled_date ?? null,
      normalized.mail3_scheduled_date ?? null,
      Boolean(normalized.returned),
      normalized.returned_at ?? null,
    ],
  );
  return mapHardwareRow(res.rows[0]);
}

/**
 * Insert a standalone Rücklieferung (ticket_id always NULL).
 * Atomically allocates `PREFIX-N` via organizations.hardware_returns_seq.
 * Never creates a normal support ticket.
 */
export async function insertStandaloneHardwareReturn(params: {
  organizationId: string;
  input: TicketHardwareReturnInput;
  mail1Days?: number;
  actorName?: string | null;
  actorId?: string | null;
}): Promise<TicketHardwareReturnRecord> {
  const normalized = normalizeHardwareReturnInput(
    {
      return_required: true,
      auto_reminder_enabled: true,
      status: 'Neu',
      sla: 'Normal',
      subject: null,
      ...params.input,
      ticket_id: null,
    },
    { mail1Days: params.mail1Days },
  );
  // Default Bearbeiter to creating user when not explicitly chosen.
  if (!normalized.assignee_user_id && params.actorId) {
    normalized.assignee_user_id = String(params.actorId).slice(0, 128);
  }
  if (!normalized.assignee_name && params.actorName) {
    normalized.assignee_name = String(params.actorName).trim().slice(0, 255) || null;
  }

  return withPgTransaction(async (client) => {
    const orgRes = await client.query(
      `SELECT id, name, hardware_returns_config FROM organizations WHERE id = $1 LIMIT 1`,
      [params.organizationId],
    );
    if (!orgRes.rowCount) {
      throw Object.assign(new Error('Organization not found.'), { status: 404 });
    }
    const orgRow = orgRes.rows[0];
    const config = normalizeHardwareReturnsConfig(orgRow.hardware_returns_config);
    const prefix = resolveHardwareReturnIdPrefix({
      config,
      organizationName: orgRow.name,
    });

    let returnNumber = normalized.return_number || null;
    if (!returnNumber) {
      const seqRes = await client.query(
        `UPDATE organizations
         SET hardware_returns_seq = hardware_returns_seq + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING hardware_returns_seq`,
        [params.organizationId],
      );
      returnNumber = formatReturnNumber(prefix, Number(seqRes.rows[0].hardware_returns_seq));
    }

    const now = new Date().toISOString();
    const activity: HardwareReturnActivityEntry[] = [
      {
        at: now,
        type: 'created',
        actor: params.actorName || null,
        message: 'Rücklieferung erstellt',
      },
      ...(Array.isArray(normalized.activity_log) ? normalized.activity_log : []),
    ];
    const id = randomUUID();
    const res = await client.query(
      `INSERT INTO ticket_hardware_returns (
        id, organization_id, ticket_id,
        return_number, subject, employee_name, employee_email,
        assignee_name, assignee_user_id, directory_user_id,
        status, description, activity_log,
        external_ref_id, service_level, sla,
        time_sl1_minutes, time_sl2_minutes, time_sl3_minutes,
        exported, exported_at, request_type, device_details,
        device_old_type, device_old_serial, device_new_type, device_new_serial,
        employee_phone, employee_mobile,
        project_manager_name, project_manager_email, manager_name, manager_email,
        ceo_email_override, stage_recipients_override, solution_summary,
        shipping_method, shipping_reference, return_required, delivery_date, return_due_date,
        auto_reminder_enabled,
        mail1_scheduled_date, mail2_scheduled_date, mail3_scheduled_date,
        returned, returned_at
      ) VALUES (
        $1,$2,NULL,
        $3,$4,$5,$6,
        $7,$8,$9,
        $10,$11,$12::jsonb,
        $13,$14,$15,
        $16,$17,$18,
        $19,$20,$21,$22,
        $23,$24,$25,$26,
        $27,$28,
        $29,$30,$31,$32,
        $33,$34::jsonb,$35,
        $36,$37,$38,$39,$40,
        $41,
        $42,$43,$44,
        $45,$46
      ) RETURNING *`,
      [
        id,
        params.organizationId,
        returnNumber,
        normalized.subject ?? null,
        normalized.employee_name ?? null,
        normalized.employee_email ?? null,
        normalized.assignee_name ?? params.actorName ?? null,
        normalized.assignee_user_id ?? params.actorId ?? null,
        normalized.directory_user_id ?? null,
        normalized.status || 'Neu',
        normalized.description ?? null,
        JSON.stringify(activity),
        normalized.external_ref_id ?? null,
        normalized.service_level ?? null,
        normalized.sla ?? 'Normal',
        normalized.time_sl1_minutes ?? 0,
        normalized.time_sl2_minutes ?? 0,
        normalized.time_sl3_minutes ?? 0,
        Boolean(normalized.exported),
        normalized.exported_at ?? null,
        normalized.request_type ?? null,
        normalized.device_details ?? null,
        normalized.device_old_type ?? null,
        normalized.device_old_serial ?? null,
        normalized.device_new_type ?? null,
        normalized.device_new_serial ?? null,
        normalized.employee_phone ?? null,
        normalized.employee_mobile ?? null,
        normalized.project_manager_name ?? null,
        normalized.project_manager_email ?? null,
        normalized.manager_name ?? null,
        normalized.manager_email ?? null,
        normalized.ceo_email_override ?? null,
        normalized.stage_recipients_override
          ? JSON.stringify(normalized.stage_recipients_override)
          : null,
        normalized.solution_summary ?? null,
        normalized.shipping_method ?? null,
        normalized.shipping_reference ?? null,
        normalized.return_required !== false,
        normalized.delivery_date ?? null,
        normalized.return_due_date ?? null,
        normalized.auto_reminder_enabled !== false,
        normalized.mail1_scheduled_date ?? null,
        normalized.mail2_scheduled_date ?? null,
        normalized.mail3_scheduled_date ?? null,
        Boolean(normalized.returned),
        normalized.returned_at ?? null,
      ],
    );
    return mapHardwareRow(res.rows[0]);
  });
}

/**
 * Legacy upsert keyed by ticket_id — kept for ticket-detail hardware panels.
 * New workbench creates must use insertStandaloneHardwareReturn (ticket_id NULL).
 */
export async function upsertHardwareReturn(params: {
  ticketId: string;
  organizationId: string;
  input: TicketHardwareReturnInput;
  mail1Days?: number;
}): Promise<TicketHardwareReturnRecord> {
  const existing = await getHardwareReturnByTicketId(params.ticketId);
  if (existing && existing.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Hardware return belongs to another organization.'), {
      status: 403,
    });
  }
  if (existing) {
    return updateHardwareReturnById({
      id: existing.id,
      organizationId: params.organizationId,
      input: { ...params.input, ticket_id: params.ticketId },
      mail1Days: params.mail1Days,
    });
  }
  // Legacy path still links ticket_id for ticket-detail panels; workbench uses insertStandalone.
  const created = await insertStandaloneHardwareReturn({
    organizationId: params.organizationId,
    mail1Days: params.mail1Days,
    input: { ...params.input, ticket_id: params.ticketId },
  });
  // insertStandalone forces ticket_id NULL — re-attach for legacy callers.
  return updateHardwareReturnById({
    id: created.id,
    organizationId: params.organizationId,
    input: { ticket_id: params.ticketId },
    mail1Days: params.mail1Days,
  });
}

/** Idempotent data migration: copy ticket fields → return row, null ticket_id, drop RMA stubs. */
export async function backfillHardwareReturnsStandalone(): Promise<void> {
  await queryDb(`
    UPDATE ticket_hardware_returns thr
    SET
      subject = COALESCE(NULLIF(thr.subject, ''), NULLIF(doc.data->>'subject', ''), 'Hardware'),
      employee_name = COALESCE(
        thr.employee_name,
        NULLIF(doc.data->>'customerName', ''),
        NULLIF(doc.data->>'customer_name', '')
      ),
      employee_email = COALESCE(
        thr.employee_email,
        LOWER(NULLIF(doc.data->>'customerEmail', '')),
        LOWER(NULLIF(doc.data->>'customer_email', ''))
      ),
      description = COALESCE(thr.description, NULLIF(doc.data->>'description', '')),
      status = COALESCE(
        NULLIF(thr.status, ''),
        CASE
          WHEN thr.returned = TRUE THEN 'returned'
          WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('closed', 'resolved') THEN 'closed'
          WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('in_progress', 'pending') THEN 'in_progress'
          WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('waiting', 'waiting_customer', 'on_hold', 'on-hold') THEN 'waiting'
          ELSE 'open'
        END
      ),
      return_number = COALESCE(
        thr.return_number,
        thr.external_ref_id,
        'RL-LEGACY-' || LEFT(REPLACE(thr.id::text, '-', ''), 8)
      ),
      updated_at = NOW()
    FROM geistdesk_documents doc
    WHERE thr.ticket_id IS NOT NULL
      AND doc.collection = 'tickets'
      AND doc.id = thr.ticket_id
  `);

  await queryDb(`
    UPDATE ticket_hardware_returns
    SET
      return_number = COALESCE(return_number, external_ref_id, 'RL-LEGACY-' || LEFT(REPLACE(id::text, '-', ''), 8)),
      subject = COALESCE(NULLIF(subject, ''), 'Hardware'),
      status = COALESCE(NULLIF(status, ''), CASE WHEN returned THEN 'returned' ELSE 'open' END),
      updated_at = NOW()
    WHERE return_number IS NULL OR subject IS NULL OR status IS NULL OR subject = ''
  `);

  await queryDb(`DROP TABLE IF EXISTS _hw_rma_stub_tickets`);
  await queryDb(`
    CREATE TEMP TABLE _hw_rma_stub_tickets AS
    SELECT thr.ticket_id AS id
    FROM ticket_hardware_returns thr
    JOIN geistdesk_documents doc
      ON doc.collection = 'tickets' AND doc.id = thr.ticket_id
    WHERE thr.ticket_id IS NOT NULL
      AND (
        doc.data->>'channel' = 'hardware_returns'
        OR COALESCE(doc.data->'tags', '[]'::jsonb) ? 'hardware-returns'
        OR COALESCE(doc.data->'tags', '[]'::jsonb) ? 'ruecklieferung'
        OR LOWER(COALESCE(doc.data->>'subject', '')) LIKE 'hardware-rücklieferung%'
        OR LOWER(COALESCE(doc.data->>'subject', '')) LIKE 'hardware-ruecklieferung%'
      )
  `);

  await queryDb(`
    UPDATE ticket_hardware_returns
    SET ticket_id = NULL, updated_at = NOW()
    WHERE ticket_id IS NOT NULL
  `);

  await queryDb(`
    DELETE FROM geistdesk_documents
    WHERE collection = 'tickets'
      AND id IN (SELECT id FROM _hw_rma_stub_tickets)
  `);

  await queryDb(`DROP TABLE IF EXISTS _hw_rma_stub_tickets`);
}

/**
 * One-time safe backfill: assign PREFIX-N to rows whose return_number is missing
 * or looks like a UUID slice / RL-LEGACY placeholder. Updates hardware_returns_seq.
 */
export async function backfillHardwareReturnsSequentialNumbers(): Promise<void> {
  const orgs = await queryDb(
    `SELECT id, name, hardware_returns_config, hardware_returns_seq FROM organizations`,
  );
  for (const org of orgs.rows) {
    const config = normalizeHardwareReturnsConfig(org.hardware_returns_config);
    const prefix = resolveHardwareReturnIdPrefix({
      config,
      organizationName: org.name,
    });

    // Max existing sequential number for this prefix (keep RL-1001 / PREFIX-N as-is).
    const maxRes = await queryDb(
      `SELECT COALESCE(MAX(
         CASE
           WHEN return_number ~ ('^' || $2 || '-[0-9]+$')
           THEN NULLIF(substring(return_number from '[0-9]+$'), '')::int
           ELSE NULL
         END
       ), 0) AS max_seq
       FROM ticket_hardware_returns
       WHERE organization_id = $1`,
      [org.id, prefix],
    );
    let nextSeq = Math.max(
      Number(org.hardware_returns_seq) || 0,
      Number(maxRes.rows[0]?.max_seq) || 0,
    );

    const candidates = await queryDb(
      `SELECT id, return_number
       FROM ticket_hardware_returns
       WHERE organization_id = $1
       ORDER BY created_at ASC NULLS LAST, id ASC`,
      [org.id],
    );

    for (const row of candidates.rows) {
      if (!needsReturnNumberBackfill(row.return_number)) continue;
      nextSeq += 1;
      const returnNumber = formatReturnNumber(prefix, nextSeq);
      await queryDb(
        `UPDATE ticket_hardware_returns
         SET return_number = $2, updated_at = NOW()
         WHERE id = $1::uuid`,
        [row.id, returnNumber],
      );
    }

    if (nextSeq > (Number(org.hardware_returns_seq) || 0)) {
      await queryDb(
        `UPDATE organizations
         SET hardware_returns_seq = $2, updated_at = NOW()
         WHERE id = $1 AND hardware_returns_seq < $2`,
        [org.id, nextSeq],
      );
    }
  }
}

export interface HardwareReturnAssigneeCandidate {
  id: string;
  name: string;
  email: string;
  role: string;
  source: 'org' | 'hubcom';
}

function userOrgIdFromDoc(user: Record<string, unknown> | null | undefined): string | null {
  if (!user) return null;
  const raw =
    (typeof user.organizationId === 'string' && user.organizationId.trim()) ||
    (typeof user.organization_id === 'string' && user.organization_id.trim()) ||
    '';
  return raw || null;
}

/** Bearbeiter candidates: org CLIENT_ADMIN/CLIENT_SUPPORTER + Hubcom AGENT/SYSTEM_ADMIN. */
export async function listHardwareReturnAssignees(
  organizationId: string,
): Promise<HardwareReturnAssigneeCandidate[]> {
  const users = await getDocsDirect('users', []);
  const out: HardwareReturnAssigneeCandidate[] = [];
  const seen = new Set<string>();

  for (const u of users) {
    const id = String(u.id || '');
    if (!id || seen.has(id)) continue;
    if (u.isDeactivated === true) continue;
    const role = String(u.role || '');
    const name = String(u.name || u.email || '').trim();
    const email = String(u.email || '').trim();
    if (!name && !email) continue;

    const orgId = userOrgIdFromDoc(u as any);
    const isOrgAssignee =
      orgId === organizationId &&
      (role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER');
    const isHubcomAssignee =
      role === 'SYSTEM_ADMIN' || role === 'AGENT' || role === 'agent';

    if (!isOrgAssignee && !isHubcomAssignee) continue;

    seen.add(id);
    out.push({
      id,
      name: name || email,
      email,
      role,
      source: isOrgAssignee ? 'org' : 'hubcom',
    });
  }

  return out.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'org' ? -1 : 1;
    return a.name.localeCompare(b.name, 'de');
  });
}

/** Pure gate used by tests — org A enabled, org B disabled. */
export function evaluateHardwareModuleAccess(params: {
  orgEnabled: boolean;
  sessionOrgId: string | null;
  ticketOrgId: string | null;
  role: string;
  allowRoles?: string[];
}): { ok: true } | { ok: false; status: 403 | 404 } {
  if (!params.orgEnabled) return { ok: false, status: 404 };
  if (!params.sessionOrgId || !params.ticketOrgId) return { ok: false, status: 404 };
  if (params.sessionOrgId !== params.ticketOrgId) return { ok: false, status: 404 };
  const allowed = params.allowRoles || ['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'SYSTEM_ADMIN', 'AGENT'];
  if (!allowed.includes(params.role) && params.role !== 'SYSTEM_ADMIN') {
    // CLIENT_USER simplified — read may be allowed separately; writes blocked.
    if (params.role === 'CLIENT_USER') return { ok: false, status: 403 };
    return { ok: false, status: 403 };
  }
  return { ok: true };
}

/**
 * Catalogs / settings write gate: CLIENT_ADMIN (own org) or SYSTEM_ADMIN.
 * Disabled module and CLIENT_USER → 403 (per Part-1 catalogs contract).
 */
export function evaluateHardwareCatalogsWriteAccess(params: {
  orgEnabled: boolean;
  sessionOrgId: string | null;
  targetOrgId: string | null;
  role: string;
}): { ok: true } | { ok: false; status: 403 } {
  if (!params.orgEnabled) return { ok: false, status: 403 };
  if (params.role === 'CLIENT_USER') return { ok: false, status: 403 };
  if (params.role === 'SYSTEM_ADMIN') return { ok: true };
  if (params.role !== 'CLIENT_ADMIN') return { ok: false, status: 403 };
  if (!params.sessionOrgId || !params.targetOrgId) return { ok: false, status: 403 };
  if (params.sessionOrgId !== params.targetOrgId) return { ok: false, status: 403 };
  return { ok: true };
}

/** User-document fields used to auto-fill hardware return contacts. */
export const HARDWARE_USER_PROFILE_FIELDS = [
  'project_manager_name',
  'project_manager_email',
  'manager_name',
  'manager_email',
  'phone_office',
  'phone_mobile',
] as const;

export function extractHardwareContactsFromUser(user: Record<string, unknown> | null | undefined): {
  employee_phone: string | null;
  employee_mobile: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
  manager_name: string | null;
  manager_email: string | null;
} {
  if (!user) {
    return {
      employee_phone: null,
      employee_mobile: null,
      project_manager_name: null,
      project_manager_email: null,
      manager_name: null,
      manager_email: null,
    };
  }
  return {
    employee_phone: nullStr(user.phone_office ?? user.phoneOffice ?? user.phone, 80),
    employee_mobile: nullStr(user.phone_mobile ?? user.phoneMobile ?? user.mobile, 80),
    project_manager_name: nullStr(user.project_manager_name ?? user.projectManagerName, 200),
    project_manager_email: nullEmail(user.project_manager_email ?? user.projectManagerEmail),
    manager_name: nullStr(user.manager_name ?? user.managerName, 200),
    manager_email: nullEmail(user.manager_email ?? user.managerEmail),
  };
}
