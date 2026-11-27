/**
 * Perimeter middleware: honeypot traps, active ban enforcement,
 * CSRF/origin checks, and cross-tenant 403 strike tracking.
 */

import type { NextFunction, Request, Response } from 'express';
import { getTrustedClientIp } from '../lib/security/client-ip.js';
import {
  BAN_ACTIVE_MESSAGE_DE,
  HONEYPOT_MESSAGE_DE,
  LOCKOUT_MESSAGE_DE,
  evaluateCsrfOrigin,
  isAdminIpAllowlisted,
  isHoneypotPath,
  isHubcomCoreAdminRole,
  isSecurityAutobanDisabled,
  normalizeRequestPath,
} from '../lib/security/security-policy.js';
import {
  applyCrossTenantBan,
  applyHoneypotBan,
  findActiveBan,
  lookupActiveUserRoleByEmail,
  recordForbidden403,
  writeSecurityAuditLog,
} from '../lib/security/security-store.js';

const CSRF_EXEMPT_PREFIXES = [
  '/api/webhooks',
  '/api/teams',
  '/api/health',
];

function isCsrfExempt(path: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Early: enforce active bans + honeypot traps. */
export async function securityBanAndHoneypotMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getTrustedClientIp(req);
    (req as any).clientIp = ip;

    if (!isSecurityAutobanDisabled() && !isAdminIpAllowlisted(ip)) {
      const ipBan = await findActiveBan('ip', ip);
      if (ipBan) {
        res.setHeader('Retry-After', retryAfterSeconds(ipBan.banned_until));
        res.status(429).json({ error: BAN_ACTIVE_MESSAGE_DE, ban: true });
        return;
      }
    }

    const path = normalizeRequestPath(req.path || req.url);
    if (!isSecurityAutobanDisabled() && isHoneypotPath(path)) {
      await applyHoneypotBan({ ip, path, method: req.method });
      res.status(403).json({ error: HONEYPOT_MESSAGE_DE });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}

/** CSRF / Origin check for cookie-authenticated state changes. */
export function csrfOriginMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = normalizeRequestPath(req.path || req.url);
  if (isCsrfExempt(path)) {
    next();
    return;
  }

  const allowedEnv = String(process.env.CSRF_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const result = evaluateCsrfOrigin({
    method: req.method,
    origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
    referer: typeof req.headers.referer === 'string' ? req.headers.referer : null,
    host: typeof req.headers.host === 'string' ? req.headers.host : null,
    forwardedHost:
      typeof req.headers['x-forwarded-host'] === 'string'
        ? req.headers['x-forwarded-host']
        : null,
    allowedOrigins: allowedEnv,
  });

  if (result.ok === false) {
    void writeSecurityAuditLog({
      event_type: 'csrf_blocked',
      severity: 'warning',
      ip_address: getTrustedClientIp(req),
      path,
      method: req.method,
      details: { reason: result.reason },
    });
    res.status(403).json({ error: 'Ungültige Anfragequelle (CSRF-Schutz).' });
    return;
  }
  next();
}

/**
 * After response finishes: track 403s for cross-tenant probing.
 * Mount after routes so it can observe status codes via `res.on('finish')`.
 */
export function crossTenant403TrackerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isSecurityAutobanDisabled()) {
    next();
    return;
  }

  res.on('finish', () => {
    if (res.statusCode !== 403) return;
    const path = normalizeRequestPath(req.path || req.url);
    // Skip honeypot / auth SSO gate 403 noise that is intentional product UX
    if (isHoneypotPath(path)) return;
    if (path.startsWith('/api/auth/')) return;

    const ip = (req as any).clientIp || getTrustedClientIp(req);
    const userId = (req as any).user?.id || null;
    const role = (req as any).user?.role || null;

    void (async () => {
      try {
        const strike = recordForbidden403({ ip, userId });
        if (!strike.banTriggered) return;
        for (const t of strike.banTargets) {
          await applyCrossTenantBan({
            ban_type: t.ban_type,
            target: t.target,
            ip,
            user_id: userId,
            role,
            path,
            method: req.method,
            count: t.ban_type === 'ip' ? strike.ipCount : strike.userCount,
          });
        }
      } catch {
        /* non-fatal */
      }
    })();
  });

  next();
}

/** Check account ban by email before login attempt proceeds. */
export async function assertLoginNotBanned(params: {
  ip: string;
  email: string;
}): Promise<{ banned: boolean; message?: string }> {
  if (isSecurityAutobanDisabled()) return { banned: false };
  if (isAdminIpAllowlisted(params.ip)) return { banned: false };

  const role = await lookupActiveUserRoleByEmail(params.email);
  if (isHubcomCoreAdminRole(role)) return { banned: false };

  const ipBan = await findActiveBan('ip', params.ip);
  if (ipBan) {
    return { banned: true, message: LOCKOUT_MESSAGE_DE };
  }
  const accountBan = await findActiveBan('account', params.email.toLowerCase());
  if (accountBan) {
    return { banned: true, message: LOCKOUT_MESSAGE_DE };
  }
  return { banned: false };
}

function retryAfterSeconds(bannedUntil: string | null): string {
  if (!bannedUntil) return String(24 * 60 * 60);
  const ms = Date.parse(bannedUntil) - Date.now();
  return String(Math.max(60, Math.ceil(ms / 1000)));
}

export { LOCKOUT_MESSAGE_DE };
