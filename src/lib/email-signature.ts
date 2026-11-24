/**
 * Multi-tenant email signature rendering for outbound Graph / SMTP replies.
 * Signatures are appended only at send time — never into ticket history.
 */

import { escapeHtmlText } from './email-plain-html.js';

export const SIGNATURE_LOGO_CID = 'signature-logo';
export const SIGNATURE_LOGO_MAX_BYTES = 256 * 1024;
export const SIGNATURE_LOGO_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface SignatureAgentContext {
  name?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface SignatureTicketContext {
  number?: string | null;
  id?: string | null;
}

export interface SignatureOrganizationContext {
  name?: string | null;
}

export interface SignatureChannelFields {
  signature_enabled?: boolean | null;
  signatureEnabled?: boolean | null;
  signature_html?: string | null;
  signatureHtml?: string | null;
  signature_logo_data?: string | null;
  signatureLogoData?: string | null;
  signature_logo_mime?: string | null;
  signatureLogoMime?: string | null;
}

export interface GraphInlineAttachment {
  '@odata.type': '#microsoft.graph.fileAttachment';
  name: string;
  contentType: string;
  contentBytes: string;
  contentId: string;
  isInline: true;
}

/** Default Hubcom GmbH starter template (placeholders for live preview / new channels). */
export const DEFAULT_HUBCOM_SIGNATURE_HTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:Calibri,Arial,sans-serif;font-size:13px;color:#1f2937;line-height:1.45;border-collapse:collapse;">
  <tr>
    <td style="padding-right:14px;vertical-align:top;">
      {{channel.logo}}
    </td>
    <td style="vertical-align:top;border-left:2px solid #1B6CA8;padding-left:14px;">
      <div style="font-weight:700;font-size:14px;color:#0f172a;">{{agent.name}}</div>
      {{agent.title_block}}
      {{agent.phone_block}}
      <div><a href="mailto:{{agent.email}}" style="color:#1B6CA8;text-decoration:none;">{{agent.email}}</a></div>
      <div style="margin-top:8px;font-size:12px;color:#64748b;">{{organization.name}}</div>
      <div style="font-size:11px;color:#94a3b8;">Ticket {{ticket.number}}</div>
    </td>
  </tr>
</table>`;

export function isSignatureEnabled(channel: SignatureChannelFields | null | undefined): boolean {
  if (!channel) return false;
  if (channel.signature_enabled === false || channel.signatureEnabled === false) return false;
  if (channel.signature_enabled === true || channel.signatureEnabled === true) return true;
  // Implicitly enabled when a template or logo is already configured.
  const html = String(channel.signature_html || channel.signatureHtml || '').trim();
  const logo = String(channel.signature_logo_data || channel.signatureLogoData || '').trim();
  return Boolean(html || logo);
}

export function getSignatureHtmlTemplate(channel: SignatureChannelFields | null | undefined): string {
  const html = String(channel?.signature_html || channel?.signatureHtml || '').trim();
  return html || DEFAULT_HUBCOM_SIGNATURE_HTML;
}

export function parseAndValidateSignatureLogoDataUrl(raw: unknown): {
  ok: true;
  dataUrl: string;
  mime: string;
  base64: string;
  bytes: number;
} | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Logo payload is empty.' };

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) {
    return { ok: false, error: 'Logo must be a data URL (image/png, image/jpeg, or image/webp).' };
  }
  const mime = match[1].toLowerCase();
  if (mime === 'image/svg+xml' || mime.includes('svg')) {
    return { ok: false, error: 'SVG logos are not allowed.' };
  }
  if (!SIGNATURE_LOGO_ALLOWED_MIME.has(mime)) {
    return { ok: false, error: 'Only PNG, JPEG, and WebP logos are allowed.' };
  }
  const b64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > SIGNATURE_LOGO_MAX_BYTES) {
    return { ok: false, error: 'Signature logo must be 256 KB or smaller.' };
  }
  return {
    ok: true,
    dataUrl: `data:${mime};base64,${b64}`,
    mime,
    base64: b64,
    bytes,
  };
}

function normalizeLogoBase64(
  channel: SignatureChannelFields | null | undefined,
): { base64: string; mime: string } | null {
  const mime = String(
    channel?.signature_logo_mime || channel?.signatureLogoMime || 'image/png',
  )
    .trim()
    .toLowerCase() || 'image/png';
  if (!SIGNATURE_LOGO_ALLOWED_MIME.has(mime)) return null;

  const raw = String(channel?.signature_logo_data || channel?.signatureLogoData || '').trim();
  if (!raw) return null;

  if (raw.startsWith('data:')) {
    const parsed = parseAndValidateSignatureLogoDataUrl(raw);
    if (parsed.ok === false) return null;
    return { base64: parsed.base64, mime: parsed.mime };
  }
  // Already raw base64
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return null;
  const base64 = raw.replace(/\s+/g, '');
  const bytes = Math.floor((base64.length * 3) / 4);
  if (bytes <= 0 || bytes > SIGNATURE_LOGO_MAX_BYTES) return null;
  return { base64, mime };
}

function ticketNumber(ticket: SignatureTicketContext | null | undefined): string {
  const n = String(ticket?.number || '').trim();
  if (n) return n;
  const id = String(ticket?.id || '').trim();
  if (!id) return '';
  return id.length > 8 ? id.slice(-8).toUpperCase() : id.toUpperCase();
}

/**
 * Collapse empty optional blocks (title/phone) so blank profile fields
 * do not leave awkward empty lines in the signature.
 */
function replaceOptionalBlocks(template: string, agent: SignatureAgentContext): string {
  const title = String(agent.title || '').trim();
  const phone = String(agent.phone || '').trim();
  let out = template;
  out = out.replace(
    /\{\{\s*agent\.title_block\s*\}\}/gi,
    title
      ? `<div style="color:#475569;">${escapeHtmlText(title)}</div>`
      : '',
  );
  out = out.replace(
    /\{\{\s*agent\.phone_block\s*\}\}/gi,
    phone
      ? `<div style="color:#475569;">${escapeHtmlText(phone)}</div>`
      : '',
  );
  // Bare {{agent.title}} / {{agent.phone}} — remove containing line when empty.
  if (!title) {
    out = out.replace(/^[^\n]*\{\{\s*agent\.title\s*\}\}[^\n]*(?:\n|$)/gim, '');
    out = out.replace(/<[^>]*>\s*\{\{\s*agent\.title\s*\}\}\s*<\/[^>]*>/gi, '');
  }
  if (!phone) {
    out = out.replace(/^[^\n]*\{\{\s*agent\.phone\s*\}\}[^\n]*(?:\n|$)/gim, '');
    out = out.replace(/<[^>]*>\s*\{\{\s*agent\.phone\s*\}\}\s*<\/[^>]*>/gi, '');
  }
  return out;
}

function logoPlaceholderHtml(hasLogo: boolean, forPreview: boolean): string {
  if (!hasLogo) return '';
  if (forPreview) {
    // Preview uses data URL injected by caller via {{channel.logo_src}}
    return `<img src="{{channel.logo_src}}" alt="" width="72" height="72" style="display:block;max-width:72px;max-height:72px;border:0;" />`;
  }
  return `<img src="cid:${SIGNATURE_LOGO_CID}" alt="" width="72" height="72" style="display:block;max-width:72px;max-height:72px;border:0;" />`;
}

export function renderSignatureHtml(params: {
  channel: SignatureChannelFields | null | undefined;
  agent: SignatureAgentContext;
  ticket?: SignatureTicketContext | null;
  organization?: SignatureOrganizationContext | null;
  /** When true, use data-URL logo for UI preview instead of cid:. */
  forPreview?: boolean;
}): string {
  const { channel, agent, ticket, organization, forPreview } = params;
  if (!isSignatureEnabled(channel) && !String(channel?.signature_html || channel?.signatureHtml || '').trim()) {
    // Still allow preview of default template in admin even before "enabled".
  }

  const logo = normalizeLogoBase64(channel);
  let template = getSignatureHtmlTemplate(channel);
  template = replaceOptionalBlocks(template, agent);

  const replacements: Record<string, string> = {
    'agent.name': escapeHtmlText(String(agent.name || '').trim()),
    'agent.title': escapeHtmlText(String(agent.title || '').trim()),
    'agent.phone': escapeHtmlText(String(agent.phone || '').trim()),
    'agent.email': escapeHtmlText(String(agent.email || '').trim()),
    'ticket.number': escapeHtmlText(ticketNumber(ticket)),
    'organization.name': escapeHtmlText(String(organization?.name || '').trim()),
    'channel.logo': logoPlaceholderHtml(Boolean(logo), Boolean(forPreview)),
  };

  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${key.replace('.', '\\.')}\\s*\\}\\}`, 'gi'), value);
  }

  if (forPreview && logo) {
    const dataUrl = `data:${logo.mime};base64,${logo.base64}`;
    out = out.replace(/\{\{\s*channel\.logo_src\s*\}\}/gi, dataUrl);
    // Also rewrite cid: to data URL for live preview.
    out = out.replace(
      new RegExp(`cid:${SIGNATURE_LOGO_CID}`, 'gi'),
      dataUrl,
    );
  } else {
    out = out.replace(/\{\{\s*channel\.logo_src\s*\}\}/gi, '');
  }

  // Drop leftover empty placeholder tokens.
  out = out.replace(/\{\{\s*[a-z0-9_.]+\s*\}\}/gi, '');
  // Collapse excess blank lines from removed optional fields.
  out = out.replace(/(?:\r?\n){3,}/g, '\n\n').trim();

  // Strip obvious XSS vectors without cheerio (safe for browser preview + Node).
  return out
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function buildSignatureInlineAttachment(
  channel: SignatureChannelFields | null | undefined,
): GraphInlineAttachment | null {
  const logo = normalizeLogoBase64(channel);
  if (!logo) return null;
  const ext =
    logo.mime === 'image/jpeg' ? 'jpg' : logo.mime === 'image/webp' ? 'webp' : 'png';
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: `signature-logo.${ext}`,
    contentType: logo.mime,
    contentBytes: logo.base64,
    contentId: SIGNATURE_LOGO_CID,
    isInline: true,
  };
}

