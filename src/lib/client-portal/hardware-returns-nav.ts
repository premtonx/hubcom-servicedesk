/**
 * Pure Kunden-Portal / staff navigation helpers for Hardware-Rücklieferungen.
 * No I/O — safe to import from React client bundles.
 */

/**
 * Kunden-Portal `/portal/returns` page gate.
 * Wait for session + `/api/portal/me` module flag before redirecting —
 * premature redirects caused the sidebar link to bounce back to home.
 */
export function evaluatePortalReturnsPageAccess(params: {
  sessionLoading: boolean;
  moduleLoading: boolean;
  isClient: boolean;
  role: string | null | undefined;
  /** Canonical flag from /api/portal/me (`enabledModules.hardwareReturns`). */
  moduleEnabled: boolean | null;
}):
  | { action: 'spinner' }
  | { action: 'allow' }
  | { action: 'redirect'; to: '/dashboard' | '/portal/dashboard' } {
  if (params.sessionLoading || params.moduleLoading) {
    return { action: 'spinner' };
  }
  if (!params.isClient) {
    return { action: 'redirect', to: '/dashboard' };
  }
  const role = String(params.role || '').trim();
  const isOrgWide = role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER';
  if (!isOrgWide) {
    return { action: 'redirect', to: '/portal/dashboard' };
  }
  if (params.moduleEnabled !== true) {
    return { action: 'redirect', to: '/portal/dashboard' };
  }
  return { action: 'allow' };
}

/** Resolve hardware module flag from /api/portal/me (or org branding) payload. */
export function resolveHardwareReturnsModuleFlag(
  payload:
    | {
        enabledModules?: { hardwareReturns?: boolean } | null;
        organization?: {
          hardware_returns_enabled?: boolean;
          enabledModules?: { hardwareReturns?: boolean };
        } | null;
        hardware_returns_enabled?: boolean;
      }
    | null
    | undefined,
): boolean {
  if (!payload) return false;
  if (payload.enabledModules?.hardwareReturns === true) return true;
  if (payload.organization?.enabledModules?.hardwareReturns === true) return true;
  if (payload.organization?.hardware_returns_enabled === true) return true;
  if (payload.hardware_returns_enabled === true) return true;
  return false;
}
