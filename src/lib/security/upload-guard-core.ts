/**
 * Pure upload inspection (magic bytes + allowlists) — safe for browser + server.
 * Server-only ClamAV / audit logging live in upload-guard.ts.
 */

export const UPLOAD_REJECT_MESSAGE_DE =
  'Dateityp nicht zulässig oder Dateiinhalt stimmt nicht mit der Dateiendung überein.';

export const UPLOAD_INFECTED_MESSAGE_DE =
  'Datei wurde als schädlich erkannt und abgelehnt.';

export const TICKET_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
  '.log',
  '.csv',
  '.xlsx',
  '.docx',
  '.zip',
] as const;

export const BRANDING_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.ico'] as const;

export const BLOCKED_EXTENSIONS = [
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.js',
  '.mjs',
  '.html',
  '.htm',
  '.svg',
  '.xml',
  '.php',
  '.jar',
  '.com',
  '.scr',
  '.vbs',
  '.wsf',
] as const;

export const DEFAULT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_BRANDING_BYTES = 512 * 1024;
export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type UploadKind = 'ticket_attachment' | 'kb_document' | 'branding' | 'return_attachment';

export type UploadGuardResult =
  | {
      ok: true;
      ext: string;
      mime: string;
      safeFilename: string;
      storageName: string;
    }
  | {
      ok: false;
      error: string;
      code: 'blocked_extension' | 'magic_mismatch' | 'too_large' | 'empty' | 'infected';
    };

function bufferStartsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function detectMagic(buf: Buffer): {
  kind:
    | 'png'
    | 'jpeg'
    | 'webp'
    | 'gif'
    | 'pdf'
    | 'zip'
    | 'ico'
    | 'exe'
    | 'html'
    | 'text'
    | 'unknown';
} {
  if (!buf.length) return { kind: 'unknown' };
  if (bufferStartsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'png' };
  }
  if (bufferStartsWith(buf, [0xff, 0xd8, 0xff])) return { kind: 'jpeg' };
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { kind: 'webp' };
  }
  if (bufferStartsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { kind: 'gif' };
  if (buf.toString('ascii', 0, 5) === '%PDF-') return { kind: 'pdf' };
  if (
    bufferStartsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    bufferStartsWith(buf, [0x50, 0x4b, 0x05, 0x06])
  ) {
    return { kind: 'zip' };
  }
  if (
    bufferStartsWith(buf, [0x00, 0x00, 0x01, 0x00]) ||
    bufferStartsWith(buf, [0x00, 0x00, 0x02, 0x00])
  ) {
    return { kind: 'ico' };
  }
  if (bufferStartsWith(buf, [0x4d, 0x5a])) return { kind: 'exe' };
  const head = buf.slice(0, Math.min(256, buf.length)).toString('utf8').trimStart().toLowerCase();
  if (
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.startsWith('<script') ||
    head.startsWith('<?xml')
  ) {
    return { kind: 'html' };
  }
  let printable = 0;
  const sample = buf.slice(0, Math.min(512, buf.length));
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 160) printable += 1;
  }
  if (sample.length > 0 && printable / sample.length > 0.9 && !sample.includes(0)) {
    return { kind: 'text' };
  }
  return { kind: 'unknown' };
}

export function extensionOf(filename: string): string {
  const base = String(filename || '').split(/[/\\]/).pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx < 0) return '';
  return base.slice(idx).toLowerCase();
}

export function sanitizeUploadFilename(filename: string): string {
  let name = String(filename || 'datei')
    .replace(/\0/g, '')
    .replace(/[/\\]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[^\w.\- ()äöüÄÖÜß+-]+/g, '_')
    .trim();
  if (!name || name === '.' || name === '..') name = 'datei';
  return name.slice(0, 180);
}

function newStorageId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function randomStorageFilename(originalFilename: string): string {
  const ext = extensionOf(originalFilename);
  const safeExt = /^\.[a-z0-9]{1,10}$/i.test(ext) ? ext.toLowerCase() : '';
  return `${newStorageId()}${safeExt}`;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.md': 'text/markdown',
};

function allowlistFor(kind: UploadKind): readonly string[] {
  if (kind === 'branding') return BRANDING_EXTENSIONS;
  if (kind === 'kb_document') {
    return ['.pdf', '.docx', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg', '.webp'];
  }
  return TICKET_ATTACHMENT_EXTENSIONS;
}

function magicMatchesExt(magic: ReturnType<typeof detectMagic>['kind'], ext: string): boolean {
  switch (ext) {
    case '.png':
      return magic === 'png';
    case '.jpg':
    case '.jpeg':
      return magic === 'jpeg';
    case '.webp':
      return magic === 'webp';
    case '.ico':
      return magic === 'ico' || magic === 'png';
    case '.pdf':
      return magic === 'pdf';
    case '.zip':
      return magic === 'zip';
    case '.docx':
    case '.xlsx':
      return magic === 'zip';
    case '.txt':
    case '.log':
    case '.csv':
    case '.md':
      return magic === 'text' || magic === 'unknown';
    default:
      return false;
  }
}

export function inspectUploadBuffer(params: {
  buffer: Buffer;
  filename: string;
  claimedMime?: string | null;
  kind: UploadKind;
  maxBytes?: number;
}): UploadGuardResult {
  const buf = params.buffer;
  if (!buf || buf.length === 0) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'empty' };
  }
  const max =
    params.maxBytes ??
    (params.kind === 'branding'
      ? DEFAULT_MAX_BRANDING_BYTES
      : params.kind === 'kb_document'
        ? DEFAULT_MAX_DOCUMENT_BYTES
        : DEFAULT_MAX_ATTACHMENT_BYTES);
  if (buf.length > max) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'too_large' };
  }

  const safeFilename = sanitizeUploadFilename(params.filename);
  const ext = extensionOf(safeFilename);
  if (!ext || (BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'blocked_extension' };
  }
  const allow = allowlistFor(params.kind);
  if (!(allow as readonly string[]).includes(ext)) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'blocked_extension' };
  }

  const magic = detectMagic(buf);
  if (magic.kind === 'exe' || magic.kind === 'html') {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'magic_mismatch' };
  }
  if (!magicMatchesExt(magic.kind, ext)) {
    if (
      ['.txt', '.log', '.csv', '.md'].includes(ext) &&
      magic.kind !== 'text' &&
      magic.kind !== 'unknown'
    ) {
      return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'magic_mismatch' };
    }
    if (!['.txt', '.log', '.csv', '.md'].includes(ext)) {
      return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'magic_mismatch' };
    }
  }

  return {
    ok: true,
    ext,
    mime: MIME_BY_EXT[ext] || params.claimedMime || 'application/octet-stream',
    safeFilename,
    storageName: randomStorageFilename(safeFilename),
  };
}

/** Decode base64 (data-URL or raw) then run inspectUploadBuffer. */
export function inspectBase64Upload(params: {
  base64OrDataUrl: string;
  filename: string;
  kind: UploadKind;
  maxBytes?: number;
}): UploadGuardResult & { buffer?: Buffer } {
  const raw = String(params.base64OrDataUrl || '').trim();
  let b64 = raw;
  const dataMatch = /^data:([^;]+);base64,(.+)$/i.exec(raw);
  if (dataMatch) b64 = dataMatch[2];
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  } catch {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE, code: 'empty' };
  }
  const result = inspectUploadBuffer({
    buffer,
    filename: params.filename,
    kind: params.kind,
    maxBytes: params.maxBytes,
  });
  if (result.ok === false) return result;
  return { ...result, buffer };
}

export function isDisguisedExecutableOrHtml(buffer: Buffer): boolean {
  const magic = detectMagic(buffer);
  return magic.kind === 'exe' || magic.kind === 'html';
}
