/**
 * Shared helpers to sync browser tab title + favicon for staff vs portal routes.
 * Pure / DOM-only — safe to import from React layouts.
 */

import { brandConfig } from './brandConfig';

export const DEFAULT_SYSTEM_FAVICON_HREF = '/favicon.svg';

export function isPortalPath(pathname: string): boolean {
  return String(pathname || '').startsWith('/portal');
}

/** German segment labels for portal browser-tab titles. */
export function portalRouteSegmentLabel(pathname: string): string | null {
  const path = String(pathname || '');
  if (path === '/portal' || path === '/portal/dashboard') return null;
  if (path.startsWith('/portal/returns')) return 'Rücklieferungen';
  if (path.startsWith('/portal/tickets')) return 'Tickets';
  if (path.startsWith('/portal/kb')) return 'Wissensdatenbank';
  if (path.startsWith('/portal/exchange')) return 'Sicherer Austausch';
  if (path.startsWith('/portal/vault')) return 'Tresor';
  if (path.startsWith('/portal/members')) return 'Mitarbeiter';
  if (path.startsWith('/portal/email')) return 'E-Mail';
  if (path.startsWith('/portal/branding')) return 'Portal-Branding';
  return null;
}

export function buildPortalDocumentTitle(
  portalTitle: string,
  pathname: string,
): string {
  const base = String(portalTitle || '').trim() || brandConfig.productName;
  const segment = portalRouteSegmentLabel(pathname);
  return segment ? `${segment} · ${base}` : base;
}

export function applyDocumentFavicon(href: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const next = String(href || '').trim() || DEFAULT_SYSTEM_FAVICON_HREF;

  const ensureLink = (rel: string): HTMLLinkElement => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
    if (!link) {
      // Also match rel="shortcut icon" (space-separated)
      if (rel === 'shortcut icon') {
        link =
          Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel]')).find((el) =>
            el.rel.toLowerCase().includes('shortcut'),
          ) || null;
      }
    }
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }
    return link;
  };

  const applyType = (link: HTMLLinkElement) => {
    if (next.startsWith('data:image/png')) link.type = 'image/png';
    else if (next.startsWith('data:image/jpeg')) link.type = 'image/jpeg';
    else if (next.startsWith('data:image/webp')) link.type = 'image/webp';
    else if (
      next.startsWith('data:image/x-icon') ||
      next.startsWith('data:image/vnd.microsoft.icon')
    ) {
      link.type = 'image/x-icon';
    } else if (next.startsWith('data:image/svg+xml') || next.endsWith('.svg')) {
      link.type = 'image/svg+xml';
    } else {
      link.removeAttribute('type');
    }
    link.href = next;
  };

  applyType(ensureLink('icon'));
  applyType(ensureLink('shortcut icon'));
}

export function applyDocumentTitle(title: string): void {
  if (typeof document === 'undefined') return;
  document.title = String(title || '').trim() || brandConfig.documentTitle;
}
