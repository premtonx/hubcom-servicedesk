/** Hilfsfunktionen für Benutzerverwaltung / M365. */

export type ManagedAuthMethod = 'password' | 'microsoft365';
export type ManagedRole = 'SYSTEM_ADMIN' | 'agent' | 'customer';

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
  if (v === 'customer' || v === 'Kunde') return 'customer';
  return 'agent';
}

export function isAdminRole(role: unknown): boolean {
  return normalizeRole(role) === 'SYSTEM_ADMIN';
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

export function formatUserForAdmin(u: Record<string, any>) {
  const authMethod = normalizeAuthMethod(u.authMethod);
  const role = normalizeRole(u.role || (u.is_admin ? 'SYSTEM_ADMIN' : 'agent'));
  return {
    id: u.id,
    name: u.name || '',
    email: u.email || '',
    kuerzel: u.kuerzel || '',
    job_title: u.job_title || u.jobTitle || '',
    phone: u.phone || '',
    role,
    company: u.company || u.customerCompany || '',
    companyId: u.companyId || null,
    contactId: u.contactId || null,
    customerCompany: u.customerCompany || null,
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
