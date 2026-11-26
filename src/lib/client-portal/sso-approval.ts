/**
 * Pure M365 SSO Admin-Freigabe helpers (unit-testable, no I/O).
 *
 * Modes (org setting `sso_approval_mode`):
 *   - admin_approval       — new tenants users → pending until Admin freigibt (default when SSO on)
 *   - pre_provisioned_only — only users already in Mitarbeiter & Rollen may sign in
 *   - auto_domain          — legacy auto-join (JIT active CLIENT_USER)
 */

import { isClientPortalRole } from './roles.js';

export const SSO_APPROVAL_MODES = [
  'admin_approval',
  'pre_provisioned_only',
  'auto_domain',
] as const;

export type SsoApprovalMode = (typeof SSO_APPROVAL_MODES)[number];

export const PORTAL_APPROVAL_STATUSES = [
  'active',
  'pending_approval',
  'rejected',
] as const;

export type PortalApprovalStatus = (typeof PORTAL_APPROVAL_STATUSES)[number];

export type PortalSsoStatusQuery =
  | 'pending'
  | 'rejected'
  | 'not_invited'
  | 'unknown_tenant'
  | 'sso_disabled'
  | 'deactivated';

export function normalizeSsoApprovalMode(raw: unknown): SsoApprovalMode | null {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (value === 'admin_approval' || value === 'admin' || value === 'approval') {
    return 'admin_approval';
  }
  if (
    value === 'pre_provisioned_only' ||
    value === 'pre_provisioned' ||
    value === 'invite_only' ||
    value === 'invited_only'
  ) {
    return 'pre_provisioned_only';
  }
  if (value === 'auto_domain' || value === 'auto' || value === 'open' || value === 'legacy') {
    return 'auto_domain';
  }
  return null;
}

/**
 * Resolve org SSO approval mode.
 * Default when SSO is enabled and unset: admin_approval (recommended).
 */
export function resolveSsoApprovalMode(org: {
  sso_enabled?: boolean;
  sso_approval_mode?: unknown;
  settings?: Record<string, unknown> | null;
} | null | undefined): SsoApprovalMode {
  if (!org) return 'admin_approval';
  const fromColumn = normalizeSsoApprovalMode(org.sso_approval_mode);
  if (fromColumn) return fromColumn;
  const settings = org.settings && typeof org.settings === 'object' ? org.settings : {};
  const fromSettings = normalizeSsoApprovalMode(
    settings.sso_approval_mode ?? settings.ssoApprovalMode,
  );
  if (fromSettings) return fromSettings;
  // Recommended default whenever SSO is (or will be) used.
  return 'admin_approval';
}

export function normalizeApprovalStatus(raw: unknown): PortalApprovalStatus {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (value === 'pending_approval' || value === 'pending' || value === 'awaiting') {
    return 'pending_approval';
  }
  if (value === 'rejected' || value === 'denied' || value === 'blocked') {
    return 'rejected';
  }
  // Missing / legacy / explicit active → active (existing users stay usable).
  return 'active';
}

export function isPortalLoginAllowed(user: {
  isDeactivated?: boolean;
  approval_status?: unknown;
  approvalStatus?: unknown;
  role?: string | null;
} | null | undefined): { ok: true } | { ok: false; reason: PortalSsoStatusQuery } {
  if (!user) return { ok: false, reason: 'not_invited' };
  if (user.isDeactivated === true) return { ok: false, reason: 'deactivated' };
  const status = normalizeApprovalStatus(user.approval_status ?? user.approvalStatus);
  if (status === 'pending_approval') return { ok: false, reason: 'pending' };
  if (status === 'rejected') return { ok: false, reason: 'rejected' };
  return { ok: true };
}

export function canManageSsoApprovals(role: string | null | undefined): boolean {
  return role === 'CLIENT_ADMIN' || role === 'SYSTEM_ADMIN';
}

/** CLIENT_SUPPORTER may edit tickets/returns but not team/SSO/branding admin. */
export function clientSupporterMayAccessPortalTicketsAndReturns(
  role: string | null | undefined,
): boolean {
  return role === 'CLIENT_SUPPORTER' || role === 'CLIENT_ADMIN';
}

export function clientSupporterBlockedFromAdminSettings(
  role: string | null | undefined,
): boolean {
  return role === 'CLIENT_SUPPORTER';
}

export type PortalSsoDecision =
  | { action: 'login'; userId: string; redirect: '/portal/dashboard' | '/tickets' }
  | {
      action: 'jit_pending';
      role: 'CLIENT_USER';
      organizationId: string;
      approval_status: 'pending_approval';
    }
  | {
      action: 'jit_active';
      role: 'CLIENT_USER';
      organizationId: string;
      approval_status: 'active';
    }
  | { action: 'reject'; code: PortalSsoStatusQuery; issueSession: false };

/**
 * Decide portal SSO outcome for a linked-tenant login attempt.
 * Call only after Entra tid was mapped to an SSO-enabled organization (or rejected).
 */
export function decidePortalSsoProvisioning(input: {
  org: {
    id: string;
    sso_enabled?: boolean;
    sso_approval_mode?: unknown;
    settings?: Record<string, unknown> | null;
  } | null;
  existingUser: {
    id: string;
    role?: string | null;
    organizationId?: string | null;
    organization_id?: string | null;
    approval_status?: unknown;
    approvalStatus?: unknown;
    isDeactivated?: boolean;
  } | null;
  /** True when Entra tid maps to this org (already validated by caller). */
  tenantLinked: boolean;
}): PortalSsoDecision {
  if (!input.tenantLinked || !input.org) {
    return { action: 'reject', code: 'unknown_tenant', issueSession: false };
  }
  if (!input.org.sso_enabled) {
    return { action: 'reject', code: 'sso_disabled', issueSession: false };
  }

  const mode = resolveSsoApprovalMode(input.org);
  const user = input.existingUser;

  if (user) {
    const orgId =
      (typeof user.organizationId === 'string' && user.organizationId) ||
      (typeof user.organization_id === 'string' && user.organization_id) ||
      '';
    if (orgId && orgId !== input.org.id && isClientPortalRole(user.role)) {
      return { action: 'reject', code: 'unknown_tenant', issueSession: false };
    }
    const gate = isPortalLoginAllowed(user);
    if (gate.ok === false) {
      return { action: 'reject', code: gate.reason, issueSession: false };
    }
    const redirect =
      isClientPortalRole(user.role) || String(user.role || '') === 'customer'
        ? '/portal/dashboard'
        : '/tickets';
    return { action: 'login', userId: user.id, redirect };
  }

  // Brand-new user from linked tenant
  if (mode === 'pre_provisioned_only') {
    return { action: 'reject', code: 'not_invited', issueSession: false };
  }
  if (mode === 'admin_approval') {
    return {
      action: 'jit_pending',
      role: 'CLIENT_USER',
      organizationId: input.org.id,
      approval_status: 'pending_approval',
    };
  }
  // auto_domain — legacy JIT active
  return {
    action: 'jit_active',
    role: 'CLIENT_USER',
    organizationId: input.org.id,
    approval_status: 'active',
  };
}

export function portalSsoStatusRedirectPath(
  code: PortalSsoStatusQuery,
  origin: string,
): string {
  // Prefer /portal/login (alias of LoginPage); query drives German banners.
  return `${origin}/portal/login?sso_status=${encodeURIComponent(code)}`;
}

export const SSO_STATUS_BANNER_DE: Record<PortalSsoStatusQuery, string> = {
  pending:
    'Ihre Zugriffsanfrage über Microsoft 365 wurde übermittelt. Ein Administrator muss Ihren Zugang und Ihre Rolle zuerst freigeben.',
  rejected:
    'Ihre Microsoft-365-Zugriffsanfrage wurde abgelehnt. Bitte wenden Sie sich an Ihren Administrator.',
  not_invited:
    'Für Ihr Microsoft-365-Konto ist noch kein Zugang hinterlegt. Bitte lassen Sie sich von einem Administrator in „Mitarbeiter & Rollen“ anlegen.',
  unknown_tenant:
    'Unbekannter oder nicht verknüpfter Microsoft-365-Mandant. Bitte kontaktieren Sie Hubcom.',
  sso_disabled:
    'Microsoft-365-Anmeldung ist für Ihre Organisation derzeit nicht aktiviert.',
  deactivated:
    'Ihr Konto wurde deaktiviert. Bitte wenden Sie sich an den Administrator.',
};

export const PORTAL_ROLE_APPROVAL_OPTIONS: Array<{
  role: 'CLIENT_ADMIN' | 'CLIENT_SUPPORTER' | 'CLIENT_USER';
  label: string;
  description: string;
}> = [
  {
    role: 'CLIENT_ADMIN',
    label: 'Admin',
    description: 'Vollzugriff inkl. Portal-Einstellungen, Benutzer & SSO-Freigaben',
  },
  {
    role: 'CLIENT_SUPPORTER',
    label: 'Bearbeiter / Supporter',
    description: 'Tickets & Rücklieferungen ansehen und bearbeiten',
  },
  {
    role: 'CLIENT_USER',
    label: 'Benutzer',
    description: 'Eigene Tickets einsehen & erstellen',
  },
];
