/** Derive portal invitation lifecycle from user document fields. */

export type PortalInvitationStatus =
  | 'pending'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'failed'
  | 'none';

export function deriveInvitationStatus(user: {
  passwordHash?: string | null;
  activationToken?: string | null;
  activationTokenExpires?: string | null;
  invitationEmailSent?: boolean | null;
  invitationEmailFailed?: boolean | null;
  lastLoginAt?: string | null;
  lastActiveAt?: string | null;
}): PortalInvitationStatus {
  const token = String(user.activationToken || '').trim();
  const expiresAt = user.activationTokenExpires
    ? new Date(String(user.activationTokenExpires)).getTime()
    : NaN;
  const hasPassword = Boolean(user.passwordHash);
  const loggedIn = Boolean(user.lastLoginAt || user.lastActiveAt);

  if (hasPassword && !token) {
    return loggedIn || hasPassword ? 'accepted' : 'accepted';
  }
  if (token && Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    return 'expired';
  }
  if (token && user.invitationEmailFailed) {
    return 'failed';
  }
  if (token && user.invitationEmailSent) {
    return 'sent';
  }
  if (token) {
    return 'pending';
  }
  if (hasPassword) return 'accepted';
  return 'none';
}
