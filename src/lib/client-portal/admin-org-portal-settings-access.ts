/**
 * Pure RBAC for Hubcom Staff Admin portal-* settings endpoints.
 * CLIENT_* → 403; SYSTEM_ADMIN (ADMIN/admin normalize) → allow.
 */

import { isClientPortalRole, isHubcomStaffRole } from './roles.js';

export type AdminPortalSettingsAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Evaluate whether a caller may hit `/api/admin/organizations/:orgId/portal-*`
 * (or Mandanten-KI `ai-settings`). Mutations require SYSTEM_ADMIN.
 */
export function evaluateAdminOrgPortalSettingsAccess(params: {
  role: string | null | undefined;
  is_admin?: boolean;
  /** When true, AGENT/staff reads are also allowed (list only). Default: mutations = SYSTEM_ADMIN. */
  readOnlyStaff?: boolean;
}): AdminPortalSettingsAccess {
  const role = String(params.role || '').trim();
  if (!role) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (isClientPortalRole(role)) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Client portal accounts cannot access Hubcom Admin Hub endpoints.',
    };
  }
  if (params.readOnlyStaff) {
    if (isHubcomStaffRole(role) || role === 'SYSTEM_ADMIN' || params.is_admin) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: 'Forbidden: Hubcom staff only.' };
  }
  // ADMIN / SUPER_ADMIN / admin → SYSTEM_ADMIN at auth; only SYSTEM_ADMIN mutates.
  if (role === 'SYSTEM_ADMIN' || params.is_admin === true) {
    return { ok: true };
  }
  return {
    ok: false,
    status: 403,
    error: 'Forbidden: Strict Administrative access required.',
  };
}

/** Assert a settings patch never bleeds into another org id (pure). */
export function assertAdminPortalPatchScopedToOrg(params: {
  routeOrgId: string;
  targetOrganizationId: string;
  otherOrganizationId: string;
}): boolean {
  if (params.routeOrgId !== params.targetOrganizationId) return false;
  if (params.targetOrganizationId === params.otherOrganizationId) return false;
  return true;
}
