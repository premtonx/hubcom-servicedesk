/**
 * Portal KB frontend API policy + auth-gate helpers (unit-testable).
 *
 * /portal/kb must call only /api/portal/kb* — never staff /api/kb* or /api/db.
 * Portal KB routers must run authenticate before requireClientPortalRole.
 */

import { isClientPortalRole } from './roles.js';

const PORTAL_KB_ALLOWED_PREFIXES = ['/api/portal/kb'] as const;

/** True when a frontend URL is allowed for the Kunden-Portal KB page. */
export function isPortalKbFrontendApiAllowed(url: string): boolean {
  const path = String(url || '').split('?')[0];
  if (!path.startsWith('/api/')) return false;
  if (path === '/api/db' || path.startsWith('/api/db/')) return false;
  if (path === '/api/kb' || path.startsWith('/api/kb/')) return false;
  return PORTAL_KB_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export type PortalKbAuthProbeUser = {
  role?: string | null;
  organizationId?: string | null;
  organization_id?: string | null;
} | null | undefined;

/**
 * Mirrors the auth outcome of GET /api/portal/kb before visibility filtering.
 * - Missing session user (authenticate not run / no cookie) → 401 Unauthorized.
 * - Non-CLIENT_* role → 403
 * - CLIENT_* without org → 403
 * - Valid CLIENT_ADMIN | CLIENT_SUPPORTER | CLIENT_USER with org → 200 (no 401/403)
 */
export function portalKbListAuthStatus(user: PortalKbAuthProbeUser): {
  status: number;
  error?: string;
} {
  if (!user) {
    return { status: 401, error: 'Unauthorized.' };
  }
  const role = String(user.role || '').trim();
  if (
    !isClientPortalRole(role) ||
    !(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER'] as const).includes(role as any)
  ) {
    return {
      status: 403,
      error:
        'Forbidden: Requires client portal role (CLIENT_ADMIN, CLIENT_SUPPORTER, CLIENT_USER).',
    };
  }
  const organizationId = String(user.organizationId || user.organization_id || '').trim();
  if (!organizationId) {
    return {
      status: 403,
      error: 'Forbidden: Client account is not linked to an organization.',
    };
  }
  return { status: 200 };
}

/**
 * Collect `/api/...` path literals from page/route source for isolation scans.
 * Template segments like `${id}` are normalized to `*`.
 */
export function collectApiPathLiteralsFromSource(source: string): string[] {
  const out: string[] = [];
  const re = /['"`](\/api\/[^'"`]+)['"`]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const normalized = match[1].replace(/\$\{[^}]+\}/g, '*');
    out.push(normalized);
  }
  return out;
}

/** True when route module mounts authenticate before role guards. */
export function portalKbRouterMountsAuthenticate(routeSource: string): boolean {
  const authIdx = routeSource.indexOf('authenticate');
  const useIdx = routeSource.indexOf('router.use(authenticate');
  return authIdx >= 0 && useIdx >= 0;
}
