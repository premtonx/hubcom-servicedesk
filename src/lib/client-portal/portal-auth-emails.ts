/**
 * Branded HTML templates for portal invitation + password-reset emails.
 * Outlook / M365–safe table layout; send with contentType: 'HTML' (no <pre>).
 */

import { clientPortalRoleLabelDe } from './portal-role-from-session.js';
import type { ClientPortalRole } from './roles.js';

const BRAND_BLUE = '#2563eb';
const OUTER_BG = '#f4f6f9';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function brandedEmailCard(params: {
  title: string;
  greeting: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}): string {
  const title = escapeHtml(params.title);
  const greeting = escapeHtml(params.greeting);
  const ctaLabel = escapeHtml(params.ctaLabel);
  const ctaUrl = escapeHtml(params.ctaUrl);
  const footer = escapeHtml(params.footer);
  const bodyParagraphs = params.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#334155;">${escapeHtml(p)}</p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${OUTER_BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:28px 32px 12px 32px;border-bottom:1px solid #eef2f7;">
              <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_BLUE};">Hubcom ServiceDesk</p>
              <h1 style="margin:10px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#0f172a;font-weight:600;">${greeting}</p>
              ${bodyParagraphs}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 18px 0;">
                <tr>
                  <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:10px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;background:${BRAND_BLUE};">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">Falls der Button nicht funktioniert, öffnen Sie diesen Link:</p>
              <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">
                <a href="${ctaUrl}" style="color:${BRAND_BLUE};text-decoration:underline;">${ctaUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 28px 32px;border-top:1px solid #eef2f7;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type PortalInviteEmailParams = {
  recipientName: string;
  organizationName: string;
  role: ClientPortalRole | string;
  setupLink: string;
};

export type PortalResetEmailParams = {
  recipientName: string;
  organizationName: string;
  setupLink: string;
};

export function buildPortalInviteEmail(params: PortalInviteEmailParams): {
  subject: string;
  html: string;
  kind: 'invite';
} {
  const org = String(params.organizationName || 'Ihrer Organisation').trim() || 'Ihrer Organisation';
  const name = String(params.recipientName || '').trim() || 'dort';
  const roleLabel = clientPortalRoleLabelDe(params.role);
  const subject = `Willkommen im ${org} ServiceDesk — Konto aktivieren`;
  const html = brandedEmailCard({
    title: 'Konto aktivieren',
    greeting: `Hallo ${name},`,
    paragraphs: [
      `Sie wurden zum ServiceDesk-Portal von ${org} eingeladen.`,
      `Ihre Rolle: ${roleLabel}.`,
      'Bitte aktivieren Sie Ihr Konto und legen Sie ein Passwort fest. Der Link ist 48 Stunden gültig.',
    ],
    ctaLabel: 'Konto aktivieren & Passwort festlegen',
    ctaUrl: params.setupLink,
    footer:
      'Aus Sicherheitsgründen wird kein Passwort per E-Mail versendet. Der Link ist an Ihre E-Mail-Adresse gebunden.',
  });
  return { subject, html, kind: 'invite' };
}

export function buildPortalPasswordResetEmail(params: PortalResetEmailParams): {
  subject: string;
  html: string;
  kind: 'reset';
} {
  const org = String(params.organizationName || 'Ihrer Organisation').trim() || 'Ihrer Organisation';
  const name = String(params.recipientName || '').trim() || 'dort';
  const subject = `Passwort zurücksetzen — ${org} ServiceDesk`;
  const html = brandedEmailCard({
    title: 'Passwort zurücksetzen',
    greeting: `Hallo ${name},`,
    paragraphs: [
      `Für Ihr Konto im ServiceDesk-Portal von ${org} wurde ein Passwort-Reset angefordert.`,
      'Legen Sie über den Button unten ein neues Passwort fest. Der Link ist 48 Stunden gültig.',
    ],
    ctaLabel: 'Neues Passwort festlegen',
    ctaUrl: params.setupLink,
    footer:
      'Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren. Aus Sicherheitsgründen wird kein Passwort per E-Mail versendet.',
  });
  return { subject, html, kind: 'reset' };
}
