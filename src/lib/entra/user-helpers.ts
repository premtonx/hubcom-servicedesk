/** Hilfsfunktionen für Benutzerverwaltung / M365. */

export type ManagedAuthMethod = 'password' | 'microsoft365';

/** Staff + portal roles returned by the admin user API. */
export type ManagedRole =
  | 'SYSTEM_ADMIN'
  | 'agent'
  | 'customer'
  | 'team_lead'
  | 'CLIENT_ADMIN'
  | 'CLIENT_SUPPORTER'
  | 'CLIENT_USER';

export function normalizeAuthMethod(raw: unknown): ManagedAuthMethod {
  const v = String(raw || '').toLowerCase().trim();
  if (v === 'microsoft365' || v === 'sso' || v === 'microsoft' || v === 'entra' || v === 'oidc') {
    return 'microsoft365';
  }
  return 'password';
}

export function normalizeRole(raw: unknown): ManagedRole {
  const v = String(raw || '').trim();
  if (v === 'SYSTEM_ADMIN' || v === 'admin' || v === 'Administrator') return 'SYSTEM_ADMIN';
  if (v === 'CLIENT_ADMIN') return 'CLIENT_ADMIN';
  if (v === 'CLIENT_SUPPORTER') return 'CLIENT_SUPPORTER';
  if (v === 'CLIENT_USER') return 'CLIENT_USER';
  if (v === 'customer' || v === 'Kunde') return 'customer';
  if (v === 'team_lead') return 'team_lead';
  return 'agent';
}

export function isAdminRole(role: unknown): boolean {
  return normalizeRole(role) === 'SYSTEM_ADMIN';
}

export function isClientPortalManagedRole(role: unknown): boolean {
  const r = normalizeRole(role);
  return r === 'CLIENT_ADMIN' || r === 'CLIENT_SUPPORTER' || r === 'CLIENT_USER';
}

/** Kürzel aus Vor-/Nachname, z. B. „Premton Xhafa“ → „PX“. */
export function deriveKuerzel(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatUserForAdmin(
  u: Record<string, any>,
  orgNameById?: Map<string, string>,
) {
  const authMethod = normalizeAuthMethod(u.authMethod);
  const role = normalizeRole(u.role || (u.is_admin ? 'SYSTEM_ADMIN' : 'agent'));
  const organizationId =
    (typeof u.organizationId === 'string' && u.organizationId.trim()) ||
    (typeof u.organization_id === 'string' && u.organization_id.trim()) ||
    null;
  const orgName =
    (organizationId && orgNameById?.get(organizationId)) ||
    u.company ||
    u.customerCompany ||
    '';

  return {
    id: u.id,
    name: u.name || '',
    email: u.email || '',
    kuerzel: u.kuerzel || '',
    job_title: u.job_title || u.jobTitle || '',
    phone: u.phone || '',
    role,
    company: orgName || '',
    companyId: u.companyId || null,
    organizationId,
    contactId: u.contactId || null,
    customerCompany: u.customerCompany || orgName || null,
    authMethod,
    entraObjectId: u.entraObjectId || null,
    upn: u.upn || null,
    isDeactivated: u.isDeactivated === true,
    is_admin: role === 'SYSTEM_ADMIN',
    lastActiveAt: u.lastActiveAt || null,
    createdAt: u.createdAt || null,
    updatedAt: u.updatedAt || null,
    avatar: u.avatar || '',
    personalVaultInitialized: u.personalVaultInitialized === true,
  };
}
