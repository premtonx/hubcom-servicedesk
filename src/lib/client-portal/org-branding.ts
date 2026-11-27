/**
 * Validation helpers for per-organization portal branding (logo + title + favicon).
 */

import {
  inspectBase64Upload,
  UPLOAD_REJECT_MESSAGE_DE,
} from '../security/upload-guard-core.js';

export const ORG_LOGO_MAX_BYTES = 512 * 1024;
export const ORG_LOGO_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const ORG_FAVICON_MAX_BYTES = 256 * 1024;
export const ORG_FAVICON_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export function resolvePortalTitle(
  organizationName: string,
  portalTitle?: string | null,
): string {
  const custom = String(portalTitle || '').trim();
  if (custom) return custom;
  const name = String(organizationName || '').trim();
  return name ? `${name} ServiceDesk` : 'ServiceDesk';
}

export function organizationInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'K';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

/** Parse a data-URL logo; reject SVG and oversize payloads. */
export function parseAndValidateLogoDataUrl(raw: unknown): {
  ok: true;
  dataUrl: string;
  mime: string;
  bytes: number;
} | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Logo payload is empty.' };

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: 'Logo must be a data URL (image/png, image/jpeg, or image/webp).',
    };
  }

  const mime = match[1].toLowerCase();
  if (mime === 'image/svg+xml' || mime.includes('svg')) {
    return { ok: false, error: 'SVG logos are not allowed.' };
  }
  if (!ORG_LOGO_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: 'Only PNG, JPEG, and WebP logos are allowed.',
    };
  }

  const b64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > ORG_LOGO_MAX_BYTES) {
    return { ok: false, error: 'Logo must be 512 KB or smaller.' };
  }

  const ext =
    mime === 'image/png'
      ? '.png'
      : mime === 'image/webp'
        ? '.webp'
        : '.jpg';
  const magic = inspectBase64Upload({
    base64OrDataUrl: value,
    filename: `logo${ext}`,
    kind: 'branding',
    maxBytes: ORG_LOGO_MAX_BYTES,
  });
  if (magic.ok === false) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE };
  }

  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime, bytes };
}

/** Parse a data-URL favicon; reject SVG and oversize payloads. */
export function parseAndValidateFaviconDataUrl(raw: unknown): {
  ok: true;
  dataUrl: string;
  mime: string;
  bytes: number;
} | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Favicon payload is empty.' };

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: 'Favicon must be a data URL (PNG, JPEG, WebP, or ICO).',
    };
  }

  const mime = match[1].toLowerCase();
  if (mime === 'image/svg+xml' || mime.includes('svg')) {
    return { ok: false, error: 'SVG favicons are not allowed.' };
  }
  if (!ORG_FAVICON_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: 'Only PNG, JPEG, WebP, and ICO favicons are allowed.',
    };
  }

  const b64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > ORG_FAVICON_MAX_BYTES) {
    return { ok: false, error: 'Favicon must be 256 KB or smaller.' };
  }

  const ext =
    mime.includes('icon')
      ? '.ico'
      : mime === 'image/png'
        ? '.png'
        : mime === 'image/webp'
          ? '.webp'
          : '.jpg';
  const magic = inspectBase64Upload({
    base64OrDataUrl: value,
    filename: `favicon${ext}`,
    kind: 'branding',
    maxBytes: ORG_FAVICON_MAX_BYTES,
  });
  if (magic.ok === false) {
    return { ok: false, error: UPLOAD_REJECT_MESSAGE_DE };
  }

  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime, bytes };
}
