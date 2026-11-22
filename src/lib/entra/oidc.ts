/**
 * Microsoft Entra ID OAuth2/OIDC Authorization-Code + PKCE.
 */

import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import type { EntraSettings } from './config-store.js';

const OIDC_SCOPES = 'openid profile email offline_access User.Read';

export function buildAuthorizeUrl(params: {
  settings: EntraSettings;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
}): string {
  const tenant = params.settings.tenantId.trim() || 'common';
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`;
  const q = new URLSearchParams({
    client_id: params.settings.clientId,
    response_type: 'code',
    redirect_uri: params.redirectUri,
    response_mode: 'query',
    scope: OIDC_SCOPES,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    nonce: params.nonce,
  });
  return `${base}?${q.toString()}`;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function generateOidcState(): string {
  return randomBytes(24).toString('hex');
}

export async function exchangeAuthorizationCode(params: {
  settings: EntraSettings;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{
  access_token?: string;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}> {
  const tenant = params.settings.tenantId.trim() || 'common';
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: params.settings.clientId,
    client_secret: String(params.settings.clientSecret || ''),
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    scope: OIDC_SCOPES,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return (await res.json().catch(() => ({}))) as any;
}

export interface EntraIdClaims {
  oid?: string;
  sub?: string;
  preferred_username?: string;
  email?: string;
  upn?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  tid?: string;
  nonce?: string;
}

export function decodeIdToken(idToken: string): EntraIdClaims {
  const decoded = jwt.decode(idToken) as EntraIdClaims | null;
  return decoded || {};
}

export function claimsToIdentity(claims: EntraIdClaims): {
  entraObjectId: string;
  email: string;
  upn: string;
  name: string;
} {
  const email = String(
    claims.preferred_username || claims.email || claims.upn || '',
  )
    .trim()
    .toLowerCase();
  const upn = String(claims.upn || claims.preferred_username || email)
    .trim()
    .toLowerCase();
  const name =
    String(claims.name || '').trim() ||
    [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim() ||
    email.split('@')[0] ||
    'Benutzer';
  const entraObjectId = String(claims.oid || claims.sub || '').trim();
  return { entraObjectId, email, upn, name };
}
