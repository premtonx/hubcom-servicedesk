/**
 * Pure RBAC for Hubcom Staff Admin portal-* settings endpoints.
 * CLIENT_* → 403; org management requires SUPER_ADMIN or ORG_ADMIN assignment.
 */

import { isClientPortalRole, isHubcomStaffRole } from './roles.js';
import {
  evaluateCanManageOrganization,
  normalizeHubcomMatrixRole,
} from '../staff-org-access.js';

export type AdminPortalSettingsAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Evaluate whether a caller may hit `/api/admin/organizations/:orgId/portal-*`
 * (or Mandanten-KI `ai-settings`).
 *
 * Prefer passing `organizationId` + `accessRows` for the matrix check.
 * Legacy callers without accessRows: SUPER_ADMIN / is_admin only.
 */
export function evaluateAdminOrgPortalSettingsAccess(params: {
  role: string | null | undefined;
  is_admin?: boolean;
  /** When true, AGENT/staff reads are also allowed (list only). */
  readOnlyStaff?: boolean;
  organizationId?: string;
  accessRows?: Array<{ organization_id: string; access_role: string }>;
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
    if (isHubcomStaffRole(role) || role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN' || params.is_admin) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: 'Forbidden: Hubcom staff only.' };
  }

  if (params.organizationId && Array.isArray(params.accessRows)) {
    const ok = evaluateCanManageOrganization({
      role,
      is_admin: params.is_admin,
      organizationId: params.organizationId,
      accessRows: params.accessRows,
    });
    if (ok) return { ok: true };
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Keine ORG_ADMIN-Berechtigung für diese Organisation.',
    };
  }

  // Legacy callers without accessRows: only explicit SUPER_ADMIN / SYSTEM_ADMIN / is_admin.
  // Raw "admin" is normalized in authMiddleware before these checks run.
  if (role === 'SUPER_ADMIN' || role === 'SYSTEM_ADMIN' || params.is_admin === true) {
    return { ok: true };
  }
  void normalizeHubcomMatrixRole;
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
