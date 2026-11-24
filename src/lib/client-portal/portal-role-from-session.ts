/**
 * Client-safe portal role hydration — never requires /api/db "roles".
 */

import type { User, UserRole } from '../../types';
import {
  CLIENT_PORTAL_ROLE_SEEDS,
  isClientPortalRole,
  type ClientPortalRole,
} from './roles';

export const CLIENT_PORTAL_ROLE_LABELS_DE: Record<ClientPortalRole, string> = {
  CLIENT_ADMIN: 'Kunden-Administrator',
  CLIENT_SUPPORTER: 'Kunden-Support',
  CLIENT_USER: 'Mitarbeiter',
};

export function clientPortalRoleLabelDe(role: string | null | undefined): string {
  if (!isClientPortalRole(role)) return String(role || '');
  return CLIENT_PORTAL_ROLE_LABELS_DE[role];
}

/** Build an in-memory UserRole from the seeded CLIENT_* blueprint (no DB read). */
export function buildClientPortalUserRole(role: ClientPortalRole): UserRole {
  const seed = CLIENT_PORTAL_ROLE_SEEDS.find((r) => r.name === role)!;
  const now = new Date();
  return {
    id: seed.id,
    name: seed.name,
    description: seed.description,
    isSystem: seed.isSystem,
    permissions: { ...seed.permissions } as UserRole['permissions'],
    specialPermissions: { ...seed.specialPermissions },
    createdAt: now,
    updatedAt: now,
  };
}

export type AuthSessionUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  organizationId?: string | null;
  organization_id?: string | null;
  avatar?: string | null;
  can_create_tickets?: boolean;
  can_view_knowledgebase?: boolean;
};

/** Map /api/auth/session user into a User profile for CLIENT_* accounts. */
export function buildClientPortalUserProfile(
  sessionUser: AuthSessionUser,
  fallback: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null },
): User | null {
  const role = String(sessionUser.role || '').trim();
  if (!isClientPortalRole(role)) return null;
  const organizationId = String(
    sessionUser.organizationId || sessionUser.organization_id || '',
  ).trim();
  if (!organizationId) return null;

  return {
    id: String(sessionUser.id || fallback.uid),
    name: String(sessionUser.name || fallback.displayName || fallback.email?.split('@')[0] || ''),
    email: String(sessionUser.email || fallback.email || ''),
    avatar: String(sessionUser.avatar || fallback.photoURL || ''),
    role,
    roleId: CLIENT_PORTAL_ROLE_SEEDS.find((r) => r.name === role)?.id,
    organizationId,
    organization_id: organizationId,
    is_admin: false,
    can_create_tickets:
      typeof sessionUser.can_create_tickets === 'boolean'
        ? sessionUser.can_create_tickets
        : true,
    can_view_knowledgebase:
      typeof sessionUser.can_view_knowledgebase === 'boolean'
        ? sessionUser.can_view_knowledgebase
        : role !== 'CLIENT_USER',
    createdAt: new Date(),
  } as User;
}

/**
 * Pure helper used by tests: given a session role, decide whether the client
 * boot path may call /api/db collection "roles".
 */
export function shouldFetchRolesCollection(role: string | null | undefined): boolean {
  return !isClientPortalRole(role);
}
