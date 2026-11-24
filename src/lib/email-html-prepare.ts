/**
 * Shared helpers for outbound Graph HTML, inbound mail cleanup, and ticket merge notes.
 * Pure string transforms (no DOM) so Node unit tests and browser code can share them.
 */

import { escapeHtmlText, plainTextToEmailHtml } from './email-plain-html.js';
import { sanitizeInboundHtml } from './email-ingestion/sanitize-server.js';

/** True when the payload already contains HTML tags (Quill / Outlook / inbound). */
export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''));
}

/**
 * Quill / email HTML typically contains structural tags — not a lone angle-bracket
 * word in plain prose. Used so `"use <script>"` still goes through the plain-text path.
 */
export function looksLikeDocumentHtml(value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return false;
  if (/^<(?:!doctype|html|body|div|p|span|br|ul|ol|li|table|h[1-6]|blockquote|strong|b|em|i|a|img)\b/i.test(v)) {
    return true;
  }
  return /<(?:p|div|br|ul|ol|li|table|tr|td|th|h[1-6]|blockquote|strong|b|em|a|img|span)\b/i.test(v);
}

/**
 * Unwrap Microsoft Outlook Safe Links / ATP wrapper URLs.
 * `https://*.safelinks.protection.outlook.com/?url=<encoded>&…` → original URL.
 */
export function unwrapOutlookSafeLinks(input: string): string {
  const raw = String(input || '');
  if (!raw || !/safelinks\.protection\.outlook\.com/i.test(raw)) return raw;

  return raw.replace(
    /https?:\/\/[a-z0-9.-]*safelinks\.protection\.outlook\.com\/\?[^\s"'<>]*/gi,
    (match) => {
      try {
        const url = new URL(match);
        const target = url.searchParams.get('url');
        if (!target) return match;
        const decoded = decodeURIComponent(target);
        if (/^https?:\/\//i.test(decoded) || /^mailto:/i.test(decoded)) {
          return decoded;
        }
        return match;
      } catch {
        return match;
      }
    },
  );
}

/**
 * Strip common Outlook / Word noise wrappers while keeping readable structure.
 * - unwrap `elementToProof` / `MsoNormal` wrappers (not just drop the class)
 * - empty nested `<div></div>` / `<span></span>`
 * - Word conditional comments
 */
export function stripOutlookNoise(html: string): string {
  let out = String(html || '');
  if (!out) return '';

  out = out.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  out = out.replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, '');

  // Unwrap Outlook proofing / MSO wrappers so children remain (before class strip).
  for (let i = 0; i < 6; i++) {
    const next = out.replace(
      /<(div|span|p)\b([^>]*\b(?:elementToProof|MsoNormal|MsoListParagraph)\b[^>]*)>([\s\S]*?)<\/\1>/gi,
      '$3',
    );
    if (next === out) break;
    out = next;
  }

  // Drop leftover Microsoft proofing / empty class attributes.
  out = out.replace(/\sclass=(["'])(?:[^"']*\b)?(?:elementToProof|MsoNormal|MsoListParagraph)(?:[^"']*)?\1/gi, '');
  out = out.replace(/\sclass=(["'])\s*\1/gi, '');
  out = out.replace(/\sstyle=(["'])[^"']*\1/gi, '');

  // Collapse empty wrappers repeatedly.
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/<(div|span|p|font)(\s[^>]*)?>\s*<\/\1>/gi, '');
    if (next === out) break;
    out = next;
  }

  return out.trim();
}

/** Remove unresolved `cid:` image/link refs that would render as broken in the UI. */
export function stripBrokenCidRefs(html: string): string {
  let out = String(html || '');
  if (!out || !/cid:/i.test(out)) return out;

  // Drop <img src="cid:…"> entirely (quoted or unquoted).
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*(["'])cid:[^"']*\1[^>]*>/gi, '');
  out = out.replace(/<img\b[^>]*\bsrc\s*=\s*cid:[^\s>]+[^>]*>/gi, '');
  // Neutralize cid: href/src remaining attributes.
  out = out.replace(/\s(?:src|href)\s*=\s*(["'])cid:[^"']*\1/gi, '');
  out = out.replace(/\s(?:src|href)\s*=\s*cid:[^\s>]+/gi, '');
  return out;
}

/**
 * Prepare HTML for storage / merge / inbound: SafeLinks → Outlook noise → cid cleanup.
 * Callers should still run {@link sanitizeInboundHtml} (server) or DOMPurify (client).
 */
export function cleanEmailHtmlForStorage(html: string): string {
  let out = String(html || '');
  if (!out) return '';
  out = unwrapOutlookSafeLinks(out);
  out = stripOutlookNoise(out);
  out = stripBrokenCidRefs(out);
  return out.trim();
}

/**
 * Build the Graph `message.body.content` for HTML sends.
 * - Document HTML (Quill) is cleaned + allowlist-sanitized (keeps `<p>`/`<strong>`, drops XSS).
 * - Plain-text bodies become paragraph HTML with escaped text + `<br />`.
 */
export function prepareOutboundEmailHtml(body: string): string {
  const raw = String(body || '').trim();
  if (!raw) return '';

  if (looksLikeDocumentHtml(raw)) {
    return sanitizeInboundHtml(cleanEmailHtmlForStorage(raw));
  }

  return plainTextToEmailHtml(raw);
}

/**
 * Format a merge note from a source ticket description (may be HTML or plain).
 * Returns allowlist-sanitized HTML safe for agent-note / timeline rendering.
 */
export function formatMergeSourceBodyHtml(description: string, subject?: string): string {
  const parts: string[] = [];
  if (subject && String(subject).trim()) {
    parts.push(`<p><strong>Betreff:</strong> ${escapeHtmlText(String(subject).trim())}</p>`);
  }
  const desc = String(description || '').trim();
  if (!desc) return parts.join('');

  if (looksLikeHtml(desc)) {
    parts.push(sanitizeInboundHtml(cleanEmailHtmlForStorage(desc)));
  } else {
    parts.push(plainTextToEmailHtml(desc));
  }
  return parts.join('\n');
}

/**
 * Convert HTML (or mixed Outlook noise) into clean human-readable plain text
 * for Verlauf / audit summaries. Never leaves raw tags in the result.
 */
export function htmlToAuditPlainText(raw: string): string {
  let out = String(raw || '');
  if (!out) return '';

  out = unwrapOutlookSafeLinks(out);
  out = stripBrokenCidRefs(out);

  // Decode common entities before structural rewrite.
  out = out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/\u00a0/g, ' ');

  // Block / list boundaries → newlines.
  out = out
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer)>/gi, '\n')
    .replace(/<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)\b[^>]*>/gi, '')
    .replace(/<\/?(?:ul|ol|table|thead|tbody|tfoot)\b[^>]*>/gi, '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, '\t')
    .replace(/<hr\b[^>]*>/gi, '\n---\n');

  // Drop remaining tags.
  out = out.replace(/<[^>]+>/g, '');

  out = out
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");

  // If content was stored as escaped HTML (&lt;div&gt;…), strip one more pass.
  if (/<\/?[a-z][\s\S]*>/i.test(out)) {
    out = out
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export { escapeHtmlText, plainTextToEmailHtml };
