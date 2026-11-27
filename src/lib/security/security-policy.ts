/**
 * Pure security perimeter policy helpers — safe for unit tests (no DB).
 */

export type SecuritySeverity = 'info' | 'warning' | 'critical';
export type SecurityBanType = 'ip' | 'account';

export const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_FAIL_THRESHOLD = 5;

export const CROSS_TENANT_403_WINDOW_MS = 5 * 60 * 1000;
export const CROSS_TENANT_403_THRESHOLD = 10;

export const HONEYPOT_BAN_MS = 24 * 60 * 60 * 1000;
export const CROSS_TENANT_BAN_MS = 60 * 60 * 1000;

/** Progressive lockout durations after consecutive lockout events. */
export const PROGRESSIVE_LOCKOUT_MS = [
  15 * 60 * 1000, // 1st → 15 min
  60 * 60 * 1000, // 2nd → 1 hour
  24 * 60 * 60 * 1000, // 3rd+ → 24 hours
] as const;

export const LOCKOUT_MESSAGE_DE =
  'Zu viele fehlgeschlagene Anmeldeversuche. Zugriff vorübergehend gesperrt.';

export const BAN_ACTIVE_MESSAGE_DE =
  'Zugriff gesperrt. Bitte wenden Sie sich an einen Administrator.';

export const HONEYPOT_MESSAGE_DE = 'Zugriff verweigert.';

/** Common exploit / scanner paths — immediate honeypot ban. */
export const HONEYPOT_PATHS: readonly string[] = [
  '/.env',
  '/.git/config',
  '/.git/HEAD',
  '/wp-login.php',
  '/wp-admin',
  '/phpmyadmin',
  '/actuator/env',
  '/xmlrpc.php',
];

export function normalizeRequestPath(raw: string | null | undefined): string {
  const path = String(raw || '').split('?')[0] || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

export function isHoneypotPath(rawPath: string | null | undefined): boolean {
  const path = normalizeRequestPath(rawPath).toLowerCase();
  return HONEYPOT_PATHS.some((probe) => {
    const p = probe.toLowerCase();
    return path === p || path.startsWith(`${p}/`);
  });
}

/** strikeCount = number of prior lockouts for this target (0-based → first lockout). */
export function progressiveLockoutMs(priorStrikeCount: number): number {
  const idx = Math.max(0, Math.min(PROGRESSIVE_LOCKOUT_MS.length - 1, priorStrikeCount));
  return PROGRESSIVE_LOCKOUT_MS[idx];
}

export function shouldTriggerLoginLockout(failCountInWindow: number): boolean {
  return failCountInWindow >= LOGIN_FAIL_THRESHOLD;
}

export function shouldTriggerCrossTenantBan(forbiddenCountInWindow: number): boolean {
  return forbiddenCountInWindow >= CROSS_TENANT_403_THRESHOLD;
}

/** Sliding-window counter helper for tests and in-memory trackers. */
export function countEventsInWindow(
  timestamps: number[],
  nowMs: number,
  windowMs: number,
): number {
  const cutoff = nowMs - windowMs;
  return timestamps.filter((t) => t >= cutoff).length;
}

export function appendEventInWindow(
  timestamps: number[],
  nowMs: number,
  windowMs: number,
): number[] {
  const cutoff = nowMs - windowMs;
  return [...timestamps.filter((t) => t >= cutoff), nowMs];
}

export type CsrfCheckResult = { ok: true } | { ok: false; reason: string };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origin/Referer CSRF check for cookie-authenticated state changes.
 * When Origin is absent (non-browser clients), allow if Referer matches or
 * if neither is present (CLI/tests) — browsers always send Origin on CORS POSTs.
 */
export function evaluateCsrfOrigin(params: {
  method: string;
  origin?: string | null;
  referer?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  allowedOrigins?: string[];
}): CsrfCheckResult {
  const method = String(params.method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return { ok: true };

  const host = String(params.forwardedHost || params.host || '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!host) return { ok: true }; // no Host header → non-HTTP test context

  const allowed = new Set(
    (params.allowedOrigins || [])
      .map((o) => {
        try {
          return new URL(o).host.toLowerCase();
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );
  allowed.add(host);

  const origin = String(params.origin || '').trim();
  if (origin) {
    try {
      const oh = new URL(origin).host.toLowerCase();
      if (allowed.has(oh)) return { ok: true };
      return { ok: false, reason: 'origin_mismatch' };
    } catch {
      return { ok: false, reason: 'origin_invalid' };
    }
  }

  const referer = String(params.referer || '').trim();
  if (referer) {
    try {
      const rh = new URL(referer).host.toLowerCase();
      if (allowed.has(rh)) return { ok: true };
      return { ok: false, reason: 'referer_mismatch' };
    } catch {
      return { ok: false, reason: 'referer_invalid' };
    }
  }

  // No Origin/Referer — allow for same-site cookie + non-browser clients.
  return { ok: true };
}

export function isSecurityAutobanDisabled(): boolean {
  const raw = String(process.env.SECURITY_AUTOBAN_DISABLED || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/** Soft delay for Hubcom core admins after repeated failed logins (never a hard ban). */
export const ADMIN_FAILED_LOGIN_COOLDOWN_MS = 2_000;

/**
 * Comma-separated trusted admin / office IPs that must never receive automatic
 * IP bans (honeypot, login lockout, cross-tenant probes).
 */
export function parseAdminIpAllowlist(
  raw: string | null | undefined = process.env.ADMIN_IP_ALLOWLIST,
): string[] {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminIpAllowlisted(
  ip: string | null | undefined,
  allowlist: string[] = parseAdminIpAllowlist(),
): boolean {
  const normalized = String(ip || '').trim().toLowerCase();
  if (!normalized || allowlist.length === 0) return false;
  return allowlist.includes(normalized);
}

/** Roles that must never be auto-banned (account lockouts). */
export function isHubcomCoreAdminRole(role: string | null | undefined): boolean {
  const r = String(role || '').trim().toUpperCase();
  return (
    r === 'SUPER_ADMIN' ||
    r === 'SYSTEM_ADMIN' ||
    r === 'HUBCOM_ADMIN' ||
    r === 'ADMIN' ||
    r === 'ADMINISTRATOR'
  );
}

export function shouldApplyAdminLoginCooldown(failCountInWindow: number): boolean {
  return failCountInWindow >= LOGIN_FAIL_THRESHOLD;
}
