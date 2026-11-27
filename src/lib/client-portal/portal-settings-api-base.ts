/**
 * Resolve portal vs admin API bases for shared Kunden-Portal settings panels.
 * Portal mode → /api/portal/* ; Admin mode → /api/admin/organizations/:orgId/portal-*.
 */

export type PortalSettingsMode = 'portal' | 'admin';

export type PortalSettingsPaths = {
  mode: PortalSettingsMode;
  organizationId: string | null;
  /** Branding load (GET) */
  brandingGet: string;
  brandingPut: string;
  logoPost: string;
  logoDelete: string;
  faviconPost: string;
  faviconDelete: string;
  bannerPost: string;
  bannerDelete: string;
  modulesPut: string;
  hardwarePut: string;
  membersBase: string;
  memberById: (userId: string) => string;
  memberApprove: (userId: string) => string;
  memberReject: (userId: string) => string;
  memberResetPassword: (userId: string) => string;
  emailGet: string;
  emailPut: string;
  emailTest: string;
  /** Portal-only SSO/notifications (admin folds into emailPut). */
  emailSsoPut: string | null;
  notificationsPut: string | null;
  secondLevelTest: string | null;
};

export function resolvePortalSettingsPaths(
  mode: PortalSettingsMode,
  organizationId?: string | null,
): PortalSettingsPaths {
  if (mode === 'admin') {
    const orgId = String(organizationId || '').trim();
    if (!orgId) {
      throw new Error('organizationId is required for admin portal settings.');
    }
    const base = `/api/admin/organizations/${encodeURIComponent(orgId)}`;
    return {
      mode,
      organizationId: orgId,
      brandingGet: `${base}/portal-branding`,
      brandingPut: `${base}/portal-branding`,
      logoPost: `${base}/portal-branding/logo`,
      logoDelete: `${base}/portal-branding/logo`,
      faviconPost: `${base}/portal-branding/favicon`,
      faviconDelete: `${base}/portal-branding/favicon`,
      bannerPost: `${base}/portal-branding/banner`,
      bannerDelete: `${base}/portal-branding/banner`,
      modulesPut: `${base}/portal-modules`,
      hardwarePut: `${base}/hardware-returns`,
      membersBase: `${base}/portal-members`,
      memberById: (userId) => `${base}/portal-members/${encodeURIComponent(userId)}`,
      memberApprove: (userId) =>
        `${base}/portal-members/${encodeURIComponent(userId)}/approve`,
      memberReject: (userId) =>
        `${base}/portal-members/${encodeURIComponent(userId)}/reject`,
      memberResetPassword: (userId) =>
        `${base}/users/${encodeURIComponent(userId)}/reset-password`,
      emailGet: `${base}/portal-email`,
      emailPut: `${base}/portal-email`,
      emailTest: `${base}/portal-email/test`,
      emailSsoPut: null,
      notificationsPut: null,
      secondLevelTest: null,
    };
  }

  return {
    mode: 'portal',
    organizationId: organizationId || null,
    brandingGet: '/api/portal/organization',
    brandingPut: '/api/portal/organization/branding',
    logoPost: '/api/portal/organization/logo',
    logoDelete: '/api/portal/organization/logo',
    faviconPost: '/api/portal/branding/favicon',
    faviconDelete: '/api/portal/branding/favicon',
    bannerPost: '/api/portal/branding/banner',
    bannerDelete: '/api/portal/branding/banner',
    modulesPut: '/api/portal/organization/modules',
    hardwarePut: '/api/portal/organization/hardware-returns',
    membersBase: '/api/portal/team',
    memberById: (userId) => `/api/portal/team/${encodeURIComponent(userId)}`,
    memberApprove: (userId) =>
      `/api/portal/team/${encodeURIComponent(userId)}/approve`,
    memberReject: (userId) =>
      `/api/portal/team/${encodeURIComponent(userId)}/reject`,
    memberResetPassword: (userId) =>
      `/api/portal/team/${encodeURIComponent(userId)}/reset-password`,
    emailGet: '/api/portal/email-channel',
    emailPut: '/api/portal/email-channel',
    emailTest: '/api/portal/email-channel/test',
    emailSsoPut: '/api/portal/email-channel/sso',
    notificationsPut: '/api/portal/settings/notifications',
    secondLevelTest: '/api/portal/settings/second-level-test',
  };
}

/** Assert portal paths never include /api/db (test + runtime guard). */
export function assertPortalSettingsPathsSafe(paths: PortalSettingsPaths): boolean {
  const values = Object.values(paths).flatMap((v) =>
    typeof v === 'function' ? [v('x')] : v == null ? [] : [String(v)],
  );
  return values.every((p) => !p.includes('/api/db'));
}
