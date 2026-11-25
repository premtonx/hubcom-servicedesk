/**
 * Hardware-Rücklieferungen escalation: preview, send, stamp, timeline, workbench list.
 */

import { addDocDirect, getDocDirect, queryDb, updateDocDirect } from '../postgres-backend.js';
import { trySendTransactionalEmail } from '../outbound-mail.js';
import { prepareOutboundEmailHtml } from '../email-html-prepare.js';
import {
  getHardwareReturnByTicketId,
  normalizeHardwareReturnsConfig,
  upsertHardwareReturn,
  type HardwareReturnsConfig,
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
  stageKey,
  type ReminderStage,
  type ResolveStageTicketContext,
} from './hardware-returns-recipients.js';

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

async function loadTicket(ticketId: string): Promise<Record<string, unknown> | null> {
  const doc = await getDocDirect('tickets', ticketId);
  if (!doc) return null;
  return { id: ticketId, ...doc };
}

export async function stampMailStageSent(params: {
  ticketId: string;
  stage: ReminderStage;
  recipients: { to: string[]; cc: string[] };
}): Promise<TicketHardwareReturnRecord | null> {
  const colAt =
    params.stage === 1 ? 'mail1_sent_at' : params.stage === 2 ? 'mail2_sent_at' : 'mail3_sent_at';
  const colRec =
    params.stage === 1
      ? 'mail1_sent_recipients'
      : params.stage === 2
        ? 'mail2_sent_recipients'
        : 'mail3_sent_recipients';
  const res = await queryDb(
    `UPDATE ticket_hardware_returns
     SET ${colAt} = NOW(),
         ${colRec} = $2::jsonb,
         updated_at = NOW()
     WHERE ticket_id = $1
     RETURNING *`,
    [params.ticketId, JSON.stringify(params.recipients)],
  );
  if (!res.rowCount) return null;
  return (await getHardwareReturnByTicketId(params.ticketId))!;
}

export async function appendHardwareReminderTimeline(params: {
  ticketId: string;
  stage: ReminderStage;
  to: string[];
  cc: string[];
  auto: boolean;
  actorName?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const stageLabel =
    params.stage === 1 ? '1. Mail' : params.stage === 2 ? '2. Mail' : '3. Mail';
  const mode = params.auto ? 'automatisch' : 'manuell';
  const toLine = params.to.join(', ') || '—';
  const ccLine = params.cc.join(', ') || '—';
  const content = `<p><strong>Hardware-Rücklieferung — ${stageLabel} versendet (${mode})</strong></p>
<p>An: ${toLine}<br/>CC: ${ccLine}</p>
<p style="color:#64748b;font-size:12px;">Ausgelöst von ${params.actorName || 'System'}</p>`;

  await addDocDirect(`tickets/${params.ticketId}/messages`, {
    ticketId: params.ticketId,
    senderId: 'system',
    senderType: 'agent',
    senderName: params.actorName || 'Hubcom ServiceDesk',
    content,
    toAddress: toLine,
    cc: ccLine,
    deliveryStatus: 'sent',
    is_internal: false,
    isInternal: false,
    createdAt: now,
    updatedAt: now,
  });
  await updateDocDirect('tickets', params.ticketId, {
    updatedAt: now,
    lastReplyAt: now,
    lastReplyBy: 'agent',
  });
}

export async function previewHardwareReminder(params: {
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
  const hw = await getHardwareReturnByTicketId(params.ticketId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  const ticket = await loadTicket(params.ticketId);
  const ctx = ticketContext(ticket);
  const config = org.hardware_returns_config;
  const resolved = resolveStageRecipients(params.stage, ctx, hw, config, {
    overrideTo: params.overrideTo,
    overrideCc: params.overrideCc,
  });
  const vars = buildReminderTemplateVars({ ticket: ctx, hardwareReturn: hw, orgConfig: config });
  const template = config.templates[stageKey(params.stage)];
  const { subject, html } = buildReminderHtmlEmail({
    subject: template.subject,
    bodyTextOrHtml: template.body,
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
        : 'Eskalationskontakte fehlen (Stufe 3).'
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
  let hw = await getHardwareReturnByTicketId(params.ticketId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  if (hw.returned) {
    throw Object.assign(new Error('Bereits zurückgeliefert — kein Versand.'), { status: 400 });
  }

  const ticket = await loadTicket(params.ticketId);
  const ctx = ticketContext(ticket);
  const config = org.hardware_returns_config;
  const resolved = resolveStageRecipients(params.stage, ctx, hw, config, {
    overrideTo: params.to,
    overrideCc: params.cc,
  });

  if (!resolved.to.length) {
    throw Object.assign(new Error('Empfänger fehlt — An (To) ist leer.'), { status: 400 });
  }

  if (params.saveAsTicketOverride) {
    const key = stageKey(params.stage);
    const override = {
      ...(hw.stage_recipients_override || {}),
      [key]: { to: resolved.to, cc: resolved.cc },
    };
    hw = await upsertHardwareReturn({
      ticketId: params.ticketId,
      organizationId: params.organizationId,
      input: { stage_recipients_override: override },
      mail1Days: config.mail1_days_after_delivery,
    });
  }

  const vars = buildReminderTemplateVars({ ticket: ctx, hardwareReturn: hw, orgConfig: config });
  const template = config.templates[stageKey(params.stage)];
  const { subject, html } = buildReminderHtmlEmail({
    subject: template.subject,
    bodyTextOrHtml: template.body,
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
    ticketId: params.ticketId,
    stage: params.stage,
    recipients: { to: resolved.to, cc: resolved.cc },
  });
  await appendHardwareReminderTimeline({
    ticketId: params.ticketId,
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
  const hw = await getHardwareReturnByTicketId(params.ticketId);
  if (!hw || hw.organization_id !== params.organizationId) {
    throw Object.assign(new Error('Rücklieferung nicht gefunden.'), { status: 404 });
  }
  const org = await getOrganization(params.organizationId);
  if (!org?.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 404 });
  }
  const returnedAt = params.returnedAt
    ? new Date(params.returnedAt).toISOString()
    : new Date().toISOString();
  const updated = await upsertHardwareReturn({
    ticketId: params.ticketId,
    organizationId: params.organizationId,
    input: { returned: true, returned_at: returnedAt },
    mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
  });
  const now = new Date().toISOString();
  const note = params.note ? `<p>${String(params.note).slice(0, 2000)}</p>` : '';
  await addDocDirect(`tickets/${params.ticketId}/messages`, {
    ticketId: params.ticketId,
    senderId: 'system',
    senderType: 'agent',
    senderName: params.actorName || 'Hubcom ServiceDesk',
    content: `<p><strong>Hardware-Rücklieferung erfolgt</strong> (${new Date(returnedAt).toLocaleString('de-DE')})</p>${note}`,
    is_internal: false,
    isInternal: false,
    createdAt: now,
    updatedAt: now,
  });
  await updateDocDirect('tickets', params.ticketId, { updatedAt: now });
  return updated;
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
  // Re-use get path mapping by round-tripping through SELECT * shape
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    ticket_id: String(row.ticket_id),
    external_ref_id: row.external_ref_id || null,
    service_level: row.service_level == null ? null : (Number(row.service_level) as 1 | 2 | 3),
    time_sl1_minutes: Number(row.time_sl1_minutes) || 0,
    time_sl2_minutes: Number(row.time_sl2_minutes) || 0,
    time_sl3_minutes: Number(row.time_sl3_minutes) || 0,
    exported: row.exported === true || row.exported === 't',
    exported_at: row.exported_at ? new Date(row.exported_at).toISOString() : null,
    request_type: row.request_type || null,
    device_details: row.device_details || null,
    employee_phone: row.employee_phone || null,
    employee_mobile: row.employee_mobile || null,
    project_manager_name: row.project_manager_name || null,
    project_manager_email: row.project_manager_email || null,
    manager_name: row.manager_name || null,
    manager_email: row.manager_email || null,
    ceo_email_override: row.ceo_email_override || null,
    stage_recipients_override:
      typeof row.stage_recipients_override === 'string'
        ? JSON.parse(row.stage_recipients_override || 'null')
        : row.stage_recipients_override || null,
    solution_summary: row.solution_summary || null,
    shipping_method: row.shipping_method || null,
    shipping_reference: row.shipping_reference || null,
    return_required: row.return_required === true || row.return_required === 't',
    delivery_date: row.delivery_date ? String(row.delivery_date).slice(0, 10) : null,
    return_due_date: row.return_due_date ? String(row.return_due_date).slice(0, 10) : null,
    auto_reminder_enabled: row.auto_reminder_enabled !== false && row.auto_reminder_enabled !== 'f',
    mail1_sent_at: row.mail1_sent_at ? new Date(row.mail1_sent_at).toISOString() : null,
    mail1_sent_recipients:
      typeof row.mail1_sent_recipients === 'string'
        ? JSON.parse(row.mail1_sent_recipients || 'null')
        : row.mail1_sent_recipients || null,
    mail2_sent_at: row.mail2_sent_at ? new Date(row.mail2_sent_at).toISOString() : null,
    mail2_sent_recipients:
      typeof row.mail2_sent_recipients === 'string'
        ? JSON.parse(row.mail2_sent_recipients || 'null')
        : row.mail2_sent_recipients || null,
    mail3_sent_at: row.mail3_sent_at ? new Date(row.mail3_sent_at).toISOString() : null,
    mail3_sent_recipients:
      typeof row.mail3_sent_recipients === 'string'
        ? JSON.parse(row.mail3_sent_recipients || 'null')
        : row.mail3_sent_recipients || null,
    returned: row.returned === true || row.returned === 't',
    returned_at: row.returned_at ? new Date(row.returned_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
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
    const ctx = ticketContext(ticket);
    const days = overdueDays(hw, config, now);
    const mailStatus = deriveMailStatus(hw, config, ctx);
    const stage1 = resolveStageRecipients(1, ctx, hw, config);
    const nextDue = evaluateDueReminderStage(hw, { ...config, auto_send_enabled: true }, now);
    items.push({
      hardwareReturn: hw,
      ticket: {
        id: hw.ticket_id,
        subject: ticket ? String(ticket.subject || '') || null : null,
        customerName: (ctx.customerName || ctx.customer_name || null) as string | null,
        customerEmail: (ctx.customerEmail || ctx.customer_email || null) as string | null,
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
        hw.ticket_id,
        hw.external_ref_id,
        it.ticket.customerName,
        it.ticket.customerEmail,
        hw.project_manager_name,
        hw.project_manager_email,
        hw.manager_name,
        hw.manager_email,
        hw.device_details,
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
      return String(a.ticket.customerName || '').localeCompare(
        String(b.ticket.customerName || ''),
        'de',
      );
    }
    if (sort === 'ticket') {
      return a.hardwareReturn.ticket_id.localeCompare(b.hardwareReturn.ticket_id);
    }
    const ad = a.hardwareReturn.return_due_date || a.hardwareReturn.delivery_date || '';
    const bd = b.hardwareReturn.return_due_date || b.hardwareReturn.delivery_date || '';
    return ad.localeCompare(bd);
  });

  const total = filtered.length;
  const offset = Math.max(0, filters.offset || 0);
  const limit = Math.min(500, Math.max(1, filters.limit || 100));
  const page = filtered.slice(offset, offset + limit);

  const openItems = items.filter((i) => !i.hardwareReturn.returned && i.hardwareReturn.return_required);
  const kpis: HardwareReturnsKpis = {
    open: openItems.length,
    overdue: openItems.filter((i) => i.overdueDays > 0).length,
    nextMailDue: openItems.filter((i) => i.nextDueStage != null).length,
    stage3: openItems.filter((i) => i.hardwareReturn.mail3_sent_at).length,
    returnedLast30: items.filter((i) => {
      if (!i.hardwareReturn.returned_at) return false;
      const t = new Date(i.hardwareReturn.returned_at).getTime();
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
      ? items.filter((i) => ids.includes(i.hardwareReturn.ticket_id))
      : items;
    const header = [
      'ticket_id',
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
          hw.ticket_id,
          hw.external_ref_id || '',
          it.ticket.customerName || '',
          it.ticket.customerEmail || '',
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
    const hw = await getHardwareReturnByTicketId(ticketId);
    if (!hw || hw.organization_id !== params.organizationId) continue;
    if (params.action === 'mark_returned') {
      await markHardwareReturned({
        ticketId,
        organizationId: params.organizationId,
        actorName: params.actorName,
      });
      updated += 1;
    } else if (params.action === 'mark_exported') {
      await upsertHardwareReturn({
        ticketId,
        organizationId: params.organizationId,
        input: { exported: true },
      });
      updated += 1;
    }
  }
  return { updated };
}

/** Import PowerApps-style CSV without triggering auto-emails (no mail stamps unless provided). */
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

  const iId = idx(['id', 'external_ref', 'legacy', 'ticket']);
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
      // Find or create a lightweight ticket document for the import row.
      let ticketId = '';
      if (externalId) {
        const found = await queryDb(
          `SELECT ticket_id FROM ticket_hardware_returns
           WHERE organization_id = $1 AND external_ref_id = $2 LIMIT 1`,
          [params.organizationId, externalId],
        );
        if (found.rowCount) ticketId = String(found.rows[0].ticket_id);
      }
      if (!ticketId) {
        const now = new Date().toISOString();
        const created = await addDocDirect('tickets', {
          subject: `Hardware-Rücklieferung Import ${externalId || empName || email}`,
          description: 'Importiert aus PowerApps CSV (ohne Auto-Mails).',
          status: 'open',
          priority: 'medium',
          customerName: empName || null,
          customerEmail: email || null,
          organizationId: params.organizationId,
          organization_id: params.organizationId,
          company: org.name,
          createdAt: now,
          updatedAt: now,
          creatorId: params.actorId || 'import',
        });
        ticketId = String(created.id);
      }

      const returnedRaw = iReturnWhen >= 0 ? cols[iReturnWhen] : '';
      const returned = Boolean(returnedRaw && !/^nein|no|0|false$/i.test(returnedRaw));
      await upsertHardwareReturn({
        ticketId,
        organizationId: params.organizationId,
        input: {
          external_ref_id: externalId || null,
          device_details: iDevice >= 0 ? cols[iDevice] || null : null,
          project_manager_email: iPm >= 0 ? cols[iPm] || null : null,
          manager_email: iChef >= 0 ? cols[iChef] || null : null,
          return_required: true,
          returned,
          returned_at: returned ? new Date().toISOString() : null,
          auto_reminder_enabled: false, // never retroactively trigger
          mail1_sent_at: iMail1 >= 0 && cols[iMail1] ? new Date(cols[iMail1]).toISOString() : null,
          mail2_sent_at: iMail2 >= 0 && cols[iMail2] ? new Date(cols[iMail2]).toISOString() : null,
          mail3_sent_at: iMail3 >= 0 && cols[iMail3] ? new Date(cols[iMail3]).toISOString() : null,
        },
        mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
      });
      // Stamp mail columns that upsert may not write:
      if (iMail1 >= 0 && cols[iMail1]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail1_sent_at = $2::timestamptz, auto_reminder_enabled = FALSE
           WHERE ticket_id = $1`,
          [ticketId, new Date(cols[iMail1]).toISOString()],
        );
      }
      if (iMail2 >= 0 && cols[iMail2]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail2_sent_at = $2::timestamptz WHERE ticket_id = $1`,
          [ticketId, new Date(cols[iMail2]).toISOString()],
        );
      }
      if (iMail3 >= 0 && cols[iMail3]) {
        await queryDb(
          `UPDATE ticket_hardware_returns SET mail3_sent_at = $2::timestamptz WHERE ticket_id = $1`,
          [ticketId, new Date(cols[iMail3]).toISOString()],
        );
      }
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
      const ctx = ticketContext(ticket);
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
          ticketId: hw.ticket_id,
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
