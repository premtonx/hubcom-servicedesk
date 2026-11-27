/**
 * Pure Hubcom staff matrix helpers — safe for browser + server.
 * DB-backed helpers live in staff-org-access.ts.
 */

import { isClientPortalRole } from './client-portal/roles';

export const HUBCOM_MATRIX_ROLES = [
  'SUPER_ADMIN',
  'HUBCOM_ADMIN',
  'HUBCOM_AGENT',
  'HUBCOM_USER',
] as const;

export type HubcomMatrixRole = (typeof HUBCOM_MATRIX_ROLES)[number];

export const ORG_ACCESS_ROLES = ['ORG_ADMIN', 'ORG_AGENT'] as const;
export type OrgAccessRole = (typeof ORG_ACCESS_ROLES)[number];

export type StaffAccessSubject = {
  id?: string | null;
  role?: string | null;
  is_admin?: boolean;
  organizationId?: string | null;
};

export type AccessibleOrganizations = 'ALL' | string[];

/** Normalize legacy Hubcom roles into the matrix role codes. */
export function normalizeHubcomMatrixRole(
  role: string | null | undefined,
  isAdmin = false,
): HubcomMatrixRole | string {
  const raw = String(role || '').trim();
  if (isClientPortalRole(raw)) return raw;
  if (
    raw === 'SUPER_ADMIN' ||
    raw === 'SYSTEM_ADMIN' ||
    raw === 'admin' ||
    raw === 'Administrator' ||
    isAdmin
  ) {
    return 'SUPER_ADMIN';
  }
  if (raw === 'HUBCOM_ADMIN' || raw === 'team_lead' || raw === 'TEAM_LEAD') {
    return 'HUBCOM_ADMIN';
  }
  if (raw === 'HUBCOM_AGENT' || raw === 'agent' || raw === 'AGENT') {
    return 'HUBCOM_AGENT';
  }
  if (raw === 'HUBCOM_USER') {
    return 'HUBCOM_USER';
  }
  if (!raw || raw === 'customer' || raw === 'CLIENT' || raw === 'Kunde') {
    return raw || 'HUBCOM_USER';
  }
  return 'HUBCOM_AGENT';
}

export function isHubcomMatrixRole(role: string | null | undefined): role is HubcomMatrixRole {
  return HUBCOM_MATRIX_ROLES.includes(String(role || '').trim() as HubcomMatrixRole);
}

export function isOrgAccessRole(role: string | null | undefined): role is OrgAccessRole {
  return ORG_ACCESS_ROLES.includes(String(role || '').trim() as OrgAccessRole);
}

export function canManageHubcomCore(user: StaffAccessSubject | null | undefined): boolean {
  if (!user) return false;
  const role = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  return role === 'SUPER_ADMIN' || role === 'HUBCOM_ADMIN';
}

export function isSuperAdmin(user: StaffAccessSubject | null | undefined): boolean {
  if (!user) return false;
  return normalizeHubcomMatrixRole(user.role, user.is_admin === true) === 'SUPER_ADMIN';
}

export function organizationIsAccessible(
  accessible: AccessibleOrganizations,
  organizationId: string | null | undefined,
): boolean {
  const oid = String(organizationId || '').trim();
  if (!oid) return false;
  if (accessible === 'ALL') return true;
  return accessible.includes(oid);
}

export function evaluateCanManageOrganization(params: {
  role: string | null | undefined;
  is_admin?: boolean;
  organizationId: string;
  accessRows: Array<{ organization_id: string; access_role: string }>;
}): boolean {
  const role = normalizeHubcomMatrixRole(params.role, params.is_admin === true);
  if (role === 'SUPER_ADMIN') return true;
  if (isClientPortalRole(role)) return false;
  return params.accessRows.some(
    (r) =>
      r.organization_id === params.organizationId && r.access_role === 'ORG_ADMIN',
  );
}

export function evaluateAccessibleOrganizationIds(params: {
  role: string | null | undefined;
  is_admin?: boolean;
  accessRows: Array<{ organization_id: string }>;
}): AccessibleOrganizations {
  const role = normalizeHubcomMatrixRole(params.role, params.is_admin === true);
  if (role === 'SUPER_ADMIN') return 'ALL';
  if (role !== 'HUBCOM_ADMIN' && role !== 'HUBCOM_AGENT' && role !== 'HUBCOM_USER') {
    return [];
  }
  return params.accessRows.map((r) => r.organization_id);
}
