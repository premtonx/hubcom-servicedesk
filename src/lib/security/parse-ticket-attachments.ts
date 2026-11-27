/**
 * Shared ticket/return attachment parser with magic-byte upload guard.
 */

import {
  DEFAULT_MAX_ATTACHMENT_BYTES,
  guardUploadOrReject,
  UPLOAD_INFECTED_MESSAGE_DE,
  UPLOAD_REJECT_MESSAGE_DE,
} from './upload-guard.js';
import { sanitizeUserHtml, sanitizePlainTextField } from './sanitize.js';

export const MAX_TICKET_ATTACHMENTS = 5;

export type ParsedTicketAttachment = {
  filename: string;
  contentType: string;
  size: number;
  contentBase64?: string;
  omitted?: boolean;
  reason?: string;
};

export async function parseAndGuardTicketAttachments(
  raw: unknown,
  opts?: {
    ip?: string | null;
    userId?: string | null;
    path?: string | null;
    maxBytes?: number;
  },
): Promise<
  | { ok: true; attachments: ParsedTicketAttachment[] }
  | { ok: false; status: 400 | 422; error: string }
> {
  if (!Array.isArray(raw)) return { ok: true, attachments: [] };
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const out: ParsedTicketAttachment[] = [];

  for (const item of raw.slice(0, MAX_TICKET_ATTACHMENTS)) {
    const filename = String((item as any)?.filename || 'anhang').slice(0, 255);
    const contentType = String(
      (item as any)?.contentType || 'application/octet-stream',
    ).slice(0, 120);
    const contentBase64 =
      typeof (item as any)?.contentBase64 === 'string'
        ? (item as any).contentBase64
        : '';
    const size =
      Number((item as any)?.size) ||
      (contentBase64 ? Math.floor((contentBase64.length * 3) / 4) : 0);

    if (!contentBase64) {
      out.push({ filename, contentType, size, omitted: true, reason: 'empty' });
      continue;
    }
    if (size > maxBytes) {
      out.push({
        filename,
        contentType,
        size,
        omitted: true,
        reason: 'exceeds_size_limit',
      });
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(String(contentBase64).replace(/\s+/g, ''), 'base64');
    } catch {
      return { ok: false, status: 400, error: UPLOAD_REJECT_MESSAGE_DE };
    }

    const guarded = await guardUploadOrReject({
      buffer,
      filename,
      kind: 'ticket_attachment',
      maxBytes,
      claimedMime: contentType,
      ip: opts?.ip,
      userId: opts?.userId,
      path: opts?.path,
    });

    if (guarded.ok === false) {
      return {
        ok: false,
        status: guarded.code === 'infected' ? 422 : 400,
        error:
          guarded.code === 'infected'
            ? UPLOAD_INFECTED_MESSAGE_DE
            : UPLOAD_REJECT_MESSAGE_DE,
      };
    }

    out.push({
      filename: guarded.safeFilename,
      contentType: guarded.mime,
      size: buffer.length,
      contentBase64,
    });
  }

  return { ok: true, attachments: out };
}

export function sanitizeTicketTextFields(input: {
  subject?: string | null;
  description?: string | null;
  content?: string | null;
}): { subject?: string; description?: string; content?: string } {
  const out: { subject?: string; description?: string; content?: string } = {};
  if (input.subject != null) {
    out.subject = sanitizePlainTextField(input.subject, 500);
  }
  if (input.description != null) {
    out.description = sanitizeUserHtml(input.description);
  }
  if (input.content != null) {
    // Replies may be plain text or HTML — sanitize as HTML (plain text passes through)
    const raw = String(input.content);
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      out.content = sanitizeUserHtml(raw);
    } else {
      // Keep plain text (incl. pasted code) — do not ban; escape happens at render
      out.content = raw.slice(0, 100_000);
    }
  }
  return out;
}
