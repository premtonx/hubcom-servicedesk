/**
 * Hardware-Rücklieferungen escalation: preview, send, stamp, timeline, workbench list.
 */

import { getDocDirect, queryDb } from '../postgres-backend.js';
import { trySendTransactionalEmail } from '../outbound-mail.js';
import { prepareOutboundEmailHtml } from '../email-html-prepare.js';
import {
  appendHardwareReturnActivity,
  getHardwareReturnById,
  insertStandaloneHardwareReturn,
  mapHardwareRow,
  normalizeHardwareReturnsConfig,
  resolveHardwareReturnByParam,
  updateHardwareReturnById,
  type HardwareReturnsConfig,
  type TicketHardwareReturnInput,
  type TicketHardwareReturnRecord,
} from './hardware-returns.js';
import { getOrganization, listOrganizations } from './organizations.js';
import {
  buildReminderHtmlEmail,
  buildReminderTemplateVars,
  deriveMailStatus,
  evaluateDueReminderStage,
  overdueDays,
  resolveStageRecipients,
  shouldSkipAutoSend,
  type ReminderStage,
  type ResolveStageTicketContext,
} from './hardware-returns-recipients.js';

function ticketContextFromReturn(
  hw: TicketHardwareReturnRecord,
): ResolveStageTicketContext {
  return {
    id: hw.return_number || hw.id,
    customer_email: hw.employee_email,
    customerEmail: hw.employee_email,
    customer_name: hw.employee_name,
    customerName: hw.employee_name,
  };
}

function ticketContext(ticket: Record<string, unknown> | null | undefined): ResolveStageTicketContext {
  if (!ticket) return {};
  return {
    id: String(ticket.id || ''),
    customer_email: (ticket.customerEmail || ticket.customer_email || null) as string | null,
    customerEmail: (ticket.customerEmail || ticket.customer_email || null) as string | null,
    customer_name: (ticket.customerName || ticket.customer_name || null) as string | null,
    customerName: (ticket.customerName || ticket.customer_name || null) as string | null,
  };
}

async function loadTicket(ticketId: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!ticketId) return null;
  const doc = await getDocDirect('tickets', ticketId);
  if (!doc) return null;
  return { id: ticketId, ...doc };
}

function resolveContext(hw: TicketHardwareReturnRecord, ticket: Record<string, unknown> | null) {
  const fromReturn = ticketContextFromReturn(hw);
  const fromTicket = ticketContext(ticket);
  return {
    id: fromReturn.id || fromTicket.id,
    customer_email: fromReturn.customer_email || fromTicket.customer_email,
    customerEmail: fromReturn.customerEmail || fromTicket.customerEmail,
    customer_name: fromReturn.customer_name || fromTicket.customer_name,
    customerName: fromReturn.customerName || fromTicket.customerName,
  };
}

/**
 * Create a standalone Hardware-Rücklieferung — NEVER writes a normal ticket.
 */
export async function createHardwareReturnFromWorkbench(params: {
  organizationId: string;
  actorId: string;
  actorName?: string | null;
  actorEmail?: string | null;
  /** Betreff — optional/nullable. */
  subject?: string | null;
  description?: string | null;
  requesterId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  hardwareReturn: TicketHardwareReturnInput;
}): Promise<{
  id: string;
  ticketId: string;
  hardwareReturn: TicketHardwareReturnRecord;
  ticket: Record<string, unknown>;
}> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const subjectRaw = params.subject == null ? null : String(params.subject).trim();
  const subject = subjectRaw ? subjectRaw.slice(0, 500) : null;
  const description =
    String(params.description || '').trim() ||
    String(params.hardwareReturn.device_details || '').trim() ||
    null;
  const hardwareReturn = await insertStandaloneHardwareReturn({
    organizationId: params.organizationId,
    actorId: params.actorId || null,
    actorName: params.actorName || params.actorEmail || null,
    mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
    input: {
      return_required: true,
      auto_reminder_enabled: true,
      sla: 'Normal',
      ...params.hardwareReturn,
      subject,
      description,
      employee_name:
        params.hardwareReturn.employee_name ??
        params.customerName ??
        params.actorName ??
        null,
      employee_email:
        params.hardwareReturn.employee_email ??
        params.customerEmail ??
        params.actorEmail ??
        null,
      // Bearbeiter defaults to creator when not explicitly chosen.
      assignee_name:
        params.hardwareReturn.assignee_name ?? params.actorName ?? params.actorEmail ?? null,
      assignee_user_id: params.hardwareReturn.assignee_user_id ?? params.actorId ?? null,
      status: params.hardwareReturn.status || 'Neu',
      ticket_id: null,
    },
  });
  // ticketId alias = return id so transitional clients can call /:ticketId routes.
  return {
    id: hardwareReturn.id,
    ticketId: hardwareReturn.id,
    hardwareReturn,
    ticket: {
      id: hardwareReturn.id,
      subject: hardwareReturn.subject,
      description: hardwareReturn.description,
      customerName: hardwareReturn.employee_name,
      customerEmail: hardwareReturn.employee_email,
      status: hardwareReturn.status,
      organizationId: hardwareReturn.organization_id,
    },
  };
}

export async function stampMailStageSent(params: {
  returnId: string;
  stage: ReminderStage;
  recipients: { to: string[]; cc: string[] };
  subject?: string;
  sentBy?: string;
}): Promise<TicketHardwareReturnRecord | null> {
  const existing = await getHardwareReturnById(params.returnId);
  if (!existing) return null;

  const {
    upsertReminderStageSent,
    reminderCountFromStages,
    legacyMailKey,
  } = await import('./hardware-returns-stages.js');
  const sentAt = new Date().toISOString();
  const nextStages = upsertReminderStageSent(existing.reminder_stages || [], {
    stage: params.stage,
    sentAt,
    scheduledDate: null,
    recipientsTo: params.recipients.to,
    recipientsCc: params.recipients.cc,
    subject: params.subject,
    sentBy: params.sentBy,
  });
  const reminderCount = Math.max(
    existing.reminder_count || 0,
    reminderCountFromStages(nextStages),
    params.stage,
  );

  const legacy = legacyMailKey(params.stage);
  const recipientsJson = JSON.stringify(params.recipients);

  let sql = `UPDATE ticket_hardware_returns
     SET reminder_stages = $2::jsonb,
         reminder_count = $3::int,
         updated_at = NOW()`;
  const args: unknown[] = [params.returnId, JSON.stringify(nextStages), reminderCount];
  if (legacy === 'mail1') {
    sql += `, mail1_sent_at = $4::timestamptz, mail1_sent_recipients = $5::jsonb`;
    args.push(sentAt, recipientsJson);
  } else if (legacy === 'mail2') {
    sql += `, mail2_sent_at = $4::timestamptz, mail2_sent_recipients = $5::jsonb`;
    args.push(sentAt, recipientsJson);
  } else if (legacy === 'mail3') {
    sql += `, mail3_sent_at = $4::timestamptz, mail3_sent_recipients = $5::jsonb`;
    args.push(sentAt, recipientsJson);
  }
  sql += ` WHERE id = $1::uuid RETURNING *`;

  const res = await queryDb(sql, args);
  if (!res.rowCount) return null;
  return mapHardwareRow(res.rows[0]);
}

export async function appendHardwareReminderTimeline(params: {
  returnId: string;
  stage: ReminderStage;
  to: string[];
  cc: string[];
  auto: boolean;
  actorName?: string;
}): Promise<void> {
  const { reminderStageLabel } = await import('./hardware-returns-stages.js');
  const stageLabel = reminderStageLabel(params.stage);
  const mode = params.auto ? 'automatisch' : 'manuell';
  await appendHardwareReturnActivity(params.returnId, {
    at: new Date().toISOString(),
    type: 'mail_sent',
    stage: params.stage,
    actor: params.actorName || 'System',
    message: `Hardware-Rücklieferung — ${stageLabel} versendet (${mode})`,
    to: params.to,
    cc: params.cc,
  });
}

export async function previewHardwareReminder(params: {
  /** Hardware-return id or legacy ticket_id. */
  ticketId: string;
  organizationId: string;
  stage: ReminderStage;
  overrideTo?: string[] | null;
  overrideCc?: string[] | null;
}): Promise<{
  to: string[];
  cc: string[];
  missingRoles: string[];
  subject: string;
  htmlPreview: string;
  skipReason: string | null;
}> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const hw = await resolveHardwareReturnByParam(params.ticketId, params.organizationId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  const ticket = await loadTicket(hw.ticket_id);
  const ctx = resolveContext(hw, ticket);
  const config = org.hardware_returns_config;
  const resolved = resolveStageRecipients(params.stage, ctx, hw, config, {
    overrideTo: params.overrideTo,
    overrideCc: params.overrideCc,
  });
  const vars = buildReminderTemplateVars({ ticket: ctx, hardwareReturn: hw, orgConfig: config });
  const { resolveConfiguredStage } = await import('./hardware-returns-stages.js');
  const { configured } = resolveConfiguredStage(config, params.stage);
  const { subject, html } = buildReminderHtmlEmail({
    subject: configured.subjectTemplate,
    bodyTextOrHtml: configured.bodyTemplate,
    vars,
    stage: params.stage,
  });
  const skip = shouldSkipAutoSend({
    stage: params.stage,
    to: resolved.to,
    missingRoles: resolved.missingRoles,
  });
  return {
    ...resolved,
    subject,
    htmlPreview: prepareOutboundEmailHtml(html),
    skipReason: skip
      ? resolved.to.length === 0
        ? 'Empfänger fehlt (An ist leer).'
        : 'Eskalationskontakte fehlen (Stufe ≥ 3).'
      : null,
  };
}

export async function sendHardwareReminder(params: {
  ticketId: string;
  organizationId: string;
  stage: ReminderStage;
  to?: string[] | null;
  cc?: string[] | null;
  saveAsTicketOverride?: boolean;
  auto?: boolean;
  actorName?: string;
}): Promise<{
  hardwareReturn: TicketHardwareReturnRecord;
  to: string[];
  cc: string[];
  delivered: boolean;
  reason?: string;
}> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  let hw = await resolveHardwareReturnByParam(params.ticketId, params.organizationId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  if (hw.returned) {
    throw Object.assign(new Error('Bereits zurückgeliefert — kein Versand.'), { status: 400 });
  }

  const ticket = await loadTicket(hw.ticket_id);
  const ctx = resolveContext(hw, ticket);
  const config = org.hardware_returns_config;
  const resolved = resolveStageRecipients(params.stage, ctx, hw, config, {
    overrideTo: params.to,
    overrideCc: params.cc,
  });

  if (!resolved.to.length) {
    throw Object.assign(new Error('Empfänger fehlt — An (To) ist leer.'), { status: 400 });
  }

  const { resolveConfiguredStage, stageOverrideKey } = await import(
    './hardware-returns-stages.js'
  );
  const { configured } = resolveConfiguredStage(config, params.stage);

  if (params.saveAsTicketOverride) {
    const key = stageOverrideKey(params.stage);
    const override = {
      ...(hw.stage_recipients_override || {}),
      [key]: { to: resolved.to, cc: resolved.cc },
    };
    hw = await updateHardwareReturnById({
      id: hw.id,
      organizationId: params.organizationId,
      input: { stage_recipients_override: override },
      mail1Days: config.mail1_days_after_delivery,
    });
  }

  const vars = buildReminderTemplateVars({ ticket: ctx, hardwareReturn: hw, orgConfig: config });
  const { subject, html } = buildReminderHtmlEmail({
    subject: configured.subjectTemplate,
    bodyTextOrHtml: configured.bodyTemplate,
    vars,
    stage: params.stage,
  });

  const sendResult = await trySendTransactionalEmail({
    to: resolved.to,
    cc: resolved.cc,
    subject,
    body: prepareOutboundEmailHtml(html),
    organizationId: params.organizationId,
    contentType: 'HTML',
  });

  if (!sendResult.delivered) {
    throw Object.assign(
      new Error(sendResult.reason || 'E-Mail-Versand fehlgeschlagen.'),
      { status: 502 },
    );
  }

  const stamped = await stampMailStageSent({
    returnId: hw.id,
    stage: params.stage,
    recipients: { to: resolved.to, cc: resolved.cc },
    subject,
    sentBy: params.actorName || (params.auto ? 'System' : undefined),
  });
  await appendHardwareReminderTimeline({
    returnId: hw.id,
    stage: params.stage,
    to: resolved.to,
    cc: resolved.cc,
    auto: Boolean(params.auto),
    actorName: params.actorName,
  });

  return {
    hardwareReturn: stamped!,
    to: resolved.to,
    cc: resolved.cc,
    delivered: true,
    reason: sendResult.reason,
  };
}

export async function markHardwareReturned(params: {
  ticketId: string;
  organizationId: string;
  returnedAt?: string | null;
  note?: string | null;
  actorName?: string;
}): Promise<TicketHardwareReturnRecord> {
  const hw = await resolveHardwareReturnByParam(params.ticketId, params.organizationId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const returnedAtRaw = params.returnedAt ? new Date(params.returnedAt) : new Date();
  if (Number.isNaN(returnedAtRaw.getTime())) {
    throw Object.assign(new Error('Ungültiger returned_at Zeitstempel.'), { status: 400 });
  }
  const returnedAt = returnedAtRaw.toISOString();
  // Targeted update only — do not touch DATE columns (avoids locale-string round-trips).
  const res = await queryDb(
    `UPDATE ticket_hardware_returns
     SET returned = TRUE,
         returned_at = $2::timestamptz,
         status = 'returned',
         updated_at = NOW()
     WHERE id = $1::uuid AND organization_id = $3
     RETURNING *`,
    [hw.id, returnedAt, params.organizationId],
  );
  if (!res.rowCount) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  await appendHardwareReturnActivity(hw.id, {
    at: new Date().toISOString(),
    type: 'returned',
    actor: params.actorName || 'Hubcom ServiceDesk',
    message: params.note
      ? `Rücklieferung erfolgt — ${String(params.note).slice(0, 2000)}`
      : 'Rücklieferung erfolgt',
    meta: { returnedAt },
  });
  return (await getHardwareReturnById(hw.id)) || mapHardwareRow(res.rows[0]);
}

export interface HardwareReturnsListFilters {
  organizationId: string;
  view?: 'open' | 'overdue' | 'next_mail' | 'done' | 'all';
  search?: string;
  mailStatus?: 'all' | 'none' | 'mail1' | 'mail2' | 'mail3' | 'missing_recipients';
  overdueBucket?: 'all' | 'not_due' | '1_7' | '8_21' | 'gt_21';
  deliveryFrom?: string;
  deliveryTo?: string;
  dueFrom?: string;
  dueTo?: string;
  shippingMethod?: string;
  /** Exact status label from org catalogs (e.g. Neu). */
  status?: string;
  /** Match assignee_user_id or assignee_name (case-insensitive). */
  assignee?: string;
  exportStatus?: 'all' | 'exported' | 'not_exported';
  sort?: 'due_asc' | 'newest' | 'employee' | 'ticket';
  limit?: number;
  offset?: number;
}

export interface HardwareReturnsListItem {
  hardwareReturn: TicketHardwareReturnRecord;
  ticket: {
    id: string;
    subject: string | null;
    customerName: string | null;
    customerEmail: string | null;
  };
  overdueDays: number;
  mailStatus: string;
  missingRoles: string[];
  nextDueStage: ReminderStage | null;
}

export interface HardwareReturnsKpis {
  open: number;
  overdue: number;
  nextMailDue: number;
  stage3: number;
  returnedLast30: number;
}

function mapHwRow(row: any): TicketHardwareReturnRecord {
  return mapHardwareRow(row);
}

export async function listHardwareReturnsWorkbench(
  filters: HardwareReturnsListFilters,
): Promise<{ items: HardwareReturnsListItem[]; kpis: HardwareReturnsKpis; total: number }> {
  const org = await getOrganization(filters.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const config = org.hardware_returns_config;
  const res = await queryDb(
    `SELECT * FROM ticket_hardware_returns
     WHERE organization_id = $1 AND return_required = TRUE
     ORDER BY COALESCE(return_due_date, delivery_date, created_at::date) ASC NULLS LAST
     LIMIT 2000`,
    [filters.organizationId],
  );
  const rows = res.rows.map(mapHwRow);
  const now = new Date();
  const items: HardwareReturnsListItem[] = [];

  for (const hw of rows) {
    const ticket = await loadTicket(hw.ticket_id);
    const ctx = resolveContext(hw, ticket);
    const days = overdueDays(hw, config, now);
    const mailStatus = deriveMailStatus(hw, config, ctx);
    const stage1 = resolveStageRecipients(1, ctx, hw, config);
    const nextDue = evaluateDueReminderStage(hw, { ...config, auto_send_enabled: true }, now);
    items.push({
      hardwareReturn: hw,
      ticket: {
        // Primary key for API routes is the return id (legacy clients still call it ticketId).
        id: hw.id,
        subject: hw.subject || (ticket ? String(ticket.subject || '') : null) || null,
        customerName:
          hw.employee_name ||
          ((ctx.customerName || ctx.customer_name || null) as string | null),
        customerEmail:
          hw.employee_email ||
          ((ctx.customerEmail || ctx.customer_email || null) as string | null),
      },
      overdueDays: days,
      mailStatus,
      missingRoles: stage1.missingRoles,
      nextDueStage: hw.returned ? null : nextDue,
    });
  }

  const q = String(filters.search || '')
    .trim()
    .toLowerCase();
  let filtered = items.filter((it) => {
    const hw = it.hardwareReturn;
    if (filters.view === 'open' && (hw.returned || !hw.return_required)) return false;
    if (filters.view === 'overdue' && (hw.returned || it.overdueDays <= 0)) return false;
    if (filters.view === 'next_mail' && (hw.returned || !it.nextDueStage)) return false;
    if (filters.view === 'done' && !hw.returned) return false;
    if (filters.mailStatus && filters.mailStatus !== 'all' && it.mailStatus !== filters.mailStatus) {
      return false;
    }
    if (filters.exportStatus === 'exported' && !hw.exported) return false;
    if (filters.exportStatus === 'not_exported' && hw.exported) return false;
    if (filters.shippingMethod && hw.shipping_method !== filters.shippingMethod) return false;
    if (filters.status && String(hw.status || '').trim() !== String(filters.status).trim()) {
      return false;
    }
    if (filters.assignee) {
      const want = String(filters.assignee).trim().toLowerCase();
      const id = String(hw.assignee_user_id || '').trim().toLowerCase();
      const name = String(hw.assignee_name || '').trim().toLowerCase();
      if (want !== id && want !== name) return false;
    }
    if (filters.overdueBucket && filters.overdueBucket !== 'all') {
      const d = it.overdueDays;
      if (filters.overdueBucket === 'not_due' && d > 0) return false;
      if (filters.overdueBucket === '1_7' && !(d >= 1 && d <= 7)) return false;
      if (filters.overdueBucket === '8_21' && !(d >= 8 && d <= 21)) return false;
      if (filters.overdueBucket === 'gt_21' && !(d > 21)) return false;
    }
    if (filters.deliveryFrom && (!hw.delivery_date || hw.delivery_date < filters.deliveryFrom)) {
      return false;
    }
    if (filters.deliveryTo && (!hw.delivery_date || hw.delivery_date > filters.deliveryTo)) {
      return false;
    }
    if (filters.dueFrom && (!hw.return_due_date || hw.return_due_date < filters.dueFrom)) {
      return false;
    }
    if (filters.dueTo && (!hw.return_due_date || hw.return_due_date > filters.dueTo)) {
      return false;
    }
    if (q) {
      const hay = [
        hw.id,
        hw.ticket_id,
        hw.return_number,
        hw.external_ref_id,
        hw.subject,
        hw.employee_name,
        hw.employee_email,
        hw.assignee_name,
        hw.assignee_user_id,
        hw.status,
        hw.device_old_type,
        hw.device_old_serial,
        hw.device_new_type,
        hw.device_new_serial,
        it.ticket.customerName,
        it.ticket.customerEmail,
        hw.project_manager_name,
        hw.project_manager_email,
        hw.manager_name,
        hw.manager_email,
        hw.device_details,
        hw.shipping_method,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sort = filters.sort || 'due_asc';
  filtered.sort((a, b) => {
    if (sort === 'newest') {
      return String(b.hardwareReturn.created_at).localeCompare(String(a.hardwareReturn.created_at));
    }
    if (sort === 'employee') {
      return String(a.hardwareReturn.employee_name || a.ticket.customerName || '').localeCompare(
        String(b.hardwareReturn.employee_name || b.ticket.customerName || ''),
        'de',
      );
    }
    if (sort === 'ticket') {
      return String(a.hardwareReturn.return_number || a.hardwareReturn.id).localeCompare(
        String(b.hardwareReturn.return_number || b.hardwareReturn.id),
      );
    }
    const ad = a.hardwareReturn.return_due_date || a.hardwareReturn.delivery_date || '';
    const bd = b.hardwareReturn.return_due_date || b.hardwareReturn.delivery_date || '';
    return ad.localeCompare(bd);
  });

  const total = filtered.length;
  const offset = Math.max(0, filters.offset || 0);
  // Allow up to 2000 so "Alle" can page the full in-memory set.
  const limit = Math.min(2000, Math.max(1, filters.limit || 100));
  const page = filtered.slice(offset, offset + limit);

  const openItems = items.filter(
    (i) => !i.hardwareReturn.returned && i.hardwareReturn.return_required,
  );
  const kpis: HardwareReturnsKpis = {
    open: openItems.length,
    overdue: openItems.filter((i) => i.overdueDays > 0).length,
    nextMailDue: openItems.filter((i) => i.nextDueStage != null).length,
    stage3: openItems.filter(
      (i) =>
        !i.hardwareReturn.returned &&
        i.hardwareReturn.return_required &&
        Boolean(i.hardwareReturn.mail3_sent_at),
    ).length,
    // Only count rows that are still marked returned with a recent returned_at.
    returnedLast30: items.filter((i) => {
      if (!i.hardwareReturn.returned || !i.hardwareReturn.returned_at) return false;
      const t = new Date(i.hardwareReturn.returned_at).getTime();
      if (Number.isNaN(t)) return false;
      return t >= now.getTime() - 30 * 24 * 60 * 60 * 1000;
    }).length,
  };

  return { items: page, kpis, total };
}

export async function bulkHardwareReturnsAction(params: {
  organizationId: string;
  ticketIds: string[];
  action: 'mark_returned' | 'mark_exported' | 'csv_export';
  actorName?: string;
}): Promise<{ updated: number; csv?: string }> {
  const ids = Array.from(new Set(params.ticketIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(
    0,
    500,
  );
  if (params.action === 'csv_export') {
    const { items } = await listHardwareReturnsWorkbench({
      organizationId: params.organizationId,
      view: 'all',
      limit: 2000,
    });
    const selected = ids.length
      ? items.filter(
          (i) =>
            ids.includes(i.hardwareReturn.id) ||
            (i.hardwareReturn.ticket_id != null && ids.includes(i.hardwareReturn.ticket_id)) ||
            (i.hardwareReturn.return_number != null &&
              ids.includes(i.hardwareReturn.return_number)),
        )
      : items;
    const header = [
      'id',
      'return_number',
      'external_ref_id',
      'mitarbeiter',
      'email',
      'projektmanager',
      'chef',
      'geraet',
      'lieferung',
      'faellig',
      'mail1',
      'mail2',
      'mail3',
      'returned',
      'exported',
    ];
    const lines = [header.join(';')];
    for (const it of selected) {
      const hw = it.hardwareReturn;
      lines.push(
        [
          hw.id,
          hw.return_number || '',
          hw.external_ref_id || '',
          hw.employee_name || it.ticket.customerName || '',
          hw.employee_email || it.ticket.customerEmail || '',
          hw.project_manager_email || '',
          hw.manager_email || '',
          (hw.device_details || '').replace(/[\n;]/g, ' '),
          hw.delivery_date || '',
          hw.return_due_date || '',
          hw.mail1_sent_at || '',
          hw.mail2_sent_at || '',
          hw.mail3_sent_at || '',
          hw.returned ? '1' : '0',
          hw.exported ? '1' : '0',
        ].join(';'),
      );
    }
    return { updated: selected.length, csv: lines.join('\n') };
  }

  let updated = 0;
  for (const ticketId of ids) {
    const hw = await resolveHardwareReturnByParam(ticketId, params.organizationId);
    if (!hw || hw.organization_id !== params.organizationId) continue;
    if (params.action === 'mark_returned') {
      await markHardwareReturned({
        ticketId: hw.id,
        organizationId: params.organizationId,
        actorName: params.actorName,
      });
      updated += 1;
    } else if (params.action === 'mark_exported') {
      await updateHardwareReturnById({
        id: hw.id,
        organizationId: params.organizationId,
        input: { exported: true },
      });
      updated += 1;
    }
  }
  return { updated };
}

/** Import PowerApps-style CSV without creating normal tickets or triggering auto-emails. */
export async function importHardwareReturnsCsv(params: {
  organizationId: string;
  csv: string;
  actorId?: string;
}): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const lines = String(params.csv || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { imported: 0, skipped: 0, errors: ['CSV leer'] };

  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) =>
    headers.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const iId = idx(['id', 'external_ref', 'legacy', 'ticket', 'return_number']);
  const iEmp = idx(['mitarbeiter', 'employee', 'name']);
  const iEmail = idx(['e-mail', 'email', 'mail']);
  const iPm = idx(['projektmanager', 'project_manager']);
  const iChef = idx(['chef', 'vorgesetzter', 'manager']);
  const iDevice = idx(['gerät', 'geraet', 'device']);
  const iReturnWhen = idx(['rücklieferung wann', 'returned', 'zurueck']);
  const iMail1 = idx(['mail1']);
  const iMail2 = idx(['mail2']);
  const iMail3 = idx(['mail3']);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let li = 1; li < lines.length; li += 1) {
    const cols = lines[li].split(sep).map((c) => c.trim());
    const externalId = iId >= 0 ? cols[iId] : '';
    const email = iEmail >= 0 ? cols[iEmail] : '';
    const empName = iEmp >= 0 ? cols[iEmp] : '';
    if (!email && !externalId) {
      skipped += 1;
      continue;
    }
    try {
      let existing: TicketHardwareReturnRecord | null = null;
      if (externalId) {
        existing = await resolveHardwareReturnByParam(externalId, params.organizationId);
        if (!existing) {
          const found = await queryDb(
            `SELECT * FROM ticket_hardware_returns
             WHERE organization_id = $1
               AND (external_ref_id = $2 OR return_number = $2)
             LIMIT 1`,
            [params.organizationId, externalId],
          );
          if (found.rowCount) existing = mapHardwareRow(found.rows[0]);
        }
      }

      const returnedRaw = iReturnWhen >= 0 ? cols[iReturnWhen] : '';
      const returned = Boolean(returnedRaw && !/^nein|no|0|false$/i.test(returnedRaw));
      const input: TicketHardwareReturnInput = {
        external_ref_id: externalId || null,
        return_number: externalId || undefined,
        subject: `Hardware-Rücklieferung Import ${externalId || empName || email}`,
        description: 'Importiert aus PowerApps CSV (ohne Auto-Mails).',
        employee_name: empName || null,
        employee_email: email || null,
        device_details: iDevice >= 0 ? cols[iDevice] || null : null,
        project_manager_email: iPm >= 0 ? cols[iPm] || null : null,
        manager_email: iChef >= 0 ? cols[iChef] || null : null,
        return_required: true,
        returned,
        returned_at: returned ? new Date().toISOString() : null,
        status: returned ? 'returned' : 'open',
        auto_reminder_enabled: false,
        ticket_id: null,
      };

      let hw: TicketHardwareReturnRecord;
      if (existing) {
        hw = await updateHardwareReturnById({
          id: existing.id,
          organizationId: params.organizationId,
          input,
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
        });
      } else {
        hw = await insertStandaloneHardwareReturn({
          organizationId: params.organizationId,
          actorName: params.actorId || 'import',
          mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
          input,
        });
      }

      if (iMail1 >= 0 && cols[iMail1]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail1_sent_at = $2::timestamptz, auto_reminder_enabled = FALSE
           WHERE id = $1::uuid`,
          [hw.id, new Date(cols[iMail1]).toISOString()],
        );
      }
      if (iMail2 >= 0 && cols[iMail2]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail2_sent_at = $2::timestamptz WHERE id = $1::uuid`,
          [hw.id, new Date(cols[iMail2]).toISOString()],
        );
      }
      if (iMail3 >= 0 && cols[iMail3]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail3_sent_at = $2::timestamptz WHERE id = $1::uuid`,
          [hw.id, new Date(cols[iMail3]).toISOString()],
        );
      }
      await appendHardwareReturnActivity(hw.id, {
        at: new Date().toISOString(),
        type: 'imported',
        actor: params.actorId || 'import',
        message: 'CSV-Import',
        meta: { external_ref_id: externalId || null },
      });
      imported += 1;
    } catch (err: any) {
      errors.push(`Zeile ${li + 1}: ${err?.message || err}`);
      skipped += 1;
    }
  }

  return { imported, skipped, errors: errors.slice(0, 50) };
}

/** Process one auto-send pass for all enabled orgs. Returns counts for tests/logs. */
export async function runHardwareReturnsAutoSendPass(now: Date = new Date()): Promise<{
  considered: number;
  sent: number;
  skipped: number;
}> {
  const orgs = await listOrganizations({ includeInactive: false });
  let considered = 0;
  let sent = 0;
  let skipped = 0;

  for (const org of orgs) {
    if (!org.hardware_returns_enabled) continue;
    const config = normalizeHardwareReturnsConfig(org.hardware_returns_config);
    if (!config.auto_send_enabled) continue;

    const res = await queryDb(
      `SELECT * FROM ticket_hardware_returns
       WHERE organization_id = $1
         AND return_required = TRUE
         AND returned = FALSE
         AND auto_reminder_enabled = TRUE`,
      [org.id],
    );

    for (const raw of res.rows) {
      const hw = mapHwRow(raw);
      considered += 1;
      const stage = evaluateDueReminderStage(hw, config, now);
      if (!stage) {
        skipped += 1;
        continue;
      }
      const ticket = await loadTicket(hw.ticket_id);
      const ctx = resolveContext(hw, ticket);
      const resolved = resolveStageRecipients(stage, ctx, hw, config);
      if (
        shouldSkipAutoSend({
          stage,
          to: resolved.to,
          missingRoles: resolved.missingRoles,
        })
      ) {
        skipped += 1;
        continue;
      }
      try {
        await sendHardwareReminder({
          ticketId: hw.id,
          organizationId: org.id,
          stage,
          to: resolved.to,
          cc: resolved.cc,
          auto: true,
          actorName: 'Auto-Erinnerung',
        });
        sent += 1;
      } catch {
        skipped += 1;
      }
    }
  }

  return { considered, sent, skipped };
}

export type { HardwareReturnsConfig };
