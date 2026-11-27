import type { Response } from 'express';

export const SESSION_COOKIE_NAME = 'session';
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Secure cookies in production, or when COOKIE_SECURE / HTTPS is forced. */
export function sessionCookieSecure(): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.IS_PROD === 'true') {
    return true;
  }
  const forced = String(process.env.COOKIE_SECURE || '')
    .trim()
    .toLowerCase();
  return forced === '1' || forced === 'true' || forced === 'yes';
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = sessionCookieSecure();
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  const secure = sessionCookieSecure();
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
  });
}
