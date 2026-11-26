/**
 * Route-aware browser tab title + favicon sync.
 * - /portal/* → org portal_title + org favicon (fallback: system favicon → /favicon.svg)
 * - staff routes → Hubcom documentTitle + system favicon
 * Portal I/O uses /api/portal/* only (never /api/db).
 */

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { brandConfig } from '../lib/brandConfig';
import { resolvePortalTitle } from '../lib/client-portal/org-branding';
import {
  applyDocumentFavicon,
  applyDocumentTitle,
  buildPortalDocumentTitle,
  DEFAULT_SYSTEM_FAVICON_HREF,
  isPortalPath,
} from '../lib/document-branding';
import { useAuth } from '../lib/hooks';

export function DocumentBrandingSync() {
  const location = useLocation();
  const { user } = useAuth();
  const systemFaviconRef = useRef<string | null>(null);
  const portalCacheRef = useRef<{
    organizationId: string | null;
    portalTitle: string;
    faviconUrl: string | null;
  } | null>(null);
  const authKey = user?.uid || 'anon';

  useEffect(() => {
    let active = true;
    const path = location.pathname;
    const onPortal = isPortalPath(path);

    void (async () => {
      try {
        if (onPortal) {
          let portalTitle: string = brandConfig.productName;
          let faviconUrl: string | null = null;

          try {
            const orgRes = await axios.get('/api/portal/organization', {
              withCredentials: true,
            });
            if (!active) return;
            const org = orgRes.data?.organization;
            portalTitle =
              org?.resolved_portal_title ||
              resolvePortalTitle(String(org?.name || ''), org?.portal_title);
            faviconUrl = org?.favicon_url || null;
            portalCacheRef.current = {
              organizationId: org?.id || null,
              portalTitle,
              faviconUrl,
            };
          } catch {
            if (portalCacheRef.current) {
              portalTitle = portalCacheRef.current.portalTitle;
              faviconUrl = portalCacheRef.current.faviconUrl;
            }
          }

          applyDocumentTitle(buildPortalDocumentTitle(portalTitle, path));

          if (faviconUrl) {
            applyDocumentFavicon(faviconUrl);
            return;
          }

          try {
            const sysRes = await axios.get('/api/portal/branding/system-favicon', {
              withCredentials: true,
            });
            if (!active) return;
            const sys = sysRes.data?.imageDataUrl || null;
            systemFaviconRef.current = sys;
            applyDocumentFavicon(sys || DEFAULT_SYSTEM_FAVICON_HREF);
          } catch {
            applyDocumentFavicon(systemFaviconRef.current || DEFAULT_SYSTEM_FAVICON_HREF);
          }
          return;
        }

        // Staff / non-portal routes
        applyDocumentTitle(brandConfig.documentTitle);

        if (!user) {
          applyDocumentFavicon(systemFaviconRef.current || DEFAULT_SYSTEM_FAVICON_HREF);
          return;
        }

        try {
          const res = await axios.get('/api/admin/system-favicon', { withCredentials: true });
          if (!active) return;
          const href = res.data?.imageDataUrl || null;
          systemFaviconRef.current = href;
          applyDocumentFavicon(href || DEFAULT_SYSTEM_FAVICON_HREF);
        } catch {
          applyDocumentFavicon(systemFaviconRef.current || DEFAULT_SYSTEM_FAVICON_HREF);
        }
      } catch {
        if (!active) return;
        applyDocumentTitle(
          onPortal ? brandConfig.productName : brandConfig.documentTitle,
        );
        applyDocumentFavicon(DEFAULT_SYSTEM_FAVICON_HREF);
      }
    })();

    return () => {
      active = false;
    };
  }, [location.pathname, authKey, user]);

  // Re-apply immediately when admin saves a new system favicon while on staff routes.
  useEffect(() => {
    const handler = () => {
      if (isPortalPath(location.pathname)) return;
      void axios
        .get('/api/admin/system-favicon', { withCredentials: true })
        .then((res) => {
          const href = res.data?.imageDataUrl || null;
          systemFaviconRef.current = href;
          applyDocumentFavicon(href || DEFAULT_SYSTEM_FAVICON_HREF);
        })
        .catch(() => undefined);
    };
    window.addEventListener('hubcom-system-favicon-changed', handler);
    return () => window.removeEventListener('hubcom-system-favicon-changed', handler);
  }, [location.pathname]);

  // Re-apply when CLIENT_ADMIN saves portal title/favicon on /portal/branding.
  useEffect(() => {
    const handler = () => {
      if (!isPortalPath(location.pathname)) return;
      portalCacheRef.current = null;
      void axios
        .get('/api/portal/organization', { withCredentials: true })
        .then((orgRes) => {
          const org = orgRes.data?.organization;
          const portalTitle =
            org?.resolved_portal_title ||
            resolvePortalTitle(String(org?.name || ''), org?.portal_title);
          const faviconUrl = org?.favicon_url || null;
          portalCacheRef.current = {
            organizationId: org?.id || null,
            portalTitle,
            faviconUrl,
          };
          applyDocumentTitle(buildPortalDocumentTitle(portalTitle, location.pathname));
          if (faviconUrl) {
            applyDocumentFavicon(faviconUrl);
            return;
          }
          return axios
            .get('/api/portal/branding/system-favicon', { withCredentials: true })
            .then((sysRes) => {
              applyDocumentFavicon(sysRes.data?.imageDataUrl || DEFAULT_SYSTEM_FAVICON_HREF);
            });
        })
        .catch(() => undefined);
    };
    window.addEventListener('hubcom-portal-branding-changed', handler);
    return () => window.removeEventListener('hubcom-portal-branding-changed', handler);
  }, [location.pathname]);

  return null;
}

export default DocumentBrandingSync;
