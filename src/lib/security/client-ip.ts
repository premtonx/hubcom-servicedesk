/**
 * Trusted-proxy-aware client IP resolution.
 *
 * Only honor CF-Connecting-IP / X-Forwarded-For when TRUST_PROXY is enabled
 * (or a trusted hop count is set). Otherwise use the direct socket address so
 * rate limits and IP bans never accidentally target the Docker/Nginx proxy.
 */

import type { Request } from 'express';

export function isTrustProxyEnabled(): boolean {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}

/** Express `trust proxy` setting: false | number of hops | true. */
export function resolveExpressTrustProxy(): boolean | number {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!raw || raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return 1;
  }
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  // "loopback", "uniquelocal", etc. — Express accepts string settings; we stick to hops.
  return 1;
}

function firstForwardedIp(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value.join(',') : value;
  const first = raw.split(',')[0]?.trim() || '';
  return first || null;
}

/**
 * Resolve the real client IP for rate limiting / bans.
 * Prefer Cloudflare header when present and trust is on, then X-Forwarded-For,
 * then Express `req.ip`, then the socket address.
 */
export function getTrustedClientIp(req: Request): string {
  const trust = isTrustProxyEnabled();
  if (trust) {
    const cf = firstForwardedIp(req.headers['cf-connecting-ip']);
    if (cf) return cf;
    const xff = firstForwardedIp(req.headers['x-forwarded-for']);
    if (xff) return xff;
  }
  const fromExpress = typeof req.ip === 'string' ? req.ip.trim() : '';
  if (fromExpress) return fromExpress;
  return (
    req.socket?.remoteAddress ||
    (req as { connection?: { remoteAddress?: string } }).connection?.remoteAddress ||
    'unknown'
  );
}
