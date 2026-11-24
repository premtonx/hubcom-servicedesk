import axios from 'axios';

export type AdminAuthMethod = 'password' | 'microsoft365';
export type AdminRole = 'SYSTEM_ADMIN' | 'agent' | 'customer';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  kuerzel: string;
  job_title?: string;
  phone?: string;
  role: AdminRole;
  company: string;
  companyId?: string | null;
  authMethod: AdminAuthMethod;
  entraObjectId?: string | null;
  upn?: string | null;
  isDeactivated: boolean;
  is_admin: boolean;
  lastActiveAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface EntraSettingsDto {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  redirectUri: string;
  defaultRole: AdminRole;
  allowedDomains: string[];
  jitProvisioning: boolean;
  hasClientSecret: boolean;
  configured: boolean;
  updatedAt?: string;
}

const api = axios.create({ withCredentials: true });

export const userAdminApi = {
  async list(params?: {
    q?: string;
    role?: string;
    authMethod?: string;
    page?: number;
    limit?: number;
  }): Promise<{ users: AdminUser[]; pagination: any }> {
    const res = await api.get('/api/admin/users', { params });
    return {
      users: res.data?.users || [],
      pagination: res.data?.pagination || {},
    };
  },

  async create(payload: {
    name: string;
    email: string;
    kuerzel?: string;
    job_title?: string;
    phone?: string;
    role: AdminRole;
    company?: string;
    authMethod: AdminAuthMethod;
    password?: string;
  }): Promise<AdminUser> {
    const res = await api.post('/api/admin/users', payload);
    return res.data.user;
  },

  async update(id: string, payload: Partial<AdminUser>): Promise<AdminUser> {
    const res = await api.patch(`/api/admin/users/${encodeURIComponent(id)}`, payload);
    return res.data.user;
  },

  async setPassword(id: string, password: string): Promise<void> {
    await api.post(`/api/admin/users/${encodeURIComponent(id)}/password`, { password });
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/api/admin/users/${encodeURIComponent(id)}`);
  },

  async getEntraSettings(): Promise<EntraSettingsDto> {
    const res = await api.get('/api/admin/users/entra-settings');
    return res.data.settings;
  },

  async saveEntraSettings(payload: Partial<EntraSettingsDto> & { clientSecret?: string | null }) {
    const res = await api.put('/api/admin/users/entra-settings', payload);
    return res.data.settings as EntraSettingsDto;
  },

  async syncM365(): Promise<{ message: string; result: any }> {
    const res = await api.post('/api/admin/users/sync-m365');
    return res.data;
  },
};
