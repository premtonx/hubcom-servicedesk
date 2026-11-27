/**
 * Hubcom System Role + Multi-Client Organization Permission Matrix (backend).
 *
 * External CLIENT_* portal accounts stay on /api/portal/* only.
 * Internal colleagues use SUPER_ADMIN | HUBCOM_ADMIN | HUBCOM_AGENT | HUBCOM_USER
 * plus optional rows in user_organization_access (ORG_ADMIN | ORG_AGENT).
 *
 * Pure helpers (safe for browser) live in staff-org-access-shared.ts.
 */

import { queryDb } from './postgres-backend.js';
import { isClientPortalRole } from './client-portal/roles.js';
export {
  HUBCOM_MATRIX_ROLES,
  ORG_ACCESS_ROLES,
  canManageHubcomCore,
  evaluateAccessibleOrganizationIds,
  evaluateCanManageOrganization,
  isHubcomMatrixRole,
  isOrgAccessRole,
  isSuperAdmin,
  normalizeHubcomMatrixRole,
  organizationIsAccessible,
  type AccessibleOrganizations,
  type HubcomMatrixRole,
  type OrgAccessRole,
  type StaffAccessSubject,
} from './staff-org-access-shared.js';
import {
  isOrgAccessRole,
  isSuperAdmin,
  normalizeHubcomMatrixRole,
  organizationIsAccessible,
  type AccessibleOrganizations,
  type OrgAccessRole,
  type StaffAccessSubject,
} from './staff-org-access-shared.js';

export type OrganizationAccessRow = {
  id: string;
  user_id: string;
  organization_id: string;
  access_role: OrgAccessRole;
  created_at: string;
  created_by: string | null;
};

/** Resolve accessible client organization ids (never includes portal CLIENT_* session org alone). */
export async function getAccessibleOrganizationIds(
  user: StaffAccessSubject | null | undefined,
): Promise<AccessibleOrganizations> {
  if (!user) return [];
  if (isClientPortalRole(user.role)) return [];
  if (isSuperAdmin(user)) return 'ALL';
  const role = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  if (
    role !== 'HUBCOM_ADMIN' &&
    role !== 'HUBCOM_AGENT' &&
    role !== 'HUBCOM_USER'
  ) {
    return [];
  }
  const userId = String(user.id || '').trim();
  if (!userId) return [];
  const rows = await listUserOrganizationAccess(userId);
  return rows.map((r) => r.organization_id);
}

export async function canAccessOrganization(
  user: StaffAccessSubject | null | undefined,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  if (isClientPortalRole(user.role)) return false;
  if (isSuperAdmin(user)) return true;
  const accessible = await getAccessibleOrganizationIds(user);
  return organizationIsAccessible(accessible, organizationId);
}

export async function canManageOrganization(
  user: StaffAccessSubject | null | undefined,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  if (isClientPortalRole(user.role)) return false;
  if (isSuperAdmin(user)) return true;
  const oid = String(organizationId || '').trim();
  const userId = String(user.id || '').trim();
  if (!oid || !userId) return false;
  const row = await getUserOrganizationAccess(userId, oid);
  return Boolean(row && row.access_role === 'ORG_ADMIN');
}

/** Ticket belongs to Hubcom internal pool (no client organization). */
export function isInternalHubcomTicket(ticket: Record<string, unknown> | null | undefined): boolean {
  if (!ticket) return true;
  const oid =
    (typeof ticket.organizationId === 'string' && ticket.organizationId.trim()) ||
    (typeof ticket.organization_id === 'string' && ticket.organization_id.trim()) ||
    '';
  return !oid;
}

function ticketOrgId(ticket: Record<string, unknown>): string {
  return (
    (typeof ticket.organizationId === 'string' && ticket.organizationId.trim()) ||
    (typeof ticket.organization_id === 'string' && ticket.organization_id.trim()) ||
    ''
  );
}

function userOwnsTicket(userId: string, ticket: Record<string, unknown>): boolean {
  const ids = [
    ticket.requesterId,
    ticket.requester_id,
    ticket.creatorId,
    ticket.creator_id,
    ticket.assigneeId,
    ticket.assignee_id,
    ticket.ownerId,
    ticket.owner_id,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return ids.includes(userId);
}

/**
 * Staff ticket visibility:
 * - SUPER_ADMIN: all
 * - HUBCOM_ADMIN / HUBCOM_AGENT: all internal + tickets in assigned orgs
 * - HUBCOM_USER: own internal tickets + tickets in assigned orgs
 */
export async function staffCanViewTicket(
  user: StaffAccessSubject | null | undefined,
  ticket: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  if (!user || !ticket) return false;
  if (isClientPortalRole(user.role)) return false;
  const role = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  if (role === 'SUPER_ADMIN') return true;

  const accessible = await getAccessibleOrganizationIds(user);
  const oid = ticketOrgId(ticket);

  if (!oid) {
    if (role === 'HUBCOM_ADMIN' || role === 'HUBCOM_AGENT') return true;
    if (role === 'HUBCOM_USER') {
      return userOwnsTicket(String(user.id || ''), ticket);
    }
    return false;
  }

  return organizationIsAccessible(accessible, oid);
}

export async function filterTicketsForStaff<T extends Record<string, unknown>>(
  user: StaffAccessSubject | null | undefined,
  tickets: T[],
): Promise<T[]> {
  if (!user) return [];
  if (isClientPortalRole(user.role)) return [];
  const role = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  if (role === 'SUPER_ADMIN') return tickets;

  const accessible = await getAccessibleOrganizationIds(user);
  const userId = String(user.id || '');
  return tickets.filter((ticket) => {
    const oid = ticketOrgId(ticket);
    if (!oid) {
      if (role === 'HUBCOM_ADMIN' || role === 'HUBCOM_AGENT') return true;
      if (role === 'HUBCOM_USER') return userOwnsTicket(userId, ticket);
      return false;
    }
    return organizationIsAccessible(accessible, oid);
  });
}

export async function listUserOrganizationAccess(
  userId: string,
): Promise<OrganizationAccessRow[]> {
  const res = await queryDb(
    `SELECT id::text, user_id, organization_id::text, access_role,
            created_at::text, created_by
       FROM user_organization_access
      WHERE user_id = $1
      ORDER BY created_at ASC`,
    [userId],
  );
  return (res.rows || []).map(mapAccessRow);
}

export async function listOrganizationStaffAccess(
  organizationId: string,
): Promise<OrganizationAccessRow[]> {
  const res = await queryDb(
    `SELECT id::text, user_id, organization_id::text, access_role,
            created_at::text, created_by
       FROM user_organization_access
      WHERE organization_id = $1::uuid
      ORDER BY created_at ASC`,
    [organizationId],
  );
  return (res.rows || []).map(mapAccessRow);
}

export async function getUserOrganizationAccess(
  userId: string,
  organizationId: string,
): Promise<OrganizationAccessRow | null> {
  const res = await queryDb(
    `SELECT id::text, user_id, organization_id::text, access_role,
            created_at::text, created_by
       FROM user_organization_access
      WHERE user_id = $1 AND organization_id = $2::uuid
      LIMIT 1`,
    [userId, organizationId],
  );
  const row = res.rows?.[0];
  return row ? mapAccessRow(row) : null;
}

/** Replace a user's full org-access matrix atomically. */
export async function replaceUserOrganizationAccess(params: {
  userId: string;
  assignments: Array<{ organization_id: string; access_role: OrgAccessRole }>;
  createdBy?: string | null;
}): Promise<OrganizationAccessRow[]> {
  const userId = String(params.userId || '').trim();
  if (!userId) throw Object.assign(new Error('userId required'), { status: 400 });

  await queryDb(`DELETE FROM user_organization_access WHERE user_id = $1`, [userId]);

  const seen = new Set<string>();
  for (const a of params.assignments || []) {
    const oid = String(a.organization_id || '').trim();
    const accessRole = String(a.access_role || '').trim() as OrgAccessRole;
    if (!oid || !isOrgAccessRole(accessRole)) continue;
    if (seen.has(oid)) continue;
    seen.add(oid);
    await queryDb(
      `INSERT INTO user_organization_access (user_id, organization_id, access_role, created_by)
       VALUES ($1, $2::uuid, $3, $4)
       ON CONFLICT (user_id, organization_id) DO UPDATE
         SET access_role = EXCLUDED.access_role`,
      [userId, oid, accessRole, params.createdBy || null],
    );
  }
  return listUserOrganizationAccess(userId);
}

/** Replace all staff-access rows for one organization. */
export async function replaceOrganizationStaffAccess(params: {
  organizationId: string;
  assignments: Array<{ user_id: string; access_role: OrgAccessRole }>;
  createdBy?: string | null;
}): Promise<OrganizationAccessRow[]> {
  const organizationId = String(params.organizationId || '').trim();
  if (!organizationId) {
    throw Object.assign(new Error('organizationId required'), { status: 400 });
  }
  await queryDb(`DELETE FROM user_organization_access WHERE organization_id = $1::uuid`, [
    organizationId,
  ]);
  const seen = new Set<string>();
  for (const a of params.assignments || []) {
    const userId = String(a.user_id || '').trim();
    const accessRole = String(a.access_role || '').trim() as OrgAccessRole;
    if (!userId || !isOrgAccessRole(accessRole)) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    await queryDb(
      `INSERT INTO user_organization_access (user_id, organization_id, access_role, created_by)
       VALUES ($1, $2::uuid, $3, $4)
       ON CONFLICT (user_id, organization_id) DO UPDATE
         SET access_role = EXCLUDED.access_role`,
      [userId, organizationId, accessRole, params.createdBy || null],
    );
  }
  return listOrganizationStaffAccess(organizationId);
}

function mapAccessRow(row: any): OrganizationAccessRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    organization_id: String(row.organization_id),
    access_role: String(row.access_role) as OrgAccessRole,
    created_at: String(row.created_at || ''),
    created_by: row.created_by == null ? null : String(row.created_by),
  };
}
