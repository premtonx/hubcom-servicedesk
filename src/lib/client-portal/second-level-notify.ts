/**
 * Per-org 2nd-Level-Support notification settings + Outlook-safe HTML email.
 * Pure helpers are safe for unit tests (no I/O except optional send helpers).
 */

import { trySendTransactionalEmail } from '../outbound-mail.js';
import { safeLog } from '../safe-log.js';
import type { OrganizationRecord } from './organizations.js';
import { resolvePortalTitle } from './org-branding.js';

const OUTER_BG = '#f4f6f9';
const BRAND_BLUE = '#2563eb';
const BRAND_INDIGO = '#4f46e5';

export const SECOND_LEVEL_QUEUE = 'second_level' as const;
export const FIRST_LEVEL_QUEUE = 'first_level' as const;

export type TicketSupportLevel = typeof FIRST_LEVEL_QUEUE | typeof SECOND_LEVEL_QUEUE;

export type SecondLevelNotifySettings = {
  second_level_notify_enabled: boolean;
  second_level_support_emails: string[];
  /** Display label, default "2nd-Level-Support". */
  second_level_label: string;
};

export type SecondLevelAssignmentEmailParams = {
  portalTitle: string;
  label: string;
  ticketNumber: string;
  subject: string;
  priority: string;
  priorityKey?: string | null;
  status: string;
  category: string;
  requesterName: string;
  requesterEmail: string;
  assignedByName: string;
  assignedAt: Date | string;
  messageSnippet: string;
  ticketUrl: string;
};

export type TicketActivityEntry = {
  id: string;
  kind: string;
  at: string;
  label: string;
  actor?: string | null;
  meta?: Record<string, unknown>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseSecondLevelEmails(
  input: string | string[] | null | undefined,
): string[] {
  const raw = Array.isArray(input)
    ? input.join(',')
    : input == null
      ? ''
      : String(input);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function normalizeSecondLevelNotifySettings(
  raw: Partial<SecondLevelNotifySettings> | Record<string, unknown> | null | undefined,
): SecondLevelNotifySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const emails = parseSecondLevelEmails(
    (src.second_level_support_emails as string | string[] | undefined) ??
      (src.secondLevelSupportEmails as string | string[] | undefined) ??
      '',
  );
  const labelRaw =
    src.second_level_label ?? src.secondLevelLabel ?? '2nd-Level-Support';
  const label = String(labelRaw || '2nd-Level-Support').trim() || '2nd-Level-Support';
  const enabled =
    src.second_level_notify_enabled === true ||
    src.secondLevelNotifyEnabled === true;
  return {
    second_level_notify_enabled: enabled,
    second_level_support_emails: emails,
    second_level_label: label.slice(0, 80),
  };
}

/** Read settings from organizations.settings (defaults: disabled). */
export function resolveSecondLevelNotifySettings(
  org: OrganizationRecord | null | undefined,
): SecondLevelNotifySettings {
  const settings = (org?.settings && typeof org.settings === 'object'
    ? org.settings
    : {}) as Record<string, unknown>;
  return normalizeSecondLevelNotifySettings(settings);
}

export function normalizeTicketSupportLevel(
  raw: unknown,
): TicketSupportLevel | null {
  if (raw == null || raw === '') return null;
  const v = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (
    v === 'second_level' ||
    v === 'secondlevel' ||
    v === '2nd_level' ||
    v === '2ndlevel' ||
    v === 'l2'
  ) {
    return SECOND_LEVEL_QUEUE;
  }
  if (
    v === 'first_level' ||
    v === 'firstlevel' ||
    v === '1st_level' ||
    v === 'standard' ||
    v === 'l1'
  ) {
    return FIRST_LEVEL_QUEUE;
  }
  return null;
}

/** Resolve support level from ticket document fields. */
export function ticketSupportLevel(
  ticket: Record<string, unknown> | null | undefined,
): TicketSupportLevel | null {
  if (!ticket) return null;
  return (
    normalizeTicketSupportLevel(ticket.support_level) ||
    normalizeTicketSupportLevel(ticket.supportLevel) ||
    normalizeTicketSupportLevel(ticket.assigned_queue) ||
    normalizeTicketSupportLevel(ticket.assignedQueue) ||
    null
  );
}

export function isSecondLevelTicket(
  ticket: Record<string, unknown> | null | undefined,
): boolean {
  return ticketSupportLevel(ticket) === SECOND_LEVEL_QUEUE;
}

/**
 * True only when transitioning into second_level (not when already there).
 */
export function didTransitionIntoSecondLevel(params: {
  previous: Record<string, unknown> | null | undefined;
  next: Record<string, unknown> | null | undefined;
}): boolean {
  const was = isSecondLevelTicket(params.previous);
  const now = isSecondLevelTicket(params.next);
  return !was && now;
}

export function buildSupportLevelPatch(
  level: TicketSupportLevel | null,
): Record<string, unknown> {
  if (level === SECOND_LEVEL_QUEUE) {
    return {
      support_level: SECOND_LEVEL_QUEUE,
      supportLevel: SECOND_LEVEL_QUEUE,
      assigned_queue: SECOND_LEVEL_QUEUE,
      assignedQueue: SECOND_LEVEL_QUEUE,
      escalated: true,
      isEscalated: true,
    };
  }
  if (level === FIRST_LEVEL_QUEUE) {
    return {
      support_level: FIRST_LEVEL_QUEUE,
      supportLevel: FIRST_LEVEL_QUEUE,
      assigned_queue: FIRST_LEVEL_QUEUE,
      assignedQueue: FIRST_LEVEL_QUEUE,
      escalated: false,
      isEscalated: false,
    };
  }
  return {
    support_level: null,
    supportLevel: null,
    assigned_queue: null,
    assignedQueue: null,
  };
}

/** Format timestamp in Europe/Berlin as DD.MM.YYYY, HH:mm Uhr */
export function formatBerlinDateTime(input: Date | string): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // de-DE → "26.11.2026, 17:05"
  const parts = fmt.format(d);
  return `${parts} Uhr`;
}

function priorityPill(priorityKey: string | null | undefined, label: string): string {
  const key = String(priorityKey || label || '')
    .trim()
    .toLowerCase();
  let bg = '#e2e8f0';
  let fg = '#334155';
  if (key === 'urgent' || key === 'dringend') {
    bg = '#fee2e2';
    fg = '#b91c1c';
  } else if (key === 'high' || key === 'hoch') {
    bg = '#ffedd5';
    fg = '#c2410c';
  } else if (key === 'medium' || key === 'mittel' || key === 'normal') {
    bg = '#dbeafe';
    fg = '#1d4ed8';
  } else if (key === 'low' || key === 'niedrig') {
    bg = '#f1f5f9';
    fg = '#475569';
  }
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${bg};color:${fg};">${escapeHtml(label)}</span>`;
}

function truncateSnippet(text: string, max = 600): string {
  const cleaned = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

export function buildSecondLevelAssignmentEmail(
  params: SecondLevelAssignmentEmailParams,
): { subject: string; html: string } {
  const label = String(params.label || '2nd-Level-Support').trim() || '2nd-Level-Support';
  const ticketNumber = String(params.ticketNumber || '').trim() || '—';
  const subjectLine = String(params.subject || '').trim() || '(kein Betreff)';
  const subject = `[${label}] Ticket #${ticketNumber.replace(/^#/, '')}: ${subjectLine}`;

  const portalTitle = escapeHtml(params.portalTitle || 'ServiceDesk');
  const labelEsc = escapeHtml(label);
  const ticketNr = escapeHtml(ticketNumber.startsWith('#') ? ticketNumber : `#${ticketNumber}`);
  const betriff = escapeHtml(subjectLine);
  const status = escapeHtml(params.status || '—');
  const category = escapeHtml(params.category || '—');
  const requesterName = escapeHtml(params.requesterName || '—');
  const requesterEmail = escapeHtml(params.requesterEmail || '');
  const assignedBy = escapeHtml(params.assignedByName || '—');
  const when = escapeHtml(formatBerlinDateTime(params.assignedAt));
  const snippet = escapeHtml(truncateSnippet(params.messageSnippet));
  const ctaUrl = escapeHtml(params.ticketUrl);
  const priorityHtml = priorityPill(params.priorityKey, params.priority || 'Mittel');

  const requesterLine = requesterEmail
    ? `${requesterName} (${requesterEmail})`
    : requesterName;

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${OUTER_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER_BG};padding:28px 14px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:26px 28px 18px 28px;border-bottom:1px solid #eef2f7;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin:0;font-size:18px;font-weight:800;color:#0f172a;line-height:1.3;">${portalTitle}</p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:800;letter-spacing:0.02em;background:#eef2ff;color:${BRAND_INDIGO};border:1px solid #c7d2fe;">${labelEsc} Zuweisung</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#334155;">
                Ein Ticket wurde an <strong style="color:#0f172a;">${labelEsc}</strong> zugewiesen.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;width:38%;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Ticket-Nr.</td>
                  <td style="padding:10px 14px;font-size:14px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0;">${ticketNr}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Betreff</td>
                  <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${betriff}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Priorität</td>
                  <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;">${priorityHtml}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Status &amp; Kategorie</td>
                  <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${status} · ${category}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Ersteller / Mitarbeiter</td>
                  <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${requesterLine}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;border-bottom:1px solid #e2e8f0;">Zugewiesen von</td>
                  <td style="padding:10px 14px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${assignedBy}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;font-size:12px;font-weight:700;color:#64748b;">Datum &amp; Uhrzeit</td>
                  <td style="padding:10px 14px;font-size:14px;color:#0f172a;">${when}</td>
                </tr>
              </table>

              <p style="margin:20px 0 8px 0;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">Nachricht / Auszug</p>
              <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;background:#f8fafc;font-size:14px;line-height:1.55;color:#334155;">
                ${snippet || '—'}
              </div>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 12px 0;">
                <tr>
                  <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:10px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;background:${BRAND_BLUE};">
                      Ticket im Portal öffnen →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all;">
                <a href="${ctaUrl}" style="color:${BRAND_BLUE};text-decoration:underline;">${ctaUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px 28px;border-top:1px solid #eef2f7;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">Automatische Benachrichtigung · ${portalTitle}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

export function buildAppBaseUrl(): string {
  return (
    (process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.BASE_URL || '')
      .replace(/\/$/, '') || ''
  );
}

export function buildPortalTicketUrl(ticketId: string): string {
  const base = buildAppBaseUrl();
  const path = `/portal/tickets/${encodeURIComponent(ticketId)}`;
  return base ? `${base}${path}` : path;
}

export function priorityLabelDe(priority: string | null | undefined): string {
  const key = String(priority || '').trim().toLowerCase();
  if (key === 'urgent') return 'Dringend';
  if (key === 'high') return 'Hoch';
  if (key === 'low') return 'Niedrig';
  if (key === 'medium' || key === 'normal') return 'Mittel';
  return priority ? String(priority) : 'Mittel';
}

export function statusLabelDe(status: string | null | undefined): string {
  const key = String(status || '').trim().toLowerCase();
  const map: Record<string, string> = {
    open: 'Offen',
    pending: 'Wartend',
    in_progress: 'In Bearbeitung',
    resolved: 'Gelöst',
    closed: 'Geschlossen',
    waiting_customer: 'Wartet auf Kunde',
    on_hold: 'Pausiert',
    paused: 'Pausiert',
  };
  return map[key] || (status ? String(status) : '—');
}

export function readTicketActivityLog(
  ticket: Record<string, unknown> | null | undefined,
): TicketActivityEntry[] {
  const raw =
    ticket?.activityLog ?? ticket?.activity_log ?? ticket?.ticketActivity ?? null;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e === 'object')
    .map((e: any) => ({
      id: String(e.id || `act-${Math.random().toString(36).slice(2, 8)}`),
      kind: String(e.kind || 'note'),
      at: String(e.at || e.createdAt || new Date().toISOString()),
      label: String(e.label || e.message || ''),
      actor: e.actor != null ? String(e.actor) : null,
      meta: e.meta && typeof e.meta === 'object' ? e.meta : undefined,
    }));
}

export function appendSecondLevelNotifyActivity(params: {
  ticket: Record<string, unknown>;
  emails: string[];
  assignedByName: string;
  label?: string;
}): { activityLog: TicketActivityEntry[]; entry: TicketActivityEntry } {
  const existing = readTicketActivityLog(params.ticket);
  const emails = params.emails.join(', ');
  const label = params.label || '2nd-Level-Support';
  const entry: TicketActivityEntry = {
    id: `sl-notify-${Date.now()}`,
    kind: 'second_level_notify',
    at: new Date().toISOString(),
    label: `${label} benachrichtigt an ${emails}`,
    actor: params.assignedByName || null,
    meta: { emails: params.emails },
  };
  return { activityLog: [...existing, entry], entry };
}

/**
 * Decide whether a notify should fire for this transition + org settings.
 * Pure — no I/O.
 */
export function evaluateSecondLevelNotifyTrigger(params: {
  previousTicket: Record<string, unknown> | null | undefined;
  nextTicket: Record<string, unknown> | null | undefined;
  settings: SecondLevelNotifySettings;
}):
  | { shouldSend: false; reason: string }
  | { shouldSend: true; emails: string[]; label: string } {
  if (!params.settings.second_level_notify_enabled) {
    return { shouldSend: false, reason: 'notify_disabled' };
  }
  if (!params.settings.second_level_support_emails.length) {
    return { shouldSend: false, reason: 'no_recipients' };
  }
  if (
    !didTransitionIntoSecondLevel({
      previous: params.previousTicket,
      next: params.nextTicket,
    })
  ) {
    return { shouldSend: false, reason: 'no_transition_into_second_level' };
  }
  return {
    shouldSend: true,
    emails: params.settings.second_level_support_emails,
    label: params.settings.second_level_label,
  };
}

export async function sendSecondLevelAssignmentNotification(params: {
  organization: OrganizationRecord;
  ticket: Record<string, unknown>;
  assignedByName: string;
  settings?: SecondLevelNotifySettings;
}): Promise<{
  sent: boolean;
  reason?: string;
  emails: string[];
  activityEntry?: TicketActivityEntry;
  activityLog?: TicketActivityEntry[];
}> {
  const settings =
    params.settings || resolveSecondLevelNotifySettings(params.organization);
  // Caller already decided to send — still validate recipients.
  const emails = settings.second_level_support_emails;
  if (!emails.length) {
    return { sent: false, reason: 'no_recipients', emails: [] };
  }

  const ticket = params.ticket;
  const ticketId = String(ticket.id || '');
  const ticketNumber =
    String(ticket.customId || ticket.custom_id || ticket.ticketNumber || ticketId || '')
      .trim() || ticketId;
  const portalTitle = resolvePortalTitle(
    params.organization.name,
    params.organization.portal_title,
  );
  const snippet = String(
    ticket.description || ticket.html_content || ticket.lastMessagePreview || '',
  );
  const email = buildSecondLevelAssignmentEmail({
    portalTitle,
    label: settings.second_level_label,
    ticketNumber,
    subject: String(ticket.subject || ''),
    priority: priorityLabelDe(String(ticket.priority || 'medium')),
    priorityKey: String(ticket.priority || 'medium'),
    status: statusLabelDe(String(ticket.status || 'open')),
    category: String(ticket.categoryName || ticket.category || '—'),
    requesterName: String(
      ticket.customerName || ticket.requesterName || ticket.creatorName || '—',
    ),
    requesterEmail: String(ticket.customerEmail || ticket.requesterEmail || ''),
    assignedByName: params.assignedByName,
    assignedAt: new Date(),
    messageSnippet: snippet,
    ticketUrl: buildPortalTicketUrl(ticketId),
  });

  try {
    const result = await trySendTransactionalEmail({
      to: emails,
      subject: email.subject,
      body: email.html,
      organizationId: params.organization.id,
      contentType: 'HTML',
    });
    const { activityLog, entry } = appendSecondLevelNotifyActivity({
      ticket,
      emails,
      assignedByName: params.assignedByName,
      label: settings.second_level_label,
    });
    if (!result.delivered) {
      safeLog(
        'warn',
        '[second-level-notify] mail not delivered',
        result.reason || result.via,
      );
    }
    return {
      sent: result.delivered === true,
      reason: result.reason,
      emails,
      activityEntry: entry,
      activityLog,
    };
  } catch (err: any) {
    safeLog('error', '[second-level-notify] send failed', err?.message || err);
    const { activityLog, entry } = appendSecondLevelNotifyActivity({
      ticket,
      emails,
      assignedByName: params.assignedByName,
      label: settings.second_level_label,
    });
    return {
      sent: false,
      reason: err?.message || 'send_failed',
      emails,
      activityEntry: entry,
      activityLog,
    };
  }
}
