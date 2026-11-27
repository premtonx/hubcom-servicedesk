import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { getTrustedClientIp } from '../lib/security/client-ip.js';
import { SESSION_COOKIE_NAME } from '../lib/session-cookie.js';

const isProd = process.env.NODE_ENV === 'production';

/** Stable per-IP key that correctly folds IPv6 (express-rate-limit v8+). */
function ipKey(req: Request): string {
  const ip = getTrustedClientIp(req) || req.ip || req.socket?.remoteAddress || 'unknown';
  try {
    return ipKeyGenerator(ip);
  } catch {
    return ip;
  }
}

function userOrIpKey(req: Request): string {
  const userId = (req as any).user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${ipKey(req)}`;
}

/**
 * Lightweight SPA bootstrap GETs that fan out on every page load.
 * Skipping them avoids false-positive 429s without weakening auth endpoints.
 * Paths are relative to the `/api` mount used by generalApiRateLimiter.
 */
export const GENERAL_API_RATE_LIMIT_SKIP_PATHS = new Set([
  '/auth/session',
  '/admin/onboarding/status',
  '/admin/system-favicon',
  '/portal/branding/system-favicon',
  '/health',
]);

/** Production floor for the general `/api/*` sliding window (per IP). */
export const GENERAL_API_RATE_LIMIT_PER_MINUTE = 600;

/** Auth/credential endpoints: requests per minute per IP. */
export const CREDENTIAL_RATE_LIMIT_PER_MINUTE = 30;

function hasSessionCookie(req: Request): boolean {
  const fromParser = (req as any).cookies?.[SESSION_COOKIE_NAME];
  if (typeof fromParser === 'string' && fromParser.trim()) return true;
  const raw = String(req.headers.cookie || '');
  return new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`).test(raw);
}

export function shouldSkipGeneralApiRateLimit(req: Request): boolean {
  const path = String(req.path || '').split('?')[0];
  if (GENERAL_API_RATE_LIMIT_SKIP_PATHS.has(path)) return true;

  // Authenticated reads (dashboard SPA fan-out) — do not burn the shared IP budget.
  const method = String(req.method || 'GET').toUpperCase();
  if ((method === 'GET' || method === 'HEAD') && hasSessionCookie(req)) {
    return true;
  }
  return false;
}

/** Brute-force protection for credential endpoints (15-minute window). */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: {
    error: 'Zu viele Authentifizierungsversuche. Bitte später erneut versuchen.',
  },
});

/**
 * Tight per-IP limit for auth + onboarding credential endpoints
 * (30 requests / minute). Failed-login lockout (5 / 15 min) is separate
 * in the security perimeter. In-memory per-process; swap to Redis when scaling.
 */
export const credentialRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: CREDENTIAL_RATE_LIMIT_PER_MINUTE,
  keyGenerator: ipKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte in einer Minute erneut versuchen.' },
});

/** Protect public vault reveal/upload capability endpoints. */
export const vaultRevealRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProd ? 30 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Zu viele Tresor-Zugriffe. Bitte später erneut versuchen.' },
});

/** Limit unauthenticated webhook abuse. */
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? 60 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Webhook-Rate-Limit überschritten.' },
});

/** Sandbox / AI test harness — tighter in production when enabled. */
export const sandboxRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? 10 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'Sandbox-Rate-Limit überschritten.' },
});

/** AI routes — per user or IP sliding window. */
export const aiRouteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? 30 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'KI-Rate-Limit überschritten. Bitte kurz warten.' },
});

/**
 * General API sliding window (per IP). Floor 600/min in production so SPA
 * page loads + parallel queries never false-positive 429. Lightweight
 * session/status/favicon paths and authenticated GETs are skipped.
 */
export const generalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? GENERAL_API_RATE_LIMIT_PER_MINUTE : Math.max(GENERAL_API_RATE_LIMIT_PER_MINUTE, 2000),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  skip: shouldSkipGeneralApiRateLimit,
  message: { error: 'API-Rate-Limit überschritten. Bitte kurz warten.' },
});
