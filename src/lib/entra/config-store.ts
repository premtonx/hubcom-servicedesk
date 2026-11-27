/**
 * Microsoft 365 / Entra ID Einstellungen (geistdesk_documents / entra_settings).
 */

import { getDocDirect, setDocDirect } from '../postgres-backend.js';

export const ENTRA_SETTINGS_COLLECTION = 'entra_settings';
export const ENTRA_SETTINGS_DOC_ID = 'default';

export type EntraDefaultRole =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'HUBCOM_ADMIN'
  | 'HUBCOM_AGENT'
  | 'HUBCOM_USER'
  | 'agent'
  | 'customer';

export interface EntraSettings {
  id: string;
  enabled: boolean;
  tenantId: string;
  clientId: string;
  /** Nur serverseitig; nie an Nicht-Admins. */
  clientSecret?: string | null;
  /** Ob ein Secret gespeichert ist (für Admin-UI). */
  hasClientSecret?: boolean;
  redirectUri: string;
  defaultRole: EntraDefaultRole;
  allowedDomains: string[];
  jitProvisioning: boolean;
  /**
   * Admin-Freigabe für Hubcom-interne M365-Logins (neue Kollegen → pending_approval).
   * Default true.
   */
  staffSsoApprovalRequired: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface EntraSettingsPublic {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  redirectUri: string;
  defaultRole: EntraDefaultRole;
  allowedDomains: string[];
  jitProvisioning: boolean;
  staffSsoApprovalRequired: boolean;
  hasClientSecret: boolean;
  configured: boolean;
  updatedAt?: string;
}

const DEFAULTS: Omit<EntraSettings, 'id'> = {
  enabled: false,
  tenantId: '',
  clientId: '',
  clientSecret: null,
  redirectUri: '',
  defaultRole: 'HUBCOM_USER',
  allowedDomains: [],
  jitProvisioning: false,
  staffSsoApprovalRequired: true,
  updatedAt: new Date(0).toISOString(),
  createdAt: new Date(0).toISOString(),
};

function fromEnvFallback(): Partial<EntraSettings> {
  return {
    tenantId:
      process.env.OIDC_TENANT_ID ||
      process.env.AZURE_TENANT_ID ||
      process.env.MICROSOFT_TENANT_ID ||
      '',
    clientId:
      process.env.OIDC_CLIENT_ID ||
      process.env.MICROSOFT_PROVIDER_CLIENT_ID ||
      process.env.AZURE_CLIENT_ID ||
      '',
    clientSecret:
      process.env.OIDC_CLIENT_SECRET ||
      process.env.MICROSOFT_PROVIDER_CLIENT_SECRET ||
      process.env.AZURE_CLIENT_SECRET ||
      null,
    redirectUri: process.env.OIDC_REDIRECT_URI || '',
  };
}

export function redactEntraSettings(doc: EntraSettings): EntraSettingsPublic {
  const tenantId = (doc.tenantId || '').trim();
  const clientId = (doc.clientId || '').trim();
  const secret = (doc.clientSecret || '').trim();
  return {
    enabled: doc.enabled === true,
    tenantId,
    clientId,
    redirectUri: (doc.redirectUri || '').trim(),
    defaultRole: doc.defaultRole || 'HUBCOM_USER',
    allowedDomains: Array.isArray(doc.allowedDomains) ? doc.allowedDomains : [],
    jitProvisioning: doc.jitProvisioning === true,
    staffSsoApprovalRequired: doc.staffSsoApprovalRequired !== false,
    hasClientSecret: Boolean(secret),
    configured: Boolean(doc.enabled && tenantId && clientId && secret),
    updatedAt: doc.updatedAt,
  };
}

export async function getEntraSettings(): Promise<EntraSettings> {
  const doc = await getDocDirect(ENTRA_SETTINGS_COLLECTION, ENTRA_SETTINGS_DOC_ID);
  const env = fromEnvFallback();
  if (!doc) {
    return {
      id: ENTRA_SETTINGS_DOC_ID,
      ...DEFAULTS,
      tenantId: env.tenantId || '',
      clientId: env.clientId || '',
      clientSecret: env.clientSecret || null,
      redirectUri: env.redirectUri || '',
      enabled: Boolean(env.tenantId && env.clientId && env.clientSecret),
    };
  }
  return {
    id: ENTRA_SETTINGS_DOC_ID,
    enabled: doc.enabled === true,
    tenantId: String(doc.tenantId || env.tenantId || ''),
    clientId: String(doc.clientId || env.clientId || ''),
    clientSecret:
      doc.clientSecret != null && String(doc.clientSecret).trim()
        ? String(doc.clientSecret)
        : env.clientSecret || null,
    redirectUri: String(doc.redirectUri || env.redirectUri || ''),
    defaultRole: (doc.defaultRole as EntraDefaultRole) || 'HUBCOM_USER',
    allowedDomains: Array.isArray(doc.allowedDomains)
      ? doc.allowedDomains.map((d: string) => String(d).toLowerCase().trim()).filter(Boolean)
      : [],
    jitProvisioning: doc.jitProvisioning === true,
    staffSsoApprovalRequired: doc.staffSsoApprovalRequired !== false,
    updatedAt: String(doc.updatedAt || new Date().toISOString()),
    createdAt: String(doc.createdAt || new Date().toISOString()),
  };
}

export async function saveEntraSettings(
  input: Partial<EntraSettings> & { clientSecret?: string | null },
): Promise<EntraSettingsPublic> {
  const existing = await getEntraSettings();
  const now = new Date().toISOString();
  const domains = Array.isArray(input.allowedDomains)
    ? input.allowedDomains.map((d) => String(d).toLowerCase().trim()).filter(Boolean)
    : existing.allowedDomains;

  let clientSecret = existing.clientSecret;
  if (typeof input.clientSecret === 'string') {
    const trimmed = input.clientSecret.trim();
    if (trimmed && trimmed !== '••••••••') {
      clientSecret = trimmed;
    }
  } else if (input.clientSecret === null) {
    clientSecret = null;
  }

  const next: EntraSettings = {
    id: ENTRA_SETTINGS_DOC_ID,
    enabled: input.enabled ?? existing.enabled,
    tenantId: (input.tenantId ?? existing.tenantId ?? '').trim(),
    clientId: (input.clientId ?? existing.clientId ?? '').trim(),
    clientSecret,
    redirectUri: (input.redirectUri ?? existing.redirectUri ?? '').trim(),
    defaultRole: input.defaultRole || existing.defaultRole || 'HUBCOM_USER',
    allowedDomains: domains,
    jitProvisioning: input.jitProvisioning ?? existing.jitProvisioning,
    staffSsoApprovalRequired:
      input.staffSsoApprovalRequired ?? existing.staffSsoApprovalRequired !== false,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };

  await setDocDirect(ENTRA_SETTINGS_COLLECTION, ENTRA_SETTINGS_DOC_ID, next);
  return redactEntraSettings(next);
}

export function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return true;
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  return allowedDomains.some((d) => d === domain || d === `*.${domain}`);
}
