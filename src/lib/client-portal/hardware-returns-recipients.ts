/**
 * Pure recipient resolver + due-stage evaluation for Hardware-Rücklieferungen.
 * No I/O — safe for unit tests.
 */

import type {
  HardwareReturnsConfig,
  HardwareRoleToken,
  HardwareStageOverride,
  TicketHardwareReturnRecord,
} from './hardware-returns.js';

export type ReminderStage = 1 | 2 | 3;

export interface ResolveStageTicketContext {
  customer_email?: string | null;
  customerEmail?: string | null;
  customer_name?: string | null;
  customerName?: string | null;
  id?: string;
}

export interface ResolveStageRecipientsResult {
  to: string[];
  cc: string[];
  missingRoles: HardwareRoleToken[];
}

function stageKey(stage: ReminderStage): 'mail1' | 'mail2' | 'mail3' {
  return stage === 1 ? 'mail1' : stage === 2 ? 'mail2' : 'mail3';
}

function isValidEmail(raw: string | null | undefined): raw is string {
  const e = String(raw || '')
    .trim()
    .toLowerCase();
  return Boolean(e && e.includes('@') && e.length <= 320 && !/\s/.test(e));
}

function normalizeEmail(raw: string): string {
  return String(raw).trim().toLowerCase();
}

function uniqueEmails(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!isValidEmail(raw)) continue;
    const e = normalizeEmail(raw);
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function roleEmail(
  role: HardwareRoleToken,
  ticket: ResolveStageTicketContext,
  hardwareReturn: TicketHardwareReturnRecord | null | undefined,
  orgConfig: HardwareReturnsConfig,
): string | null {
  if (role === 'employee') {
    // Standalone returns prefer employee_email on the return row; ticket context is legacy fallback.
    const e =
      hardwareReturn?.employee_email ||
      ticket.customer_email ||
      ticket.customerEmail ||
      null;
    return isValidEmail(e) ? normalizeEmail(e) : null;
  }
  if (role === 'project_manager') {
    const e = hardwareReturn?.project_manager_email || null;
    return isValidEmail(e) ? normalizeEmail(e) : null;
  }
  if (role === 'manager') {
    const e = hardwareReturn?.manager_email || orgConfig.fallback_manager_email || null;
    return isValidEmail(e) ? normalizeEmail(e) : null;
  }
  const e = hardwareReturn?.ceo_email_override || orgConfig.ceo_email || null;
  return isValidEmail(e) ? normalizeEmail(e) : null;
}

/**
 * Resolve deduplicated `{ to, cc, missingRoles }` for a reminder stage.
 * Override (ticket or manual) wins over org role matrix.
 */
export function resolveStageRecipients(
  stage: ReminderStage,
  ticket: ResolveStageTicketContext,
  hardwareReturn: TicketHardwareReturnRecord | null | undefined,
  orgConfig: HardwareReturnsConfig,
  opts?: {
    overrideTo?: string[] | null;
    overrideCc?: string[] | null;
  },
): ResolveStageRecipientsResult {
  const key = stageKey(stage);
  const ticketOverride = hardwareReturn?.stage_recipients_override?.[key];
  const hasManual =
    (opts?.overrideTo != null && Array.isArray(opts.overrideTo)) ||
    (opts?.overrideCc != null && Array.isArray(opts.overrideCc));
  const hasTicketOverride = Boolean(ticketOverride && (ticketOverride.to?.length || ticketOverride.cc?.length));

  if (hasManual || hasTicketOverride) {
    const source: HardwareStageOverride = hasManual
      ? {
          to: Array.isArray(opts?.overrideTo) ? opts!.overrideTo! : ticketOverride?.to || [],
          cc: Array.isArray(opts?.overrideCc) ? opts!.overrideCc! : ticketOverride?.cc || [],
        }
      : {
          to: ticketOverride?.to || [],
          cc: ticketOverride?.cc || [],
        };
    const to = uniqueEmails(source.to || []);
    const toSet = new Set(to);
    const cc = uniqueEmails(source.cc || []).filter((e) => !toSet.has(e));
    return { to, cc, missingRoles: [] };
  }

  const stageCfg = orgConfig.stage_recipients[key];
  const missingRoles: HardwareRoleToken[] = [];
  const toRaw: string[] = [];
  const ccRaw: string[] = [];

  for (const role of stageCfg.to_roles) {
    const email = roleEmail(role, ticket, hardwareReturn, orgConfig);
    if (email) toRaw.push(email);
    else missingRoles.push(role);
  }
  for (const role of stageCfg.cc_roles) {
    const email = roleEmail(role, ticket, hardwareReturn, orgConfig);
    if (email) ccRaw.push(email);
    else if (!missingRoles.includes(role)) missingRoles.push(role);
  }
  toRaw.push(...(stageCfg.extra_to || []));
  ccRaw.push(...(stageCfg.extra_cc || []));

  const to = uniqueEmails(toRaw);
  const toSet = new Set(to);
  const cc = uniqueEmails(ccRaw).filter((e) => !toSet.has(e));
  return { to, cc, missingRoles };
}

/** Stage-3 escalation contacts that must be reachable for safe auto-send. */
export function stage3EscalationRolesMissing(
  missingRoles: HardwareRoleToken[],
): boolean {
  return (
    missingRoles.includes('manager') ||
    missingRoles.includes('ceo') ||
    missingRoles.includes('project_manager')
  );
}

export function shouldSkipAutoSend(params: {
  stage: ReminderStage;
  to: string[];
  missingRoles: HardwareRoleToken[];
}): boolean {
  if (!params.to.length) return true;
  if (params.stage === 3 && stage3EscalationRolesMissing(params.missingRoles)) return true;
  return false;
}

function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetweenUtc(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Which reminder stage (if any) is due for auto-send right now.
 * Idempotent: never returns a stage that was already stamped.
 */
export function evaluateDueReminderStage(
  row: TicketHardwareReturnRecord,
  orgConfig: HardwareReturnsConfig,
  now: Date = new Date(),
): ReminderStage | null {
  if (!orgConfig.auto_send_enabled) return null;
  if (!row.return_required || row.returned || !row.auto_reminder_enabled) return null;

  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );

  if (!row.mail1_sent_at) {
    const due =
      parseDateOnly(row.return_due_date) ||
      (parseDateOnly(row.delivery_date)
        ? addDays(parseDateOnly(row.delivery_date)!, orgConfig.mail1_days_after_delivery)
        : null);
    if (due && today.getTime() >= due.getTime()) return 1;
    return null;
  }

  if (!row.mail2_sent_at) {
    const mail1 = new Date(row.mail1_sent_at);
    if (Number.isNaN(mail1.getTime())) return null;
    const threshold = addDays(mail1, orgConfig.mail2_days_after_mail1);
    if (now.getTime() >= threshold.getTime()) return 2;
    return null;
  }

  if (!row.mail3_sent_at) {
    const mail2 = new Date(row.mail2_sent_at);
    if (Number.isNaN(mail2.getTime())) return null;
    const threshold = addDays(mail2, orgConfig.mail3_days_after_mail2);
    if (now.getTime() >= threshold.getTime()) return 3;
    return null;
  }

  return null;
}

export function overdueDays(
  row: Pick<TicketHardwareReturnRecord, 'return_due_date' | 'delivery_date' | 'returned'>,
  orgConfig: HardwareReturnsConfig,
  now: Date = new Date(),
): number {
  if (row.returned) return 0;
  const due =
    parseDateOnly(row.return_due_date) ||
    (parseDateOnly(row.delivery_date)
      ? addDays(parseDateOnly(row.delivery_date)!, orgConfig.mail1_days_after_delivery)
      : null);
  if (!due) return 0;
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.max(0, daysBetweenUtc(due, today));
}

export type ReminderMailStatus =
  | 'none'
  | 'mail1'
  | 'mail2'
  | 'mail3'
  | 'missing_recipients';

export function deriveMailStatus(
  row: TicketHardwareReturnRecord,
  orgConfig: HardwareReturnsConfig,
  ticket: ResolveStageTicketContext,
): ReminderMailStatus {
  if (row.mail3_sent_at) return 'mail3';
  if (row.mail2_sent_at) return 'mail2';
  if (row.mail1_sent_at) return 'mail1';
  // Flag rows that cannot auto/manual-send stage 1 due to empty To.
  const resolved = resolveStageRecipients(1, ticket, row, orgConfig);
  if (!resolved.to.length) return 'missing_recipients';
  return 'none';
}

export interface ReminderTemplateVars {
  mitarbeiter: string;
  geraet: string;
  lieferdatum: string;
  faellig: string;
  tage_ueberfaellig: string | number;
  ticket_id: string;
  legacy_id?: string;
  /** Aliases used in default Part-1 templates */
  employee_name?: string;
  return_due_date?: string;
  device_details?: string;
}

export function buildReminderTemplateVars(params: {
  ticket: ResolveStageTicketContext;
  hardwareReturn: TicketHardwareReturnRecord;
  orgConfig: HardwareReturnsConfig;
  now?: Date;
}): ReminderTemplateVars {
  const { ticket, hardwareReturn, orgConfig } = params;
  const name =
    String(hardwareReturn.employee_name || '').trim() ||
    String(ticket.customer_name || ticket.customerName || '').trim() ||
    String(hardwareReturn.employee_email || ticket.customer_email || ticket.customerEmail || 'Mitarbeiter');
  const due =
    hardwareReturn.return_due_date ||
    (hardwareReturn.delivery_date
      ? addDays(
          parseDateOnly(hardwareReturn.delivery_date)!,
          orgConfig.mail1_days_after_delivery,
        )
          .toISOString()
          .slice(0, 10)
      : '');
  const days = overdueDays(hardwareReturn, orgConfig, params.now);
  const ticketId = String(
    hardwareReturn.return_number ||
      hardwareReturn.external_ref_id ||
      ticket.id ||
      hardwareReturn.ticket_id ||
      hardwareReturn.id ||
      '',
  );
  return {
    mitarbeiter: name,
    geraet: String(hardwareReturn.device_details || '—'),
    lieferdatum: String(hardwareReturn.delivery_date || '—'),
    faellig: due || '—',
    tage_ueberfaellig: days,
    ticket_id: ticketId,
    legacy_id: hardwareReturn.external_ref_id || undefined,
    employee_name: name,
    return_due_date: due || '—',
    device_details: String(hardwareReturn.device_details || '—'),
  };
}

/** Replace `{{var}}` placeholders (case-insensitive keys). */
export function renderReminderTemplate(
  template: string,
  vars: ReminderTemplateVars,
): string {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue;
    map[k.toLowerCase()] = String(v);
  }
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
    const k = String(key || '').toLowerCase();
    return map[k] != null ? map[k] : '';
  });
}

/** Outlook-safe branded HTML wrapper for reminder bodies. */
export function buildReminderHtmlEmail(params: {
  subject: string;
  bodyTextOrHtml: string;
  vars: ReminderTemplateVars;
  stage: ReminderStage;
}): { subject: string; html: string } {
  const subject = renderReminderTemplate(params.subject, params.vars);
  const bodyRendered = renderReminderTemplate(params.bodyTextOrHtml, params.vars);
  const looksHtml = /<\s*(p|div|br|table|ul|ol|h[1-6])\b/i.test(bodyRendered);
  const bodyHtml = looksHtml
    ? bodyRendered
    : bodyRendered
        .split(/\n{2,}/)
        .map(
          (para) =>
            `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#1e293b;">${para
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/\n/g, '<br/>')}</p>`,
        )
        .join('');

  const stageLabel =
    params.stage === 1 ? '1. Erinnerung' : params.stage === 2 ? '2. Erinnerung' : '3. Mahnung';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:#0f172a;color:#fff;padding:18px 24px;font-size:16px;font-weight:700;">
        Hubcom ServiceDesk · Hardware-Rücklieferung
      </td></tr>
      <tr><td style="padding:8px 24px 0;font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">
        ${stageLabel} · Ticket ${escapeHtml(params.vars.ticket_id)}
      </td></tr>
      <tr><td style="padding:16px 24px 8px;">${bodyHtml}</td></tr>
      <tr><td style="padding:8px 24px 20px;">
        <table role="presentation" width="100%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
          <tr><td style="padding:12px 14px;font-size:13px;color:#334155;line-height:1.5;">
            <strong>Mitarbeiter:</strong> ${escapeHtml(params.vars.mitarbeiter)}<br/>
            <strong>Gerät / Seriennummern:</strong> ${escapeHtml(params.vars.geraet)}<br/>
            <strong>Lieferung:</strong> ${escapeHtml(String(params.vars.lieferdatum))} ·
            <strong>Fällig:</strong> ${escapeHtml(String(params.vars.faellig))}<br/>
            <strong>Überfällig:</strong> ${escapeHtml(String(params.vars.tage_ueberfaellig))} Tag(e)
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 24px 24px;font-size:12px;color:#94a3b8;">
        Bitte veranlassen Sie die Rücklieferung der bereitgestellten Hardware.
        Bei Fragen antworten Sie auf diese E-Mail.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { stageKey };
