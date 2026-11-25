/**
 * Dynamic 1..N reminder stages for Hardware-Rücklieferungen.
 * Pure helpers — safe for unit tests (no I/O).
 */

import type {
  HardwareMailTemplate,
  HardwareReturnsConfig,
  HardwareRoleToken,
  HardwareStageOverride,
  HardwareStageRecipients,
  TicketHardwareReturnRecord,
} from './hardware-returns.js';

/** Positive integer stage number (1, 2, 3, 4, 5, …). */
export type ReminderStage = number;

export interface ReminderStageEvent {
  stage: number;
  sentAt: string | null;
  scheduledDate: string | null;
  recipientsTo: string[];
  recipientsCc: string[];
  subject?: string;
  sentBy?: string;
}

export interface ConfiguredReminderStage {
  stage: number;
  label: string;
  /** Days after delivery/due (stage 1) or after previous stage sent (stage 2+). */
  delayDays: number;
  toRoles: HardwareRoleToken[];
  ccRoles: HardwareRoleToken[];
  extraTo: string[];
  extraCc: string[];
  subjectTemplate: string;
  bodyTemplate: string;
}

const ROLE_TOKENS: HardwareRoleToken[] = [
  'employee',
  'project_manager',
  'manager',
  'ceo',
];

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

export function isValidReminderStage(raw: unknown): raw is ReminderStage {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

export function reminderStageLabel(stage: number): string {
  return `${Math.max(1, Math.floor(stage))}. Erinnerung`;
}

/** Default 4-stage reminder plan (Part 1 backend). */
export function defaultConfiguredReminderStages(): ConfiguredReminderStage[] {
  return [
    {
      stage: 1,
      label: '1. Erinnerung',
      delayDays: 14,
      toRoles: ['employee'],
      ccRoles: [],
      extraTo: [],
      extraCc: [],
      subjectTemplate: 'Erinnerung: Hardware-Rücklieferung fällig',
      bodyTemplate:
        'Sehr geehrte/r {{employee_name}},\n\nbitte denken Sie an die Rücklieferung der bereitgestellten Hardware.\nFällig am: {{return_due_date}}\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
    },
    {
      stage: 2,
      label: '2. Erinnerung',
      delayDays: 7,
      toRoles: ['employee'],
      ccRoles: ['project_manager'],
      extraTo: [],
      extraCc: [],
      subjectTemplate: '2. Erinnerung: Hardware-Rücklieferung überfällig',
      bodyTemplate:
        'Sehr geehrte/r {{employee_name}},\n\ndie Rücklieferung ist überfällig (Fällig am {{return_due_date}}).\nBitte veranlassen Sie die Rückgabe umgehend.\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
    },
    {
      stage: 3,
      label: '3. Erinnerung',
      delayDays: 7,
      toRoles: ['employee'],
      ccRoles: ['project_manager', 'manager'],
      extraTo: [],
      extraCc: [],
      subjectTemplate: '3. Erinnerung: Hardware-Rücklieferung',
      bodyTemplate:
        'Sehr geehrte/r {{employee_name}},\n\ndies ist die 3. Erinnerung zur Hardware-Rücklieferung (Fällig am {{return_due_date}}).\nProjektmanager und Vorgesetzte wurden in CC gesetzt.\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
    },
    {
      stage: 4,
      label: '4. Erinnerung',
      delayDays: 7,
      toRoles: ['employee'],
      ccRoles: ['project_manager', 'manager', 'ceo'],
      extraTo: [],
      extraCc: [],
      subjectTemplate: '4. Erinnerung: Hardware-Rücklieferung',
      bodyTemplate:
        'Sehr geehrte/r {{employee_name}},\n\ndies ist die 4. Erinnerung zur Hardware-Rücklieferung (Fällig am {{return_due_date}}).\nVorgesetzte und Geschäftsführung wurden in CC gesetzt.\n\nMit freundlichen Grüßen\nHubcom ServiceDesk',
    },
  ];
}

function normalizeOneConfiguredStage(
  raw: unknown,
  fallback: ConfiguredReminderStage,
): ConfiguredReminderStage {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const stage =
    Number.isInteger(Number(src.stage)) && Number(src.stage) >= 1
      ? Math.min(100, Math.floor(Number(src.stage)))
      : fallback.stage;
  const delayRaw = Number(src.delayDays ?? src.delay_days ?? src.days_after_previous);
  const delayDays =
    Number.isFinite(delayRaw) && delayRaw >= 0
      ? Math.min(365, Math.floor(delayRaw))
      : fallback.delayDays;
  const toRoles = src.toRoles !== undefined || src.to_roles !== undefined
    ? asRoleList(src.toRoles ?? src.to_roles)
    : [...fallback.toRoles];
  const ccRoles = src.ccRoles !== undefined || src.cc_roles !== undefined
    ? asRoleList(src.ccRoles ?? src.cc_roles)
    : [...fallback.ccRoles];
  const subjectTemplate =
    src.subjectTemplate != null || src.subject_template != null || src.subject != null
      ? String(src.subjectTemplate ?? src.subject_template ?? src.subject ?? '')
          .trim()
          .slice(0, 500) || fallback.subjectTemplate
      : fallback.subjectTemplate;
  const bodyTemplate =
    src.bodyTemplate != null || src.body_template != null || src.body != null
      ? String(src.bodyTemplate ?? src.body_template ?? src.body ?? '')
          .trim()
          .slice(0, 20_000) || fallback.bodyTemplate
      : fallback.bodyTemplate;
  const label =
    src.label != null && String(src.label).trim()
      ? String(src.label).trim().slice(0, 80)
      : reminderStageLabel(stage);
  return {
    stage,
    label,
    delayDays,
    toRoles: toRoles.length ? toRoles : [...fallback.toRoles],
    ccRoles,
    extraTo:
      src.extraTo !== undefined || src.extra_to !== undefined
        ? asEmailList(src.extraTo ?? src.extra_to)
        : [...fallback.extraTo],
    extraCc:
      src.extraCc !== undefined || src.extra_cc !== undefined
        ? asEmailList(src.extraCc ?? src.extra_cc)
        : [...fallback.extraCc],
    subjectTemplate,
    bodyTemplate,
  };
}

/**
 * Normalize `stages` / `reminder_stages_config` from raw config.
 * Falls back to building from legacy mail1/2/3 + a 4th default stage.
 */
export function normalizeConfiguredReminderStages(
  raw: unknown,
  legacy?: {
    mail1_days_after_delivery?: number;
    mail2_days_after_mail1?: number;
    mail3_days_after_mail2?: number;
    stage_recipients?: HardwareReturnsConfig['stage_recipients'];
    templates?: HardwareReturnsConfig['templates'];
  },
): ConfiguredReminderStage[] {
  const defaults = defaultConfiguredReminderStages();
  const src =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};
  const listRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(src.stages)
      ? src.stages
      : Array.isArray(src.reminder_stages_config)
        ? src.reminder_stages_config
        : null;

  if (listRaw && listRaw.length > 0) {
    return listRaw
      .slice(0, 50)
      .map((item, idx) =>
        normalizeOneConfiguredStage(item, defaults[Math.min(idx, defaults.length - 1)]!),
      )
      .map((s, idx) => ({ ...s, stage: idx + 1, label: s.label || reminderStageLabel(idx + 1) }));
  }

  // Build from legacy 3-stage fields + default stage 4.
  const mail1Days = Number.isFinite(Number(legacy?.mail1_days_after_delivery))
    ? Math.min(365, Math.max(0, Math.floor(Number(legacy!.mail1_days_after_delivery))))
    : defaults[0]!.delayDays;
  const mail2Days = Number.isFinite(Number(legacy?.mail2_days_after_mail1))
    ? Math.min(365, Math.max(0, Math.floor(Number(legacy!.mail2_days_after_mail1))))
    : defaults[1]!.delayDays;
  const mail3Days = Number.isFinite(Number(legacy?.mail3_days_after_mail2))
    ? Math.min(365, Math.max(0, Math.floor(Number(legacy!.mail3_days_after_mail2))))
    : defaults[2]!.delayDays;

  const sr = legacy?.stage_recipients;
  const tm = legacy?.templates;
  const fromLegacy: ConfiguredReminderStage[] = [
    {
      ...defaults[0]!,
      delayDays: mail1Days,
      toRoles: sr?.mail1?.to_roles?.length ? [...sr.mail1.to_roles] : defaults[0]!.toRoles,
      ccRoles: sr?.mail1 ? [...(sr.mail1.cc_roles || [])] : defaults[0]!.ccRoles,
      extraTo: sr?.mail1 ? [...(sr.mail1.extra_to || [])] : [],
      extraCc: sr?.mail1 ? [...(sr.mail1.extra_cc || [])] : [],
      subjectTemplate: tm?.mail1?.subject || defaults[0]!.subjectTemplate,
      bodyTemplate: tm?.mail1?.body || defaults[0]!.bodyTemplate,
    },
    {
      ...defaults[1]!,
      delayDays: mail2Days,
      toRoles: sr?.mail2?.to_roles?.length ? [...sr.mail2.to_roles] : defaults[1]!.toRoles,
      ccRoles: sr?.mail2 ? [...(sr.mail2.cc_roles || [])] : defaults[1]!.ccRoles,
      extraTo: sr?.mail2 ? [...(sr.mail2.extra_to || [])] : [],
      extraCc: sr?.mail2 ? [...(sr.mail2.extra_cc || [])] : [],
      subjectTemplate: tm?.mail2?.subject || defaults[1]!.subjectTemplate,
      bodyTemplate: tm?.mail2?.body || defaults[1]!.bodyTemplate,
    },
    {
      ...defaults[2]!,
      delayDays: mail3Days,
      // Stage 3: employee + PM/manager. CEO moves to stage 4 (new default).
      toRoles: sr?.mail3?.to_roles?.length ? [...sr.mail3.to_roles] : defaults[2]!.toRoles,
      ccRoles: sr?.mail3
        ? [...(sr.mail3.cc_roles || [])].filter((r) => r !== 'ceo')
        : defaults[2]!.ccRoles,
      extraTo: sr?.mail3 ? [...(sr.mail3.extra_to || [])] : [],
      extraCc: sr?.mail3 ? [...(sr.mail3.extra_cc || [])] : [],
      subjectTemplate: tm?.mail3?.subject || defaults[2]!.subjectTemplate,
      bodyTemplate: tm?.mail3?.body || defaults[2]!.bodyTemplate,
    },
    { ...defaults[3]! },
  ];
  return fromLegacy;
}

/** Mirror stages[0..2] into legacy mail1/2/3 fields for FE/settings compat. */
export function legacyFieldsFromConfiguredStages(stages: ConfiguredReminderStage[]): {
  mail1_days_after_delivery: number;
  mail2_days_after_mail1: number;
  mail3_days_after_mail2: number;
  stage_recipients: HardwareReturnsConfig['stage_recipients'];
  templates: HardwareReturnsConfig['templates'];
} {
  const s1 = stages[0] || defaultConfiguredReminderStages()[0]!;
  const s2 = stages[1] || defaultConfiguredReminderStages()[1]!;
  const s3 = stages[2] || defaultConfiguredReminderStages()[2]!;
  const toRecipients = (s: ConfiguredReminderStage): HardwareStageRecipients => ({
    to_roles: [...s.toRoles],
    cc_roles: [...s.ccRoles],
    extra_to: [...s.extraTo],
    extra_cc: [...s.extraCc],
  });
  const toTemplate = (s: ConfiguredReminderStage): HardwareMailTemplate => ({
    subject: s.subjectTemplate,
    body: s.bodyTemplate,
  });
  return {
    mail1_days_after_delivery: s1.delayDays,
    mail2_days_after_mail1: s2.delayDays,
    mail3_days_after_mail2: s3.delayDays,
    stage_recipients: {
      mail1: toRecipients(s1),
      mail2: toRecipients(s2),
      mail3: toRecipients(s3),
    },
    templates: {
      mail1: toTemplate(s1),
      mail2: toTemplate(s2),
      mail3: toTemplate(s3),
    },
  };
}

/**
 * Resolve template/roles for any stage >= 1.
 * If stage exceeds configured length, fall back to the last configured stage
 * but keep the requested stage number for labeling (`5. Erinnerung`).
 */
export function resolveConfiguredStage(
  config: HardwareReturnsConfig,
  stage: number,
): { configured: ConfiguredReminderStage; effectiveStage: number; usedFallback: boolean } {
  const stages =
    config.stages?.length > 0 ? config.stages : defaultConfiguredReminderStages();
  const n = Math.max(1, Math.floor(stage));
  if (n <= stages.length) {
    return { configured: stages[n - 1]!, effectiveStage: n, usedFallback: false };
  }
  const last = stages[stages.length - 1]!;
  return {
    configured: {
      ...last,
      stage: n,
      label: reminderStageLabel(n),
      subjectTemplate: formatStageSubject(last.subjectTemplate, n),
    },
    effectiveStage: n,
    usedFallback: true,
  };
}

function formatStageSubject(template: string, stage: number): string {
  const label = reminderStageLabel(stage);
  // Replace leading "N. Erinnerung" / "N. Mahnung" if present; else prefix.
  const replaced = String(template || '').replace(
    /^\s*\d+\.\s*(Erinnerung|Mahnung|Mail)\s*[:·-]?\s*/i,
    `${label}: `,
  );
  if (replaced !== template) return replaced;
  if (/erinnerung|mahnung|rücklieferung/i.test(template)) {
    return `${label}: ${template.replace(/^\s*\d+\.\s*/, '')}`;
  }
  return `${label}: ${template}`;
}

export function parseReminderStages(raw: unknown): ReminderStageEvent[] {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReminderStageEvent[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const stage = Number(row.stage);
    if (!Number.isInteger(stage) || stage < 1) continue;
    const sentAtRaw = row.sentAt ?? row.sent_at;
    const scheduledRaw = row.scheduledDate ?? row.scheduled_date;
    const to =
      (Array.isArray(row.recipientsTo) && row.recipientsTo) ||
      (Array.isArray(row.recipients_to) && row.recipients_to) ||
      (row.recipients &&
      typeof row.recipients === 'object' &&
      Array.isArray((row.recipients as any).to)
        ? (row.recipients as any).to
        : []) ||
      [];
    const cc =
      (Array.isArray(row.recipientsCc) && row.recipientsCc) ||
      (Array.isArray(row.recipients_cc) && row.recipients_cc) ||
      (row.recipients &&
      typeof row.recipients === 'object' &&
      Array.isArray((row.recipients as any).cc)
        ? (row.recipients as any).cc
        : []) ||
      [];
    out.push({
      stage,
      sentAt: sentAtRaw ? new Date(String(sentAtRaw)).toISOString() : null,
      scheduledDate: scheduledRaw ? String(scheduledRaw).slice(0, 10) : null,
      recipientsTo: asEmailList(to),
      recipientsCc: asEmailList(cc),
      subject: row.subject != null ? String(row.subject).slice(0, 500) : undefined,
      sentBy: row.sentBy != null || row.sent_by != null
        ? String(row.sentBy ?? row.sent_by).slice(0, 200)
        : undefined,
    });
  }
  return out.sort((a, b) => a.stage - b.stage);
}

/** Build reminder_stages from legacy mail1/2/3 columns (one-time backfill helper). */
export function buildReminderStagesFromLegacy(row: {
  mail1_sent_at?: string | null;
  mail2_sent_at?: string | null;
  mail3_sent_at?: string | null;
  mail1_scheduled_date?: string | null;
  mail2_scheduled_date?: string | null;
  mail3_scheduled_date?: string | null;
  mail1_sent_recipients?: HardwareStageOverride | null;
  mail2_sent_recipients?: HardwareStageOverride | null;
  mail3_sent_recipients?: HardwareStageOverride | null;
}): ReminderStageEvent[] {
  const stages: ReminderStageEvent[] = [];
  const push = (
    stage: number,
    sentAt: string | null | undefined,
    scheduled: string | null | undefined,
    recipients: HardwareStageOverride | null | undefined,
  ) => {
    if (!sentAt && !scheduled) return;
    stages.push({
      stage,
      sentAt: sentAt ? new Date(sentAt).toISOString() : null,
      scheduledDate: scheduled ? String(scheduled).slice(0, 10) : null,
      recipientsTo: recipients?.to || [],
      recipientsCc: recipients?.cc || [],
    });
  };
  push(1, row.mail1_sent_at, row.mail1_scheduled_date, row.mail1_sent_recipients);
  push(2, row.mail2_sent_at, row.mail2_scheduled_date, row.mail2_sent_recipients);
  push(3, row.mail3_sent_at, row.mail3_scheduled_date, row.mail3_sent_recipients);
  return stages;
}

export function reminderCountFromStages(stages: ReminderStageEvent[]): number {
  let max = 0;
  for (const s of stages) {
    if (s.sentAt && s.stage > max) max = s.stage;
  }
  return max;
}

export function getStageEvent(
  stages: ReminderStageEvent[],
  stage: number,
): ReminderStageEvent | null {
  return stages.find((s) => s.stage === stage) || null;
}

export function isStageSent(
  row: Pick<
    TicketHardwareReturnRecord,
    | 'reminder_stages'
    | 'mail1_sent_at'
    | 'mail2_sent_at'
    | 'mail3_sent_at'
  >,
  stage: number,
): boolean {
  const ev = getStageEvent(row.reminder_stages || [], stage);
  if (ev?.sentAt) return true;
  if (stage === 1) return Boolean(row.mail1_sent_at);
  if (stage === 2) return Boolean(row.mail2_sent_at);
  if (stage === 3) return Boolean(row.mail3_sent_at);
  return false;
}

export function getStageSentAt(
  row: Pick<
    TicketHardwareReturnRecord,
    | 'reminder_stages'
    | 'mail1_sent_at'
    | 'mail2_sent_at'
    | 'mail3_sent_at'
  >,
  stage: number,
): string | null {
  const ev = getStageEvent(row.reminder_stages || [], stage);
  if (ev?.sentAt) return ev.sentAt;
  if (stage === 1) return row.mail1_sent_at || null;
  if (stage === 2) return row.mail2_sent_at || null;
  if (stage === 3) return row.mail3_sent_at || null;
  return null;
}

export function getStageScheduledDate(
  row: Pick<
    TicketHardwareReturnRecord,
    | 'reminder_stages'
    | 'mail1_scheduled_date'
    | 'mail2_scheduled_date'
    | 'mail3_scheduled_date'
  >,
  stage: number,
): string | null {
  const ev = getStageEvent(row.reminder_stages || [], stage);
  if (ev?.scheduledDate) return ev.scheduledDate;
  if (stage === 1) return row.mail1_scheduled_date || null;
  if (stage === 2) return row.mail2_scheduled_date || null;
  if (stage === 3) return row.mail3_scheduled_date || null;
  return null;
}

/** Upsert a sent event into reminder_stages (immutable return). */
export function upsertReminderStageSent(
  stages: ReminderStageEvent[],
  event: ReminderStageEvent,
): ReminderStageEvent[] {
  const next = stages.filter((s) => s.stage !== event.stage);
  next.push(event);
  return next.sort((a, b) => a.stage - b.stage);
}

/** Legacy mailN key for stages 1–3 (null for stage > 3). */
export function legacyMailKey(stage: number): 'mail1' | 'mail2' | 'mail3' | null {
  if (stage === 1) return 'mail1';
  if (stage === 2) return 'mail2';
  if (stage === 3) return 'mail3';
  return null;
}

/** Override storage key — mail1/2/3 for legacy, stageN for N>3. */
export function stageOverrideKey(stage: number): string {
  return legacyMailKey(stage) || `stage${stage}`;
}
