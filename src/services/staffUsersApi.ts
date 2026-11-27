/**
 * Hubcom Mitarbeiter & Berechtigungen API client.
 * All paths under /api/admin/staff-users* and organizations/:id/staff-access.
 */

import axios from 'axios';
import type { HubcomMatrixRole, OrgAccessRole } from '../lib/staff-org-access-shared';

export type StaffOrgAssignment = {
  organization_id: string;
  access_role: OrgAccessRole;
  created_at?: string;
  created_by?: string | null;
};

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  kuerzel?: string;
  role: HubcomMatrixRole | string;
  is_admin?: boolean;
  approval_status: 'active' | 'pending_approval' | 'rejected';
  authMethod?: string;
  isDeactivated?: boolean;
  organization_access: StaffOrgAssignment[];
  createdAt?: string | null;
  lastActiveAt?: string | null;
};

export type StaffOrgMeta = {
  id: string;
  name: string;
  slug?: string | null;
};

export type StaffOrgAccessRow = {
  user_id: string;
  access_role: OrgAccessRole;
  created_at?: string;
  created_by?: string | null;
  name?: string;
  email?: string;
  role?: string | null;
};

const client = axios.create({ withCredentials: true });

export const staffUsersApi = {
  async list(): Promise<{ users: StaffUser[]; roles: HubcomMatrixRole[] }> {
    const res = await client.get('/api/admin/staff-users');
    return {
      users: res.data?.users || [],
      roles: res.data?.roles || [],
    };
  },

  async meta(): Promise<{ roles: HubcomMatrixRole[]; organizations: StaffOrgMeta[] }> {
    const res = await client.get('/api/admin/staff-users/meta');
    return {
      roles: res.data?.roles || [],
      organizations: res.data?.organizations || [],
    };
  },

  async invite(payload: {
    name: string;
    email: string;
    role: HubcomMatrixRole;
    approval_status?: 'active' | 'pending_approval' | 'rejected';
    organization_access?: StaffOrgAssignment[];
    authMethod?: 'password' | 'microsoft365';
    password?: string;
  }): Promise<StaffUser> {
    const res = await client.post('/api/admin/staff-users/invite', payload);
    return res.data?.user;
  },

  async update(
    userId: string,
    payload: {
      name?: string;
      role?: HubcomMatrixRole;
      approval_status?: 'active' | 'pending_approval' | 'rejected';
      isDeactivated?: boolean;
      organization_access?: StaffOrgAssignment[];
    },
  ): Promise<StaffUser> {
    const res = await client.patch(
      `/api/admin/staff-users/${encodeURIComponent(userId)}`,
      payload,
    );
    return res.data?.user;
  },

  async listOrgStaffAccess(organizationId: string): Promise<StaffOrgAccessRow[]> {
    const res = await client.get(
      `/api/admin/organizations/${encodeURIComponent(organizationId)}/staff-access`,
    );
    return res.data?.staff_access || [];
  },

  async replaceOrgStaffAccess(
    organizationId: string,
    assignments: Array<{ user_id: string; access_role: OrgAccessRole }>,
  ): Promise<StaffOrgAccessRow[]> {
    const res = await client.put(
      `/api/admin/organizations/${encodeURIComponent(organizationId)}/staff-access`,
      { assignments },
    );
    return res.data?.staff_access || [];
  },
};
