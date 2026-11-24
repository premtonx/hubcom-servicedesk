/**
 * Platform staff-dashboard hero banner (SYSTEM_ADMIN managed).
 * Stored as a single document in geistdesk_documents.
 */

import { getDocDirect, setDocDirect, updateDocDirect } from './postgres-backend.js';

export const DASHBOARD_BANNER_COLLECTION = 'platform_branding';
export const DASHBOARD_BANNER_DOC_ID = 'dashboard_banner';
export const DASHBOARD_BANNER_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const DASHBOARD_BANNER_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export type DashboardBannerRecord = {
  imageDataUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

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

export async function getDashboardBanner(): Promise<DashboardBannerRecord> {
  const doc = await getDocDirect(DASHBOARD_BANNER_COLLECTION, DASHBOARD_BANNER_DOC_ID);
  if (!doc) {
    return { imageDataUrl: null, updatedAt: null, updatedBy: null };
  }
  const url = String(doc.imageDataUrl || doc.image_data_url || '').trim();
  return {
    imageDataUrl: url || null,
    updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
    updatedBy: typeof doc.updatedBy === 'string' ? doc.updatedBy : null,
  };
}

export async function setDashboardBanner(params: {
  imageDataUrl: string;
  updatedBy: string;
}): Promise<DashboardBannerRecord> {
  const now = new Date().toISOString();
  await setDocDirect(DASHBOARD_BANNER_COLLECTION, DASHBOARD_BANNER_DOC_ID, {
    imageDataUrl: params.imageDataUrl,
    updatedAt: now,
    updatedBy: params.updatedBy,
  });
  return {
    imageDataUrl: params.imageDataUrl,
    updatedAt: now,
    updatedBy: params.updatedBy,
  };
}

export async function clearDashboardBanner(updatedBy: string): Promise<DashboardBannerRecord> {
  const now = new Date().toISOString();
  const existing = await getDocDirect(DASHBOARD_BANNER_COLLECTION, DASHBOARD_BANNER_DOC_ID);
  if (existing) {
    await updateDocDirect(DASHBOARD_BANNER_COLLECTION, DASHBOARD_BANNER_DOC_ID, {
      imageDataUrl: null,
      updatedAt: now,
      updatedBy,
    });
  } else {
    await setDocDirect(DASHBOARD_BANNER_COLLECTION, DASHBOARD_BANNER_DOC_ID, {
      imageDataUrl: null,
      updatedAt: now,
      updatedBy,
    });
  }
  return { imageDataUrl: null, updatedAt: now, updatedBy };
}
