import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { getTrustedClientIp } from '../lib/security/client-ip.js';

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

/** Brute-force protection for credential endpoints. */
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
 * Phase-1 hardening: tight per-IP limit for auth + onboarding credential
 * endpoints (max 10 requests per minute per IP). In-memory per-process;
 * swap to a shared store (Redis) when scaling horizontally.
 */
export const credentialRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
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

/** General API sliding window (per IP). Higher in non-prod so suites stay green. */
export const generalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProd ? 120 : 2000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: 'API-Rate-Limit überschritten. Bitte kurz warten.' },
});
