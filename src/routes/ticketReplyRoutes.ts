import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { attachClientOrganizationContext } from '../middleware/clientPortalMiddleware.js';
import { addDocDirect, getDocDirect, updateDocDirect } from '../lib/postgres-backend.js';
import { routeParam } from '../lib/route-params.js';
import { trySendTicketReplyEmail } from '../lib/outbound-mail.js';
import {
  findChannelForOutbound,
  getEmailChannel,
  listEmailChannels,
} from '../lib/email-ingestion/channel-store.js';
import { formatReplyRecipientLabel, resolveComposerFromAddress } from '../lib/ticket-reply-address.js';
import { safeLog } from '../lib/safe-log.js';
import { isClientPortalRole } from '../lib/client-portal/roles.js';
import {
  clientCanMutateTicket,
  resolveOrganizationIdFromUser,
} from '../lib/client-portal/ticket-visibility.js';
import { getOrganization } from '../lib/client-portal/organizations.js';
import {
  DEFAULT_HUBCOM_SIGNATURE_HTML,
  isSignatureEnabled,
  renderSignatureHtml,
} from '../lib/email-signature.js';

const router = Router();

/**
 * GET /api/tickets/:id/signature-preview
 * Live rendered signature for the reply composer (current user + channel).
 */
router.get(
  '/:id/signature-preview',
  authenticate,
  attachClientOrganizationContext,
  async (req: Request, res: Response): Promise<any> => {
    const ticketId = routeParam(req.params.id);
    const channelId = String(req.query.channelId || '').trim();
    try {
      const ticket = await getDocDirect('tickets', ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

      const ticketOrgId =
        (typeof ticket.organizationId === 'string' && ticket.organizationId) ||
        (typeof ticket.organization_id === 'string' && ticket.organization_id) ||
        null;

      const channel =
        (channelId ? await getEmailChannel(channelId, { includeSecrets: false }) : null) ||
        (await findChannelForOutbound({
          channelId: channelId || null,
          mailbox: ticket.mailbox || ticket.forwardingAddress || null,
          supportEmail: ticket.supportEmail || ticket.channelEmail || null,
          organizationId: ticketOrgId,
        }));

      const agentUser = await getDocDirect('users', String(req.user!.id));
      const org = ticketOrgId
        ? await getOrganization(ticketOrgId).catch(() => null)
        : null;

      const enabled = isSignatureEnabled(channel || { signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML });
      const html = renderSignatureHtml({
        channel: channel || {
          signature_enabled: true,
          signature_html: DEFAULT_HUBCOM_SIGNATURE_HTML,
        },
        agent: {
          name: req.user!.name || agentUser?.name || req.user!.email || 'Agent',
          title:
            (typeof agentUser?.job_title === 'string' && agentUser.job_title) ||
            (typeof agentUser?.jobTitle === 'string' && agentUser.jobTitle) ||
            null,
          phone: (typeof agentUser?.phone === 'string' && agentUser.phone) || null,
          email: req.user!.email || agentUser?.email || null,
        },
        ticket: { id: ticketId, number: ticket.ticketNumber || ticket.number || null },
        organization: {
          name: org?.name || ticket.company || ticket.customerCompany || 'Hubcom GmbH',
        },
        forPreview: true,
      });

      return res.json({
        enabled,
        html,
        template: channel?.signature_html || DEFAULT_HUBCOM_SIGNATURE_HTML,
        channelId: channel?.id || null,
      });
    } catch (e: any) {
      safeLog('error', '[ticket-replies] signature preview failed', e?.message || e);
      return res.status(500).json({ error: 'Failed to render signature preview.' });
    }
  },
);

const emailListSchema = z
  .array(z.string().trim().email().max(320))
  .max(25)
  .optional()
  .default([]);

/**
 * GET /api/tickets/:id/composer-addresses
 * Von:/An: for the reply composer. Uses the ticket mailbox's channel
 * forwardingAddress (or support email), then MAIL_FROM_ADDRESS.
 */
router.get('/:id/composer-addresses', authenticate, attachClientOrganizationContext, async (req: Request, res: Response): Promise<any> => {
  const ticketId = routeParam(req.params.id);
  try {
    const ticket = await getDocDirect('tickets', ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }
    if (isClientPortalRole(req.user?.role)) {
      const canView = await clientCanMutateTicket(
        {
          id: String(req.user!.id),
          role: String(req.user!.role),
          organizationId: resolveOrganizationIdFromUser(req.user!),
        },
        { ...ticket, id: ticketId },
      );
      if (!canView) return res.status(404).json({ error: 'Ticket not found.' });
    }

    const channels = await listEmailChannels();
    const from = resolveComposerFromAddress({
      ticketMailbox: ticket.mailbox || ticket.forwardingAddress || null,
      channels,
      moduleSupportEmail: ticket.supportEmail || ticket.channelEmail || null,
      mailFromAddress: process.env.MAIL_FROM_ADDRESS || process.env.SMTP_FROM || null,
    });
    const to = formatReplyRecipientLabel(ticket);

    return res.status(200).json({ from, to });
  } catch (e: any) {
    safeLog('error', '[ticket-replies] failed to resolve composer addresses', e?.message || e);
    return res.status(500).json({ error: 'Failed to resolve composer addresses.' });
  }
});

const replySchema = z.object({
  content: z.string().min(1).max(100_000),
  originalContent: z.string().max(100_000).optional(),
  senderId: z.string().min(1).max(128),
  senderName: z.string().min(1).max(200).optional(),
  senderType: z.enum(['agent', 'customer', 'ai']).default('agent'),
  fromAddress: z.string().trim().max(500).optional(),
  fromChannelId: z.string().trim().max(128).optional(),
  cc: emailListSchema,
  /** Append channel signature on outbound mail only (default true). */
  appendSignature: z.boolean().optional().default(true),
});

/**
 * POST /api/tickets/:id/replies
 * Database-first agent reply:
 *   1. Persist message under tickets/{id}/messages
 *   2. Attempt outbound email (non-fatal)
 *   3. Always 200 when DB write succeeds — even if SMTP is unavailable
 */
router.post('/:id/replies', authenticate, attachClientOrganizationContext, async (req: Request, res: Response): Promise<any> => {
  const ticketId = routeParam(req.params.id);
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid reply payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const ticket = await getDocDirect('tickets', ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const isClient = isClientPortalRole(req.user?.role);
    if (isClient) {
      const canReply = await clientCanMutateTicket(
        {
          id: String(req.user!.id),
          role: String(req.user!.role),
          organizationId: resolveOrganizationIdFromUser(req.user!),
        },
        { ...ticket, id: ticketId },
      );
      if (!canReply) return res.status(404).json({ error: 'Ticket not found.' });
    }

    const now = new Date().toISOString();
    const data = parsed.data;
    const toAddress =
      ticket.customerEmail || ticket.contactEmail || ticket.requesterEmail || null;
    const cc = data.cc || [];
    const ticketOrgId =
      (typeof ticket.organizationId === 'string' && ticket.organizationId) ||
      (typeof ticket.organization_id === 'string' && ticket.organization_id) ||
      null;

    // Prefer explicit channel from composer; fall back to org Send-As / mailbox matching.
    let channel =
      (data.fromChannelId
        ? await getEmailChannel(data.fromChannelId, { includeSecrets: true })
        : null) ||
      (await findChannelForOutbound({
        channelId: data.fromChannelId || null,
        mailbox: ticket.mailbox || ticket.forwardingAddress || null,
        supportEmail: ticket.supportEmail || ticket.channelEmail || null,
        organizationId: ticketOrgId,
      }));

    // If channel was resolved without secrets but has smtpHost, reload with secrets.
    if (channel?.id && channel.smtpHost && !(channel as any).smtpPassword) {
      channel = (await getEmailChannel(channel.id, { includeSecrets: true })) || channel;
    }

    const fromAddress =
      (data.fromAddress || '').trim() ||
      (channel
        ? `${(channel.displayName || channel.name || 'Support').trim()} <${channel.email}>`
        : null);

    // Persist composer body only — never duplicate the legal signature footer
    // into ticket history. Signature is applied exclusively at outbound send.
    const messageRecord = await addDocDirect(`tickets/${ticketId}/messages`, {
      ticketId,
      senderId: isClient ? req.user!.id : data.senderId || req.user!.id,
      senderType: isClient ? 'customer' : data.senderType,
      senderName: data.senderName || req.user!.email || 'Agent',
      content: data.content,
      originalContent: data.originalContent || null,
      fromAddress: fromAddress || null,
      toAddress: toAddress || null,
      cc,
      deliveryStatus: 'pending',
      is_internal: false,
      isInternal: false,
      createdAt: now,
      updatedAt: now,
    });

    await updateDocDirect('tickets', ticketId, {
      updatedAt: now,
      lastReplyAt: now,
      lastReplyBy: data.senderType,
    });

    const agentUser = await getDocDirect('users', String(req.user!.id));
    const agentTitle =
      (typeof agentUser?.job_title === 'string' && agentUser.job_title) ||
      (typeof agentUser?.jobTitle === 'string' && agentUser.jobTitle) ||
      null;
    const agentPhone =
      (typeof agentUser?.phone === 'string' && agentUser.phone) || null;
    const org =
      ticketOrgId && channel
        ? await getOrganization(ticketOrgId).catch(() => null)
        : channel && !(channel.organizationId || channel.organization_id)
          ? { name: 'Hubcom GmbH' }
          : ticketOrgId
            ? await getOrganization(ticketOrgId).catch(() => null)
            : { name: 'Hubcom GmbH' };

    let delivered = false;
    let deliveryReason: string | undefined;
    let mailFrom: string | undefined;
    let domainVerified: boolean | undefined;
    try {
      const mailResult = await trySendTicketReplyEmail({
        ticketId,
        to: toAddress,
        cc,
        subject: ticket.subject ? `Re: ${ticket.subject}` : `Re: Ticket ${ticketId}`,
        body: data.content,
        agentName: data.senderName || req.user!.name || req.user!.email || 'Agent',
        channel,
        fromOverride: fromAddress,
        organizationId: ticketOrgId,
        signature: {
          appendSignature: data.appendSignature !== false,
          agent: {
            name: data.senderName || req.user!.name || agentUser?.name || req.user!.email || 'Agent',
            title: agentTitle,
            phone: agentPhone,
            email: req.user!.email || agentUser?.email || null,
          },
          ticket: { id: ticketId, number: ticket.ticketNumber || ticket.number || null },
          organization: {
            name:
              (org && 'name' in org ? org.name : null) ||
              ticket.company ||
              ticket.customerCompany ||
              null,
          },
        },
      });
      delivered = mailResult.delivered;
      deliveryReason = mailResult.reason;
      mailFrom = mailResult.from;
      domainVerified = mailResult.domainVerified;
      if (!delivered) {
        safeLog(
          'warn',
          '[ticket-replies] outbound mail not delivered',
          `ticket=${ticketId} via=${mailResult.via || 'none'} reason=${deliveryReason || 'unknown'}`,
        );
      }
    } catch (mailErr: any) {
      delivered = false;
      deliveryReason = mailErr?.message || 'Outbound mail threw unexpectedly';
      safeLog('warn', '[ticket-replies] outbound mail failed non-fatally', deliveryReason);
    }

    const deliveryStatus = delivered ? 'delivered' : 'saved_locally';
    await updateDocDirect(`tickets/${ticketId}/messages`, messageRecord.id, {
      deliveryStatus,
      deliveryReason: deliveryReason || null,
      mailFrom: mailFrom || fromAddress || null,
      fromAddress: fromAddress || mailFrom || null,
      toAddress: toAddress || null,
      cc,
      domainVerified: typeof domainVerified === 'boolean' ? domainVerified : null,
      deliveredAt: delivered ? new Date().toISOString() : null,
    });

    return res.status(200).json({
      success: true,
      savedToDb: true,
      delivered,
      deliveryStatus,
      deliveryReason: deliveryReason || null,
      mailFrom: mailFrom || fromAddress || null,
      domainVerified: typeof domainVerified === 'boolean' ? domainVerified : null,
      message: {
        id: messageRecord.id,
        ticketId,
        senderId: data.senderId || req.user!.id,
        senderType: data.senderType,
        senderName: data.senderName || req.user!.email || 'Agent',
        content: data.content,
        originalContent: data.originalContent || null,
        fromAddress: fromAddress || mailFrom || null,
        toAddress: toAddress || null,
        cc,
        deliveryStatus,
        createdAt: now,
      },
    });
  } catch (e: any) {
    safeLog('error', '[ticket-replies] failed to persist reply', e?.message || e);
    return res.status(500).json({ error: 'Failed to save reply to the database.' });
  }
});

export default router;
