/**
 * Client-safe validation for the main Hubcom system favicon
 * (PNG / SVG / ICO / WebP — used by /admin/branding).
 */

export const SYSTEM_FAVICON_MAX_BYTES = 256 * 1024;
export const SYSTEM_FAVICON_ALLOWED_MIME = new Set([
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export function parseAndValidateSystemFaviconDataUrl(raw: unknown):
  | { ok: true; dataUrl: string; mime: string; bytes: number }
  | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Favicon payload is empty.' };

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: 'Favicon must be a data URL (PNG, SVG, WebP, or ICO).',
    };
  }

  const mime = match[1].toLowerCase();
  if (!SYSTEM_FAVICON_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: 'Only PNG, SVG, WebP, and ICO favicons are allowed.',
    };
  }

  const b64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > SYSTEM_FAVICON_MAX_BYTES) {
    return { ok: false, error: 'Favicon must be 256 KB or smaller.' };
  }

  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime, bytes };
}
