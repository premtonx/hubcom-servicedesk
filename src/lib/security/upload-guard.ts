/**
 * Server upload guard: core magic-byte checks + audit log + optional ClamAV.
 */

import type { Response } from 'express';
import { writeSecurityAuditLog } from './security-store.js';
import {
  inspectUploadBuffer,
  sanitizeUploadFilename,
  type UploadGuardResult,
  type UploadKind,
  UPLOAD_INFECTED_MESSAGE_DE,
} from './upload-guard-core.js';

export * from './upload-guard-core.js';

export function applySafeAttachmentDownloadHeaders(
  res: Response,
  params: { filename: string; contentType?: string },
): void {
  const safe = sanitizeUploadFilename(params.filename || 'download');
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('Content-Type', params.contentType || 'application/octet-stream');
  res.setHeader('X-Download-Options', 'noopen');
}

/** Optional ClamAV TCP scan (skip when CLAMAV_HOST unset). */
export async function scanBufferWithClamAv(buffer: Buffer): Promise<{
  skipped: boolean;
  infected: boolean;
  detail?: string;
}> {
  const host = String(process.env.CLAMAV_HOST || '').trim();
  if (!host) return { skipped: true, infected: false };
  const port = Number.parseInt(String(process.env.CLAMAV_PORT || '3310'), 10) || 3310;

  const net = await import('net');
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      try {
        socket.write('zINSTREAM\0');
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buffer.length, 0);
        socket.write(size);
        socket.write(buffer);
        const zero = Buffer.alloc(4);
        zero.writeUInt32BE(0, 0);
        socket.write(zero);
      } catch {
        socket.destroy();
        resolve({ skipped: true, infected: false, detail: 'write_failed' });
      }
    });
    let data = '';
    socket.setTimeout(8_000);
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ skipped: true, infected: false, detail: 'timeout' });
    });
    socket.on('error', () => {
      resolve({ skipped: true, infected: false, detail: 'connect_error' });
    });
    socket.on('end', () => {
      const found = /:\s+.+\s+FOUND/i.test(data);
      resolve({ skipped: false, infected: found, detail: data.trim() });
    });
  });
}

export async function guardUploadOrReject(params: {
  buffer: Buffer;
  filename: string;
  kind: UploadKind;
  maxBytes?: number;
  claimedMime?: string | null;
  ip?: string | null;
  userId?: string | null;
  path?: string | null;
}): Promise<UploadGuardResult> {
  const inspected = inspectUploadBuffer({
    buffer: params.buffer,
    filename: params.filename,
    kind: params.kind,
    maxBytes: params.maxBytes,
    claimedMime: params.claimedMime,
  });
  if (inspected.ok === false) {
    await writeSecurityAuditLog({
      event_type: 'upload_rejected',
      severity: 'warning',
      ip_address: params.ip || null,
      user_id: params.userId || null,
      path: params.path || null,
      method: 'POST',
      details: {
        filename: params.filename,
        code: inspected.code,
        kind: params.kind,
      },
    });
    return inspected;
  }

  const clam = await scanBufferWithClamAv(params.buffer);
  if (!clam.skipped && clam.infected) {
    await writeSecurityAuditLog({
      event_type: 'upload_infected',
      severity: 'critical',
      ip_address: params.ip || null,
      user_id: params.userId || null,
      path: params.path || null,
      method: 'POST',
      details: {
        filename: params.filename,
        clam: clam.detail || 'FOUND',
        kind: params.kind,
      },
    });
    return { ok: false, error: UPLOAD_INFECTED_MESSAGE_DE, code: 'infected' };
  }
  return inspected;
}
