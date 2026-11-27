/**
 * Expected initial /portal mount API surface for CLIENT_* sessions.
 * Pure allow/deny helpers for isolation tests (no DOM).
 */

import { isClientPortalRole } from './roles.js';

/** Paths a fresh CLIENT_ADMIN / CLIENT_USER portal mount may call. */
export const PORTAL_MOUNT_ALLOWED_API_PREFIXES = [
  '/api/auth/session',
  '/api/portal/',
  '/api/admin/onboarding/status',
] as const;

/** Staff-only surfaces that must never fire for CLIENT_* on mount. */
export const PORTAL_MOUNT_FORBIDDEN_API_PREFIXES = [
  '/api/db',
  '/api/admin/system-favicon',
  '/api/admin/organizations',
  '/api/header',
  '/api/kb/',
  '/api/ai/',
  '/api/module-config',
] as const;

export function isPortalMountAllowedPath(path: string): boolean {
  const p = String(path || '').split('?')[0];
  return PORTAL_MOUNT_ALLOWED_API_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix),
  );
}

export function isPortalMountForbiddenPath(path: string): boolean {
  const p = String(path || '').split('?')[0];
  return PORTAL_MOUNT_FORBIDDEN_API_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix),
  );
}

/**
 * Simulate a portal boot request set and assert zero staff-only 403 sources.
 * Returns counters for isolation tests under hubcom_app / NOBYPASSRLS semantics.
 */
export function simulatePortalMountRequestSet(params: {
  role: string;
  paths: string[];
}): {
  allowed: string[];
  forbidden: string[];
  would403: string[];
  would429: string[];
  wouldIpBan: boolean;
} {
  const role = String(params.role || '');
  if (!isClientPortalRole(role) && role !== 'PORTAL_USER') {
    return {
      allowed: [],
      forbidden: [...params.paths],
      would403: [...params.paths],
      would429: [],
      wouldIpBan: false,
    };
  }

  const allowed: string[] = [];
  const forbidden: string[] = [];
  for (const path of params.paths) {
    if (isPortalMountForbiddenPath(path)) {
      forbidden.push(path);
    } else if (isPortalMountAllowedPath(path)) {
      allowed.push(path);
    } else if (path.startsWith('/api/')) {
      // Unknown /api — treat as forbidden for mount simulation.
      forbidden.push(path);
    } else {
      allowed.push(path);
    }
  }

  return {
    allowed,
    forbidden,
    would403: forbidden,
    would429: [],
    wouldIpBan: false,
  };
}

/** Canonical clean mount set for CLIENT_ADMIN dashboard boot. */
export const CLIENT_ADMIN_PORTAL_MOUNT_PATHS = [
  '/api/auth/session',
  '/api/admin/onboarding/status',
  '/api/portal/me',
  '/api/portal/organization',
  '/api/portal/branding/system-favicon',
  '/api/portal/dashboard',
] as const;

/** Canonical clean mount set for CLIENT_USER / PORTAL_USER dashboard boot. */
export const CLIENT_USER_PORTAL_MOUNT_PATHS = [
  '/api/auth/session',
  '/api/admin/onboarding/status',
  '/api/portal/me',
  '/api/portal/organization',
  '/api/portal/branding/system-favicon',
  '/api/portal/dashboard',
] as const;
