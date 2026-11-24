/**
 * Server-only signature append for outbound Graph/SMTP (uses cheerio sanitizer).
 */

import { prepareOutboundEmailHtml } from './email-html-prepare.js';
import { sanitizeInboundHtml } from './email-ingestion/sanitize-server.js';
import {
  buildSignatureInlineAttachment,
  isSignatureEnabled,
  renderSignatureHtml,
  type GraphInlineAttachment,
  type SignatureAgentContext,
  type SignatureChannelFields,
  type SignatureOrganizationContext,
  type SignatureTicketContext,
} from './email-signature.js';

/**
 * Append rendered signature to outbound body only (never mutate stored history).
 */
export function appendSignatureToOutboundBody(params: {
  body: string;
  channel: SignatureChannelFields | null | undefined;
  agent: SignatureAgentContext;
  ticket?: SignatureTicketContext | null;
  organization?: SignatureOrganizationContext | null;
  appendSignature?: boolean;
}): { html: string; inlineAttachment: GraphInlineAttachment | null } {
  const append =
    params.appendSignature !== false && isSignatureEnabled(params.channel);
  const bodyHtml = prepareOutboundEmailHtml(params.body);

  if (!append) {
    return { html: bodyHtml, inlineAttachment: null };
  }

  const signatureHtml = sanitizeInboundHtml(
    renderSignatureHtml({
      channel: params.channel,
      agent: params.agent,
      ticket: params.ticket,
      organization: params.organization,
      forPreview: false,
    }),
  );
  if (!signatureHtml.trim()) {
    return { html: bodyHtml, inlineAttachment: null };
  }

  const html = `${bodyHtml}<br/><br/>${signatureHtml}`;
  const inlineAttachment = buildSignatureInlineAttachment(params.channel);
  return { html, inlineAttachment };
}
