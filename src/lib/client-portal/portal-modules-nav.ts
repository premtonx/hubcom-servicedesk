/**
 * Pure Kunden-Portal module flags for Sicherer Austausch & Tresor.
 * No I/O — safe in React client bundles and isolation tests.
 */

export type PortalEnabledModules = {
  hardwareReturns?: boolean;
  secureExchange?: boolean;
  vault?: boolean;
};

export function isSecureExchangeEnabled(org: {
  secure_exchange_enabled?: boolean | null;
} | null | undefined): boolean {
  // Default ON when column missing (legacy rows before migration).
  if (!org || org.secure_exchange_enabled == null) return true;
  return org.secure_exchange_enabled === true;
}

export function isVaultEnabled(org: {
  vault_enabled?: boolean | null;
} | null | undefined): boolean {
  if (!org || org.vault_enabled == null) return true;
  return org.vault_enabled === true;
}

/** Resolve flags from /api/portal/me or /api/portal/organization payload. */
export function resolveSecureExchangeModuleFlag(
  payload:
    | {
        enabledModules?: PortalEnabledModules | null;
        organization?: {
          secure_exchange_enabled?: boolean;
          enabledModules?: PortalEnabledModules;
        } | null;
        secure_exchange_enabled?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!payload) return true;
  if (payload.enabledModules?.secureExchange === false) return false;
  if (payload.organization?.enabledModules?.secureExchange === false) return false;
  if (payload.organization?.secure_exchange_enabled === false) return false;
  if (payload.secure_exchange_enabled === false) return false;
  if (payload.enabledModules?.secureExchange === true) return true;
  if (payload.organization?.enabledModules?.secureExchange === true) return true;
  if (payload.organization?.secure_exchange_enabled === true) return true;
  if (payload.secure_exchange_enabled === true) return true;
  // Missing → treat as enabled (default true).
  return true;
}

export function resolveVaultModuleFlag(
  payload:
    | {
        enabledModules?: PortalEnabledModules | null;
        organization?: {
          vault_enabled?: boolean;
          enabledModules?: PortalEnabledModules;
        } | null;
        vault_enabled?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!payload) return true;
  if (payload.enabledModules?.vault === false) return false;
  if (payload.organization?.enabledModules?.vault === false) return false;
  if (payload.organization?.vault_enabled === false) return false;
  if (payload.vault_enabled === false) return false;
  if (payload.enabledModules?.vault === true) return true;
  if (payload.organization?.enabledModules?.vault === true) return true;
  if (payload.organization?.vault_enabled === true) return true;
  if (payload.vault_enabled === true) return true;
  return true;
}

export function evaluatePortalExchangePageAccess(params: {
  sessionLoading: boolean;
  moduleLoading: boolean;
  isClient: boolean;
  moduleEnabled: boolean | null;
}):
  | { action: 'spinner' }
  | { action: 'allow' }
  | { action: 'redirect'; to: '/dashboard' | '/portal/dashboard' } {
  if (params.sessionLoading || params.moduleLoading) return { action: 'spinner' };
  if (!params.isClient) return { action: 'redirect', to: '/dashboard' };
  if (params.moduleEnabled !== true) return { action: 'redirect', to: '/portal/dashboard' };
  return { action: 'allow' };
}

export function evaluatePortalVaultPageAccess(params: {
  sessionLoading: boolean;
  moduleLoading: boolean;
  isClient: boolean;
  role: string | null | undefined;
  moduleEnabled: boolean | null;
}):
  | { action: 'spinner' }
  | { action: 'allow' }
  | { action: 'redirect'; to: '/dashboard' | '/portal/dashboard' } {
  if (params.sessionLoading || params.moduleLoading) return { action: 'spinner' };
  if (!params.isClient) return { action: 'redirect', to: '/dashboard' };
  const role = String(params.role || '').trim();
  const isOrgWide = role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER';
  if (!isOrgWide) return { action: 'redirect', to: '/portal/dashboard' };
  if (params.moduleEnabled !== true) return { action: 'redirect', to: '/portal/dashboard' };
  return { action: 'allow' };
}

/**
 * Backend module gate for /api/portal/exchange* and /api/portal/vault*.
 * Disabled module → 403 (per product spec); role failures also 403.
 */
export function evaluateSecureExchangeModuleAccess(params: {
  orgEnabled: boolean;
  sessionOrgId: string | null | undefined;
  role: string | null | undefined;
}): { ok: true } | { ok: false; status: 403; error: string } {
  if (!params.orgEnabled) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Sicherer Austausch is disabled for this organization.',
    };
  }
  const role = String(params.role || '');
  if (
    role !== 'CLIENT_ADMIN' &&
    role !== 'CLIENT_SUPPORTER' &&
    role !== 'CLIENT_USER'
  ) {
    return { ok: false, status: 403, error: 'Forbidden: Client portal role required.' };
  }
  if (!params.sessionOrgId) {
    return { ok: false, status: 403, error: 'Forbidden: Organization missing.' };
  }
  return { ok: true };
}

export function evaluateVaultModuleAccess(params: {
  orgEnabled: boolean;
  sessionOrgId: string | null | undefined;
  role: string | null | undefined;
}): { ok: true } | { ok: false; status: 403; error: string } {
  if (!params.orgEnabled) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Tresor is disabled for this organization.',
    };
  }
  const role = String(params.role || '');
  if (role !== 'CLIENT_ADMIN' && role !== 'CLIENT_SUPPORTER') {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Tresor requires CLIENT_ADMIN or CLIENT_SUPPORTER.',
    };
  }
  if (!params.sessionOrgId) {
    return { ok: false, status: 403, error: 'Forbidden: Organization missing.' };
  }
  return { ok: true };
}

/** Sidebar visibility helpers (unit-testable). */
export function portalSidebarShowsSecureExchange(moduleEnabled: boolean): boolean {
  return moduleEnabled === true;
}

export function portalSidebarShowsVault(params: {
  isOrgWide: boolean;
  moduleEnabled: boolean;
}): boolean {
  return params.isOrgWide && params.moduleEnabled === true;
}
