/**
 * Client-safe dashboard banner validation (no DB imports).
 */

export const DASHBOARD_BANNER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const DASHBOARD_BANNER_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export function parseAndValidateDashboardBannerDataUrl(raw: unknown):
  | { ok: true; dataUrl: string; mime: string; bytes: number }
  | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'Banner payload is empty.' };

  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) {
    return {
      ok: false,
      error: 'Banner must be a data URL (image/png, image/jpeg, or image/webp).',
    };
  }

  const mime = match[1].toLowerCase();
  if (mime === 'image/svg+xml' || mime.includes('svg')) {
    return { ok: false, error: 'SVG banners are not allowed.' };
  }
  if (!DASHBOARD_BANNER_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      error: 'Only PNG, JPEG, and WebP banners are allowed.',
    };
  }

  const b64 = match[2].replace(/\s+/g, '');
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > DASHBOARD_BANNER_MAX_BYTES) {
    return { ok: false, error: 'Banner must be 2 MB or smaller.' };
  }

  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, mime, bytes };
}
