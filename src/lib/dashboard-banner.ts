/**
 * Platform staff-dashboard hero banner (SYSTEM_ADMIN managed).
 * Stored as a single document in geistdesk_documents.
 */

import { getDocDirect, setDocDirect, updateDocDirect } from './postgres-backend.js';
import {
  DASHBOARD_BANNER_ALLOWED_MIME,
  DASHBOARD_BANNER_MAX_BYTES,
  parseAndValidateDashboardBannerDataUrl,
} from './dashboard-banner-validate.js';

export {
  DASHBOARD_BANNER_ALLOWED_MIME,
  DASHBOARD_BANNER_MAX_BYTES,
  parseAndValidateDashboardBannerDataUrl,
};

export const DASHBOARD_BANNER_COLLECTION = 'platform_branding';
export const DASHBOARD_BANNER_DOC_ID = 'dashboard_banner';

export type DashboardBannerRecord = {
  imageDataUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

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
