/**
 * Per-organization Hardware-Rücklieferungen & Service-Level module.
 * Gated by organizations.hardware_returns_enabled (default false).
 */

import { randomUUID } from 'crypto';
import { queryDb } from '../postgres-backend.js';
import { getOrganization } from './organizations.js';

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

export interface HardwareReturnsConfig {
  auto_send_enabled: boolean;
  mail1_days_after_delivery: number;
  mail2_days_after_mail1: number;
  mail3_days_after_mail2: number;
  ceo_name: string | null;
  ceo_email: string | null;
  fallback_manager_email: string | null;
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

export type HardwareReturnStatus =
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'returned'
  | 'closed';

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
  subject: string;
  employee_name: string | null;
  employee_email: string | null;
  assignee_name: string | null;
  status: HardwareReturnStatus;
  description: string | null;
  activity_log: HardwareReturnActivityEntry[];
  external_ref_id: string | null;
  service_level: 1 | 2 | 3 | null;
  time_sl1_minutes: number;
  time_sl2_minutes: number;
  time_sl3_minutes: number;
  exported: boolean;
  exported_at: string | null;
  request_type: string | null;
  device_details: string | null;
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

const STATUS_VALUES: HardwareReturnStatus[] = [
  'open',
  'in_progress',
  'waiting',
  'returned',
  'closed',
];

export function normalizeHardwareReturnStatus(raw: unknown): HardwareReturnStatus {
  const s = String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_');
  if (s === 'pending') return 'in_progress';
  if (s === 'on_hold' || s === 'waiting_customer') return 'waiting';
  if (s === 'resolved') return 'closed';
  if ((STATUS_VALUES as string[]).includes(s)) return s as HardwareReturnStatus;
  return 'open';
}

const ROLE_TOKENS: HardwareRoleToken[] = ['employee', 'project_manager', 'manager', 'ceo'];

function defaultStage(to: HardwareRoleToken[], cc: HardwareRoleToken[]): HardwareStageRecipients {
  return { to_roles: to, cc_roles: cc, extra_to: [], extra_cc: [] };
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
  const sl = row.service_level == null ? null : Number(row.service_level);
  const returned = row.returned === true || row.returned === 't';
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    ticket_id: row.ticket_id == null || row.ticket_id === '' ? null : String(row.ticket_id),
    return_number: nullStr(row.return_number, 120),
    subject: nullStr(row.subject, 500) || 'Hardware',
    employee_name: nullStr(row.employee_name, 255),
    employee_email: nullEmail(row.employee_email),
    assignee_name: nullStr(row.assignee_name, 255),
    status: returned
      ? 'returned'
      : normalizeHardwareReturnStatus(row.status),
    description: nullStr(row.description, 100_000),
    activity_log: parseActivityLog(row.activity_log),
    external_ref_id: nullStr(row.external_ref_id, 120),
    service_level: sl === 1 || sl === 2 || sl === 3 ? sl : null,
    time_sl1_minutes: Math.max(0, Number(row.time_sl1_minutes) || 0),
    time_sl2_minutes: Math.max(0, Number(row.time_sl2_minutes) || 0),
    time_sl3_minutes: Math.max(0, Number(row.time_sl3_minutes) || 0),
    exported: row.exported === true || row.exported === 't',
    exported_at: row.exported_at ? new Date(row.exported_at).toISOString() : null,
    request_type: nullStr(row.request_type, 200),
    device_details: nullStr(row.device_details, 4000),
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
    delivery_date: row.delivery_date
      ? String(row.delivery_date).slice(0, 10)
      : null,
    return_due_date: row.return_due_date
      ? String(row.return_due_date).slice(0, 10)
      : null,
    auto_reminder_enabled:
      row.auto_reminder_enabled !== false && row.auto_reminder_enabled !== 'f',
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
    const sl = Number(input.service_level);
    next.service_level = sl === 1 || sl === 2 || sl === 3 ? sl : null;
  }
  for (const key of ['time_sl1_minutes', 'time_sl2_minutes', 'time_sl3_minutes'] as const) {
    if (input[key] !== undefined) {
      next[key] = Math.max(0, Math.min(24 * 60 * 30, Math.floor(Number(input[key]) || 0)));
    }
  }
  if (input.delivery_date !== undefined) {
    next.delivery_date = nullStr(input.delivery_date, 10);
  }
  // Auto-default return_due_date = delivery_date + N days when delivery set and due not explicitly provided.
  if (input.delivery_date !== undefined && input.return_due_date === undefined) {
    if (next.delivery_date) {
      next.return_due_date = addDaysIso(next.delivery_date, mail1Days);
    }
  } else if (input.return_due_date !== undefined) {
    next.return_due_date = nullStr(input.return_due_date, 10);
  }

  if (input.stage_recipients_override !== undefined) {
    next.stage_recipients_override = parseStageOverride(input.stage_recipients_override);
  }

  if (input.subject !== undefined) {
    next.subject = nullStr(input.subject, 500) || 'Hardware';
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
    if (!next.returned) next.returned_at = null;
    if (next.returned) next.status = 'returned';
  }
  if (input.returned_at !== undefined) {
    next.returned_at = input.returned_at ? new Date(String(input.returned_at)).toISOString() : null;
  }

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

export async function allocateReturnNumber(organizationId: string): Promise<string> {
  const res = await queryDb(
    `SELECT return_number FROM ticket_hardware_returns
     WHERE organization_id = $1 AND return_number ~ '^RL-[0-9]+$'
     ORDER BY NULLIF(regexp_replace(return_number, '\\D', '', 'g'), '')::int DESC NULLS LAST
     LIMIT 1`,
    [organizationId],
  );
  let next = 1001;
  if (res.rowCount) {
    const n = Number(String(res.rows[0].return_number).replace(/\D/g, ''));
    if (Number.isFinite(n) && n >= 1000) next = n + 1;
  }
  return `RL-${next}`;
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
      status = $8,
      description = $9,
      activity_log = COALESCE($10::jsonb, activity_log),
      external_ref_id = $11,
      service_level = $12,
      time_sl1_minutes = $13,
      time_sl2_minutes = $14,
      time_sl3_minutes = $15,
      exported = $16,
      exported_at = $17,
      request_type = $18,
      device_details = $19,
      employee_phone = $20,
      employee_mobile = $21,
      project_manager_name = $22,
      project_manager_email = $23,
      manager_name = $24,
      manager_email = $25,
      ceo_email_override = $26,
      stage_recipients_override = $27::jsonb,
      solution_summary = $28,
      shipping_method = $29,
      shipping_reference = $30,
      return_required = $31,
      delivery_date = $32,
      return_due_date = $33,
      auto_reminder_enabled = $34,
      returned = $35,
      returned_at = $36,
      updated_at = NOW()
    WHERE id = $1::uuid
    RETURNING *`,
    [
      params.id,
      normalized.ticket_id ?? null,
      normalized.return_number ?? existing.return_number,
      normalized.subject || existing.subject || 'Hardware',
      normalized.employee_name ?? null,
      normalized.employee_email ?? null,
      normalized.assignee_name ?? null,
      normalized.status || existing.status || 'open',
      normalized.description ?? null,
      normalized.activity_log ? JSON.stringify(normalized.activity_log) : null,
      normalized.external_ref_id ?? null,
      normalized.service_level ?? null,
      normalized.time_sl1_minutes ?? 0,
      normalized.time_sl2_minutes ?? 0,
      normalized.time_sl3_minutes ?? 0,
      Boolean(normalized.exported),
      normalized.exported_at ?? null,
      normalized.request_type ?? null,
      normalized.device_details ?? null,
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
      Boolean(normalized.returned),
      normalized.returned_at ?? null,
    ],
  );
  return mapHardwareRow(res.rows[0]);
}

/**
 * Insert a standalone Rücklieferung (ticket_id always NULL).
 * Never creates a normal support ticket.
 */
export async function insertStandaloneHardwareReturn(params: {
  organizationId: string;
  input: TicketHardwareReturnInput;
  mail1Days?: number;
  actorName?: string | null;
}): Promise<TicketHardwareReturnRecord> {
  const normalized = normalizeHardwareReturnInput(
    {
      return_required: true,
      auto_reminder_enabled: true,
      status: 'open',
      subject: 'Hardware',
      ...params.input,
      ticket_id: null,
    },
    { mail1Days: params.mail1Days },
  );
  const returnNumber =
    normalized.return_number ||
    normalized.external_ref_id ||
    (await allocateReturnNumber(params.organizationId));
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
  const res = await queryDb(
    `INSERT INTO ticket_hardware_returns (
      id, organization_id, ticket_id,
      return_number, subject, employee_name, employee_email, assignee_name, status, description, activity_log,
      external_ref_id, service_level, time_sl1_minutes, time_sl2_minutes, time_sl3_minutes,
      exported, exported_at, request_type, device_details, employee_phone, employee_mobile,
      project_manager_name, project_manager_email, manager_name, manager_email,
      ceo_email_override, stage_recipients_override, solution_summary,
      shipping_method, shipping_reference, return_required, delivery_date, return_due_date,
      auto_reminder_enabled, returned, returned_at
    ) VALUES (
      $1,$2,NULL,
      $3,$4,$5,$6,$7,$8,$9,$10::jsonb,
      $11,$12,$13,$14,$15,
      $16,$17,$18,$19,$20,$21,
      $22,$23,$24,$25,
      $26,$27::jsonb,$28,
      $29,$30,$31,$32,$33,
      $34,$35,$36
    ) RETURNING *`,
    [
      id,
      params.organizationId,
      returnNumber,
      normalized.subject || 'Hardware',
      normalized.employee_name ?? null,
      normalized.employee_email ?? null,
      normalized.assignee_name ?? 'Support',
      normalized.status || 'open',
      normalized.description ?? null,
      JSON.stringify(activity),
      normalized.external_ref_id ?? null,
      normalized.service_level ?? null,
      normalized.time_sl1_minutes ?? 0,
      normalized.time_sl2_minutes ?? 0,
      normalized.time_sl3_minutes ?? 0,
      Boolean(normalized.exported),
      normalized.exported_at ?? null,
      normalized.request_type ?? null,
      normalized.device_details ?? null,
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
      Boolean(normalized.returned),
      normalized.returned_at ?? null,
    ],
  );
  return mapHardwareRow(res.rows[0]);
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
