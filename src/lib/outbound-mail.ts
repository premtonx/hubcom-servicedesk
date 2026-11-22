/**
 * Best-effort outbound mail for ticket agent replies.
 * Missing SMTP configuration must never fail the reply write path.
 *
 * Domain verification gate:
 *   - dnsVerified channel → From: "Support Name <support@domain.com>"
 *   - otherwise → system-default From on the Hubcom ServiceDesk mail domain
 */

import {
  buildSystemDefaultFromHeader,
  buildVerifiedFromHeader,
} from './email-ingestion/domain-verification.js';
import type { EmailChannelConfig } from './email-ingestion/types.js';

export interface OutboundMailResult {
  delivered: boolean;
  reason?: string;
  from?: string;
  domainVerified?: boolean;
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
 * Attempt to dispatch a customer-facing reply email.
 * When no SMTP host/user is configured (typical showcase / self-host without mail),
 * returns `{ delivered: false }` without throwing.
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
}): Promise<OutboundMailResult> {
  if (!smtpConfigured(params.channel)) {
    return {
      delivered: false,
      reason: 'SMTP not configured (SMTP_HOST / SMTP_USER missing). Reply saved to database only.',
    };
  }

  try {
    // Lightweight SMTP hand-off without a mandatory nodemailer dependency:
    // integrations can plug a real transporter behind this env gate later.
    const endpoint = (process.env.MAIL_DISPATCH_URL || '').trim();
    if (!endpoint) {
      return {
        delivered: false,
        reason: 'MAIL_DISPATCH_URL not set. Reply saved to database only.',
      };
    }

    const fromResolution = resolveOutboundFrom(params.channel);
    const from =
      (params.fromOverride || '').trim() ||
      fromResolution.from;
    const cc = (params.cc || [])
      .map((e) => String(e || '').trim().toLowerCase())
      .filter((e) => e.includes('@'));

    const body = params.body;

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
        body,
        agentName: params.agentName,
        from,
        domainVerified: fromResolution.domainVerified,
        unverifiedDomainWarning: fromResolution.warning || null,
        replyTo: params.channel?.email || null,
        smtp: channelSmtp,
        // Loop-breaking conventions for conforming dispatchers (Resend/Postmark/
        // Mailgun/Mailcow). Not stamped by this payload; the dispatcher is
        // expected to send Auto-Submitted: no and proper In-Reply-To/References.
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
      };
    }

    return {
      delivered: true,
      from,
      domainVerified: fromResolution.domainVerified,
      reason: fromResolution.warning,
    };
  } catch (err: any) {
    return {
      delivered: false,
      reason: err?.message || 'Mail dispatch threw unexpectedly',
    };
  }
}
