/**
 * Best-effort outbound mail for ticket agent replies.
 * Missing mail configuration must never fail the reply write path.
 *
 * Dispatch order:
 *   1. Org Send-As Microsoft Graph channel (when healthy + sendAsEnabled)
 *   2. Hubcom global Graph channel fallback
 *   3. SMTP / MAIL_DISPATCH_URL fallback for classic SMTP setups
 *
 * Domain verification gate (SMTP path):
 *   - dnsVerified channel → From: "Support Name <support@domain.com>"
 *   - otherwise → system-default From on the Hubcom ServiceDesk mail domain
 */

import {
  buildSystemDefaultFromHeader,
  buildVerifiedFromHeader,
} from './email-ingestion/domain-verification.js';
import { createEmailIngestionDriver } from './email-ingestion/factory.js';
import { MicrosoftGraphDriver } from './email-ingestion/drivers/graph-driver.js';
import type { EmailChannelConfig } from './email-ingestion/types.js';
import {
  findGlobalDefaultEmailChannel,
  findOrganizationEmailChannel,
  getEmailChannel,
  isHealthySendAsGraph,
  listGlobalEmailChannels,
} from './email-ingestion/channel-store.js';
import { appendSignatureToOutboundBody } from './email-signature-dispatch.js';
import type {
  SignatureAgentContext,
  SignatureOrganizationContext,
  SignatureTicketContext,
} from './email-signature.js';

export interface OutboundMailResult {
  delivered: boolean;
  reason?: string;
  from?: string;
  domainVerified?: boolean;
  /** Which channel identity was used (org Send-As vs Hubcom fallback). */
  via?: 'org_send_as' | 'hubcom_fallback' | 'smtp' | 'none';
}

export interface OutboundSignatureContext {
  agent?: SignatureAgentContext;
  ticket?: SignatureTicketContext;
  organization?: SignatureOrganizationContext;
  /** Composer toggle — default true for external replies. */
  appendSignature?: boolean;
}

function globalSmtpConfigured(): boolean {
  const host = (process.env.SMTP_HOST || process.env.MAIL_SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || process.env.MAIL_SMTP_USER || '').trim();
  return Boolean(host && user);
}

function channelSmtpConfigured(channel?: EmailChannelConfig | null): boolean {
  return Boolean((channel?.smtpHost || '').trim() && (channel?.smtpUser || '').trim());
}

function smtpConfigured(channel?: EmailChannelConfig | null): boolean {
  return channelSmtpConfigured(channel) || globalSmtpConfigured();
}

function isGraphChannel(channel?: EmailChannelConfig | null): boolean {
  return channel?.connectionType === 'microsoft_graph';
}

async function resolveGraphChannelWithSecrets(
  channel?: EmailChannelConfig | null,
): Promise<EmailChannelConfig | null> {
  if (!channel?.id) return channel || null;
  const secret = String(channel.clientSecret || '');
  if (secret && secret !== '••••••••') return channel;
  try {
    return (await getEmailChannel(channel.id, { includeSecrets: true })) || channel;
  } catch {
    return channel;
  }
}

async function trySendViaMicrosoftGraph(params: {
  ticketId: string;
  to?: string | null;
  subject?: string | null;
  body: string;
  agentName?: string | null;
  channel: EmailChannelConfig;
  signature?: OutboundSignatureContext | null;
}): Promise<OutboundMailResult> {
  const channel = await resolveGraphChannelWithSecrets(params.channel);
  if (!channel) {
    return { delivered: false, reason: 'Microsoft Graph channel could not be loaded.', via: 'none' };
  }

  const driver = createEmailIngestionDriver(channel);
  if (!(driver instanceof MicrosoftGraphDriver) || typeof driver.sendMail !== 'function') {
    return {
      delivered: false,
      reason: 'Resolved channel is not a Microsoft Graph driver.',
      via: 'none',
    };
  }

  const to = String(params.to || '').trim();
  if (!to) {
    return {
      delivered: false,
      reason: 'Ticket has no customer email — reply saved to database only.',
      from: channel.mailbox || channel.email || undefined,
      domainVerified: Boolean(channel.dnsVerified),
      via: 'none',
    };
  }

  const prepared = appendSignatureToOutboundBody({
    body: params.body,
    channel,
    agent: {
      name: params.signature?.agent?.name || params.agentName || null,
      title: params.signature?.agent?.title || null,
      phone: params.signature?.agent?.phone || null,
      email: params.signature?.agent?.email || null,
    },
    ticket: params.signature?.ticket || { id: params.ticketId },
    organization: params.signature?.organization || null,
    appendSignature: params.signature?.appendSignature !== false,
  });

  const result = await driver.sendMail({
    to,
    subject: params.subject || `Re: Ticket ${params.ticketId}`,
    body: prepared.html,
    contentType: 'HTML',
    bodyIsFinalHtml: true,
    attachments: prepared.inlineAttachment ? [prepared.inlineAttachment] : undefined,
  });

  const from = channel.mailbox || channel.email || undefined;
  if (result.ok === false) {
    return {
      delivered: false,
      reason: result.message || 'Graph sendMail failed',
      from,
      domainVerified: Boolean(channel.dnsVerified),
      via: 'none',
    };
  }

  const orgId = channel.organizationId || channel.organization_id || null;
  return {
    delivered: true,
    from,
    domainVerified: Boolean(channel.dnsVerified),
    reason: `Sent via Microsoft Graph as ${from || 'mailbox'}`,
    via: orgId ? 'org_send_as' : 'hubcom_fallback',
  };
}

export function resolveOutboundFrom(channel?: EmailChannelConfig | null): {
  from: string;
  domainVerified: boolean;
  warning?: string;
} {
  if (channel?.dnsVerified && channel.email?.includes('@')) {
    return {
      from: buildVerifiedFromHeader(channel),
      domainVerified: true,
    };
  }

  // If the agent explicitly chose a channel with an address, still use that
  // display From even when DNS is unverified — dispatcher may rewrite.
  if (channel?.email?.includes('@')) {
    const header = buildVerifiedFromHeader(channel);
    const systemFrom = buildSystemDefaultFromHeader();
    return {
      from: header,
      domainVerified: false,
      warning: `Domain unverified for ${channel.email} — preferred From is ${header}; fallback system From is ${systemFrom}.`,
    };
  }

  const systemFrom = buildSystemDefaultFromHeader();
  return {
    from: systemFrom,
    domainVerified: false,
    warning: `No verified support channel — sent via system From (${systemFrom}).`,
  };
}

/**
 * Resolve the outbound channel for a ticket reply:
 *   1. Client org Graph channel with sendAsEnabled (healthy only)
 *   2. Caller-provided preferred channel (if it belongs to the org or is global)
 *   3. Hubcom global default Graph/IMAP channel
 */
export async function resolveSendAsChannel(params: {
  organizationId?: string | null;
  preferredChannel?: EmailChannelConfig | null;
}): Promise<EmailChannelConfig | null> {
  const orgId = (params.organizationId || '').trim();
  if (orgId) {
    const orgChannel = await findOrganizationEmailChannel(orgId, {
      includeSecrets: true,
      requireSendAs: true,
    });
    if (orgChannel && isHealthySendAsGraph(orgChannel)) {
      return orgChannel;
    }
  }

  if (params.preferredChannel) {
    const preferredOrg =
      params.preferredChannel.organizationId ||
      params.preferredChannel.organization_id ||
      null;
    // Never use another client's channel as preferred.
    if (orgId && preferredOrg && preferredOrg !== orgId) {
      /* skip */
    } else if (isGraphChannel(params.preferredChannel)) {
      if (!preferredOrg || isHealthySendAsGraph(params.preferredChannel)) {
        return resolveGraphChannelWithSecrets(params.preferredChannel);
      }
    } else {
      return params.preferredChannel;
    }
  }

  return findGlobalDefaultEmailChannel({ includeSecrets: true });
}

async function trySendViaSmtp(params: {
  ticketId: string;
  to?: string | null;
  cc?: string[] | null;
  subject?: string | null;
  body: string;
  agentName?: string | null;
  channel?: EmailChannelConfig | null;
  /** Explicit From override from the composer (display label or address). */
  fromOverride?: string | null;
  signature?: OutboundSignatureContext | null;
}): Promise<OutboundMailResult> {
  if (!smtpConfigured(params.channel)) {
    return {
      delivered: false,
      reason:
        'No Microsoft Graph Send-As channel matched this ticket and SMTP is not configured (SMTP_HOST / SMTP_USER missing). Reply saved to database only.',
      via: 'none',
    };
  }

  const prepared = appendSignatureToOutboundBody({
    body: params.body,
    channel: params.channel || null,
    agent: {
      name: params.signature?.agent?.name || params.agentName || null,
      title: params.signature?.agent?.title || null,
      phone: params.signature?.agent?.phone || null,
      email: params.signature?.agent?.email || null,
    },
    ticket: params.signature?.ticket || { id: params.ticketId },
    organization: params.signature?.organization || null,
    appendSignature: params.signature?.appendSignature !== false,
  });
  // SMTP path embeds a data-URL logo when present (no Graph cid: attachments).
  let smtpBody = prepared.html;
  if (prepared.inlineAttachment) {
    const dataUrl = `data:${prepared.inlineAttachment.contentType};base64,${prepared.inlineAttachment.contentBytes}`;
    smtpBody = smtpBody.replace(
      new RegExp(`cid:${prepared.inlineAttachment.contentId}`, 'gi'),
      dataUrl,
    );
  }
  params = { ...params, body: smtpBody };

  try {
    const endpoint = (process.env.MAIL_DISPATCH_URL || '').trim();
    if (!endpoint) {
      return {
        delivered: false,
        reason: 'MAIL_DISPATCH_URL not set. Reply saved to database only.',
        via: 'none',
      };
    }

    const fromResolution = resolveOutboundFrom(params.channel);
    const from =
      (params.fromOverride || '').trim() ||
      fromResolution.from;
    const cc = (params.cc || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => e.includes('@'));

    const channelSmtp = channelSmtpConfigured(params.channel)
      ? {
          host: params.channel!.smtpHost,
          port: params.channel!.smtpPort ?? 587,
          user: params.channel!.smtpUser,
          // Password is available only when channel was loaded with secrets.
          password: (params.channel as EmailChannelConfig & { smtpPassword?: string | null })
            .smtpPassword,
          secure: params.channel!.smtpSecure === true,
        }
      : null;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: params.ticketId,
        to: params.to,
        cc: cc.length > 0 ? cc : undefined,
        subject: params.subject,
        body: params.body,
        agentName: params.agentName,
        from,
        domainVerified: fromResolution.domainVerified,
        unverifiedDomainWarning: fromResolution.warning || null,
        replyTo: params.channel?.email || null,
        smtp: channelSmtp,
        autoSubmitted: 'no',
        inReplyTo: params.ticketId ? `geistdesk-ticket-${params.ticketId}` : undefined,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        delivered: false,
        reason: `Mail dispatch failed (${res.status}): ${detail.slice(0, 200)}`,
        from,
        domainVerified: fromResolution.domainVerified,
        via: 'smtp',
      };
    }

    return {
      delivered: true,
      from,
      domainVerified: fromResolution.domainVerified,
      reason: fromResolution.warning,
      via: 'smtp',
    };
  } catch (err: any) {
    return {
      delivered: false,
      reason: err?.message || 'Mail dispatch threw unexpectedly',
      via: 'none',
    };
  }
}

/**
 * Send a transactional email (portal invites, password setup) through the
 * platform's configured outbound channel — same Graph → Hubcom → SMTP order
 * as ticket replies. Does not invent a sender when no channel can send.
 */
export async function trySendTransactionalEmail(params: {
  to: string;
  subject: string;
  body: string;
  /** Prefer this org's Send-As Graph channel when healthy. */
  organizationId?: string | null;
  /** Plain-text body is converted to simple HTML for Graph. */
  contentType?: 'HTML' | 'Text';
}): Promise<OutboundMailResult> {
  const to = String(params.to || '').trim().toLowerCase();
  if (!to.includes('@')) {
    return { delivered: false, reason: 'Recipient email is missing or invalid.', via: 'none' };
  }

  const subject = String(params.subject || '').trim() || '(no subject)';
  const rawBody = String(params.body || '');
  // Plain invite bodies → minimal HTML so Graph renders newlines.
  const htmlBody =
    params.contentType === 'HTML'
      ? rawBody
      : `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;font-size:14px;line-height:1.5">${rawBody
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</pre>`;

  const orgId = (params.organizationId || '').trim() || null;
  const graphFailures: string[] = [];

  if (orgId) {
    const orgChannel = await findOrganizationEmailChannel(orgId, {
      includeSecrets: true,
      requireSendAs: true,
    });
    if (orgChannel && isHealthySendAsGraph(orgChannel)) {
      const orgResult = await trySendViaMicrosoftGraph({
        ticketId: `txn-invite-${Date.now()}`,
        to,
        subject,
        body: htmlBody,
        channel: orgChannel,
        signature: { appendSignature: false },
      });
      if (orgResult.delivered) {
        return { ...orgResult, via: 'org_send_as' };
      }
      graphFailures.push(
        `${orgChannel.mailbox || orgChannel.email || orgChannel.id}: ${orgResult.reason || 'Graph sendMail failed'}`,
      );
    } else if (orgChannel) {
      graphFailures.push(
        `Org Send-As channel unavailable (${orgChannel.email || orgChannel.id})`,
      );
    }
  }

  const globals = await listGlobalEmailChannels({ includeSecrets: true });
  const graphCandidates = globals.filter((ch) => isGraphChannel(ch));
  graphCandidates.sort((a, b) => {
    const ah = isHealthySendAsGraph(a) ? 0 : 1;
    const bh = isHealthySendAsGraph(b) ? 0 : 1;
    return ah - bh;
  });

  let lastGraph: OutboundMailResult | null = null;
  for (const channel of graphCandidates) {
    const result = await trySendViaMicrosoftGraph({
      ticketId: `txn-invite-${Date.now()}`,
      to,
      subject,
      body: htmlBody,
      channel,
      signature: { appendSignature: false },
    });
    if (result.delivered) {
      return { ...result, via: 'hubcom_fallback' };
    }
    lastGraph = result;
    graphFailures.push(
      `${channel.mailbox || channel.email || channel.id}: ${result.reason || 'Graph sendMail failed'}`,
    );
  }

  // SMTP only when a configured channel / env actually supports it — not as a
  // silent substitute for a healthy Graph mailbox that should have been used.
  const smtpChannel =
    graphCandidates[0] ||
    (await findGlobalDefaultEmailChannel({ includeSecrets: true })) ||
    null;
  if (smtpConfigured(smtpChannel)) {
    const smtpResult = await trySendViaSmtp({
      ticketId: `txn-invite-${Date.now()}`,
      to,
      subject,
      body: htmlBody,
      channel: smtpChannel,
      signature: { appendSignature: false },
    });
    if (smtpResult.delivered) return smtpResult;
    graphFailures.push(smtpResult.reason || 'SMTP dispatch failed');
  }

  const reason =
    [
      ...graphFailures,
      lastGraph && !graphFailures.length ? lastGraph.reason : null,
      !graphCandidates.length && !smtpConfigured(smtpChannel)
        ? 'No Microsoft Graph outbound channel is configured (and SMTP/MAIL_DISPATCH_URL is unavailable).'
        : null,
    ]
      .filter(Boolean)
      .join(' | ') || 'Outbound email channel unavailable.';

  return {
    delivered: false,
    reason,
    from: lastGraph?.from,
    domainVerified: lastGraph?.domainVerified,
    via: 'none',
  };
}

/**
 * Attempt to dispatch a customer-facing reply email.
 * Prefer healthy org Send-As Graph → Hubcom global Graph → SMTP.
 * Graph failures fall through to the next option; missing config never throws.
 */
export async function trySendTicketReplyEmail(params: {
  ticketId: string;
  to?: string | null;
  cc?: string[] | null;
  subject?: string | null;
  body: string;
  agentName?: string | null;
  /** Ingestion / support channel used to pick the From: header. */
  channel?: EmailChannelConfig | null;
  /** Explicit From override from the composer (display label or address). */
  fromOverride?: string | null;
  /** Ticket organization — enables per-client Send-As when configured. */
  organizationId?: string | null;
  /** Signature context — applied only to outbound mail, never ticket history. */
  signature?: OutboundSignatureContext | null;
}): Promise<OutboundMailResult> {
  const orgId = (params.organizationId || '').trim() || null;

  // 1) Healthy org Send-As
  let orgChannel: EmailChannelConfig | null = null;
  if (orgId) {
    orgChannel = await findOrganizationEmailChannel(orgId, {
      includeSecrets: true,
      requireSendAs: true,
    });
    if (orgChannel && isHealthySendAsGraph(orgChannel)) {
      const orgResult = await trySendViaMicrosoftGraph({
        ticketId: params.ticketId,
        to: params.to,
        subject: params.subject,
        body: params.body,
        agentName: params.agentName,
        channel: orgChannel,
        signature: params.signature,
      });
      if (orgResult.delivered) {
        return { ...orgResult, via: 'org_send_as' };
      }
      // Fall through to Hubcom on Graph failure.
    }
  }

  // 2) Hubcom global Graph — try preferred channel first, then every global Graph channel.
  const graphFailures: string[] = [];
  if (orgChannel && !isHealthySendAsGraph(orgChannel)) {
    graphFailures.push(
      `Org Send-As channel disabled/unhealthy (${orgChannel.email || orgChannel.id})`,
    );
  } else if (orgId && orgChannel) {
    // org path already attempted above; keep last reason if any by re-reading is awkward —
    // failures are recorded below when we fall through.
  }

  const preferredGlobal =
    params.channel &&
    !(params.channel.organizationId || params.channel.organization_id) &&
    isGraphChannel(params.channel)
      ? params.channel
      : null;

  const globals = await listGlobalEmailChannels({ includeSecrets: true });
  const graphCandidates: EmailChannelConfig[] = [];
  if (preferredGlobal) graphCandidates.push(preferredGlobal);
  for (const ch of globals) {
    if (!isGraphChannel(ch)) continue;
    if (graphCandidates.some((c) => c.id === ch.id)) continue;
    graphCandidates.push(ch);
  }

  // Prefer explicitly healthy channels, but still attempt others (status may be stale).
  graphCandidates.sort((a, b) => {
    const ah = isHealthySendAsGraph(a) ? 0 : 1;
    const bh = isHealthySendAsGraph(b) ? 0 : 1;
    return ah - bh;
  });

  let lastGraph: OutboundMailResult | null = null;
  for (const channel of graphCandidates) {
    const hubcomResult = await trySendViaMicrosoftGraph({
      ticketId: params.ticketId,
      to: params.to,
      subject: params.subject,
      body: params.body,
      agentName: params.agentName,
      channel,
      signature: params.signature,
    });
    if (hubcomResult.delivered) {
      return { ...hubcomResult, via: 'hubcom_fallback' };
    }
    lastGraph = hubcomResult;
    const label = channel.mailbox || channel.email || channel.id;
    graphFailures.push(`${label}: ${hubcomResult.reason || 'Graph sendMail failed'}`);
  }

  // 3) SMTP (preserves Hubcom CC / From override when Graph cannot send)
  const smtpResult = await trySendViaSmtp({
    ticketId: params.ticketId,
    to: params.to,
    cc: params.cc,
    subject: params.subject,
    body: params.body,
    agentName: params.agentName,
    fromOverride: params.fromOverride,
    channel:
      graphCandidates[0] ||
      (await findGlobalDefaultEmailChannel({ includeSecrets: true })) ||
      params.channel ||
      null,
    signature: params.signature,
  });
  if (smtpResult.delivered) return smtpResult;

  // Surface Graph errors first — SMTP-missing is expected on Graph-only setups.
  const combinedReason = [
    ...graphFailures,
    smtpResult.reason,
    lastGraph && !graphFailures.length ? lastGraph.reason : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    delivered: false,
    reason:
      combinedReason ||
      'No Microsoft Graph channel could send this reply and SMTP is not configured.',
    from: lastGraph?.from || smtpResult.from,
    domainVerified: lastGraph?.domainVerified ?? smtpResult.domainVerified,
    via: 'none',
  };
}
