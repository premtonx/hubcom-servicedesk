/**
 * Platform Hubcom ServiceDesk favicon (SYSTEM_ADMIN managed).
 * Stored alongside dashboard banner in platform_branding.
 */

import { getDocDirect, setDocDirect, updateDocDirect } from './postgres-backend.js';
import { withSystemTenantContext } from './security/tenant-rls.js';
import {
  parseAndValidateSystemFaviconDataUrl,
  SYSTEM_FAVICON_ALLOWED_MIME,
  SYSTEM_FAVICON_MAX_BYTES,
} from './system-favicon-validate.js';

export {
  parseAndValidateSystemFaviconDataUrl,
  SYSTEM_FAVICON_ALLOWED_MIME,
  SYSTEM_FAVICON_MAX_BYTES,
};

export const SYSTEM_FAVICON_COLLECTION = 'platform_branding';
export const SYSTEM_FAVICON_DOC_ID = 'system_favicon';

export type SystemFaviconRecord = {
  imageDataUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export async function getSystemFavicon(): Promise<SystemFaviconRecord> {
  return withSystemTenantContext(async () => {
    const doc = await getDocDirect(SYSTEM_FAVICON_COLLECTION, SYSTEM_FAVICON_DOC_ID);
    if (!doc) {
      return { imageDataUrl: null, updatedAt: null, updatedBy: null };
    }
    const url = String(doc.imageDataUrl || doc.image_data_url || doc.favicon_url || '').trim();
    return {
      imageDataUrl: url || null,
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
      updatedBy: typeof doc.updatedBy === 'string' ? doc.updatedBy : null,
    };
  });
}

export async function setSystemFavicon(params: {
  imageDataUrl: string;
  updatedBy: string;
}): Promise<SystemFaviconRecord> {
  return withSystemTenantContext(async () => {
    const now = new Date().toISOString();
    await setDocDirect(SYSTEM_FAVICON_COLLECTION, SYSTEM_FAVICON_DOC_ID, {
      imageDataUrl: params.imageDataUrl,
      updatedAt: now,
      updatedBy: params.updatedBy,
    });
    return {
      imageDataUrl: params.imageDataUrl,
      updatedAt: now,
      updatedBy: params.updatedBy,
    };
  });
}

export async function clearSystemFavicon(updatedBy: string): Promise<SystemFaviconRecord> {
  return withSystemTenantContext(async () => {
    const now = new Date().toISOString();
    const existing = await getDocDirect(SYSTEM_FAVICON_COLLECTION, SYSTEM_FAVICON_DOC_ID);
    if (existing) {
      await updateDocDirect(SYSTEM_FAVICON_COLLECTION, SYSTEM_FAVICON_DOC_ID, {
        imageDataUrl: null,
        updatedAt: now,
        updatedBy,
      });
    } else {
      await setDocDirect(SYSTEM_FAVICON_COLLECTION, SYSTEM_FAVICON_DOC_ID, {
        imageDataUrl: null,
        updatedAt: now,
        updatedBy,
      });
    }
    return { imageDataUrl: null, updatedAt: now, updatedBy };
  });
}
