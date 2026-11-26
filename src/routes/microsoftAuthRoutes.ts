/**
 * Microsoft 365 / Entra ID Login (OIDC Authorization Code + PKCE).
 * Mount: /api/auth
 *
 * Portal orgs with linked m365_tenant_id go through Admin-Freigabe gating
 * (sso_approval_mode) — pending/rejected users never receive a session cookie.
 */

import { Router, type Request, type Response } from 'express';
import {
  emailDomainAllowed,
  getEntraSettings,
  redactEntraSettings,
} from '../lib/entra/config-store.js';
import {
  buildAuthorizeUrl,
  claimsToIdentity,
  decodeIdToken,
  exchangeAuthorizationCode,
  generateOidcState,
  generatePkce,
} from '../lib/entra/oidc.js';
import { deriveKuerzel, normalizeRole } from '../lib/entra/user-helpers.js';
import {
  addDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { issueSessionToken } from '../lib/session-token.js';
import { setSessionCookie } from '../lib/session-cookie.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { getOrganizationByM365TenantId } from '../lib/client-portal/organizations.js';
import { isClientPortalRole } from '../lib/client-portal/roles.js';
import { ensureClientRoleDoc } from '../lib/client-portal/team-service.js';
import {
  decidePortalSsoProvisioning,
  portalSsoStatusRedirectPath,
  type PortalSsoStatusQuery,
} from '../lib/client-portal/sso-approval.js';

const router = Router();

const OIDC_COOKIE = 'hubcom_oidc';
const OIDC_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

function resolveRedirectUri(req: Request, configured: string): string {
  if (configured.trim()) return configured.trim();
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}/api/auth/microsoft/callback`;
}

function resolveAppOrigin(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}`;
}

/** Öffentlicher Status für den Login-Button. */
router.get('/microsoft/status', async (_req: Request, res: Response) => {
  try {
    const settings = await getEntraSettings();
    const publicCfg = redactEntraSettings(settings);
    res.json({
      configured: publicCfg.configured,
      enabled: publicCfg.enabled,
    });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Status nicht verfügbar') });
  }
});

/** Startet den OIDC-Flow (Redirect zu Microsoft). */
router.get('/microsoft/start', async (req: Request, res: Response) => {
  try {
    const settings = await getEntraSettings();
    if (!settings.enabled || !settings.clientId || !settings.clientSecret || !settings.tenantId) {
      return res.status(503).send('Microsoft 365 Anmeldung ist nicht konfiguriert.');
    }

    const redirectUri = resolveRedirectUri(req, settings.redirectUri);
    const { verifier, challenge } = generatePkce();
    const state = generateOidcState();
    const nonce = generateOidcState();

    res.cookie(
      OIDC_COOKIE,
      JSON.stringify({ state, verifier, nonce, redirectUri }),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: OIDC_COOKIE_MAX_AGE_MS,
        path: '/',
      },
    );

    const url = buildAuthorizeUrl({
      settings,
      redirectUri,
      state,
      codeChallenge: challenge,
      nonce,
    });
    return res.redirect(302, url);
  } catch (err: any) {
    safeLog('error', '[auth/microsoft] start failed', err?.message || err);
    return res.status(500).send('Microsoft-Anmeldung konnte nicht gestartet werden.');
  }
});

/** OIDC Callback — Code tauschen, Benutzer verknüpfen/JIT, Session setzen. */
router.get('/microsoft/callback', async (req: Request, res: Response) => {
  const origin = resolveAppOrigin(req);
  const fail = (msg: string) =>
    res.redirect(302, `${origin}/login?error=${encodeURIComponent(msg)}`);
  const ssoFail = (code: PortalSsoStatusQuery) =>
    res.redirect(302, portalSsoStatusRedirectPath(code, origin));

  try {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const errQ = String(req.query.error || '');
    if (errQ) {
      return fail(String(req.query.error_description || errQ));
    }
    if (!code || !state) {
      return fail('Ungültige Microsoft-Antwort (kein Code).');
    }

    const rawCookie = req.cookies?.[OIDC_COOKIE];
    res.clearCookie(OIDC_COOKIE, { path: '/' });
    if (!rawCookie) {
      return fail('Anmeldesitzung abgelaufen. Bitte erneut versuchen.');
    }

    let oidc: { state: string; verifier: string; nonce: string; redirectUri: string };
    try {
      oidc = JSON.parse(rawCookie);
    } catch {
      return fail('Ungültige Anmelde-Cookies.');
    }
    if (oidc.state !== state) {
      return fail('Sicherheitsprüfung fehlgeschlagen (State).');
    }

    const settings = await getEntraSettings();
    const tokenRes = await exchangeAuthorizationCode({
      settings,
      code,
      redirectUri: oidc.redirectUri,
      codeVerifier: oidc.verifier,
    });

    if (!tokenRes.id_token && !tokenRes.access_token) {
      return fail(tokenRes.error_description || tokenRes.error || 'Token-Austausch fehlgeschlagen.');
    }

    const claims = tokenRes.id_token ? decodeIdToken(tokenRes.id_token) : {};
    if (claims.nonce && oidc.nonce && claims.nonce !== oidc.nonce) {
      return fail('Sicherheitsprüfung fehlgeschlagen (Nonce).');
    }

    let identity = claimsToIdentity(claims);
    const entraTenantId = String(claims.tid || '')
      .trim()
      .toLowerCase();

    // Fallback: Graph /me wenn id_token dünn ist
    if ((!identity.email || !identity.entraObjectId) && tokenRes.access_token) {
      try {
        const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { Authorization: `Bearer ${tokenRes.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as any;
          identity = {
            entraObjectId: identity.entraObjectId || String(me.id || ''),
            email:
              identity.email ||
              String(me.mail || me.userPrincipalName || '')
                .trim()
                .toLowerCase(),
            upn: identity.upn || String(me.userPrincipalName || '').toLowerCase(),
            name: identity.name || String(me.displayName || ''),
          };
        }
      } catch {
        /* ignore */
      }
    }

    if (!identity.email) {
      return fail('Von Microsoft konnte keine E-Mail-Adresse gelesen werden.');
    }

    if (!emailDomainAllowed(identity.email, settings.allowedDomains)) {
      return fail('Ihre E-Mail-Domain ist für die Anmeldung nicht freigeschaltet.');
    }

    // Map Entra tid → Kunden-Portal organization (strict unknown-tenant reject for portal path).
    const mappedOrg = entraTenantId
      ? await getOrganizationByM365TenantId(entraTenantId)
      : null;
    const hubcomTenant = String(settings.tenantId || '')
      .trim()
      .toLowerCase();
    const isHubcomTenant = Boolean(hubcomTenant && hubcomTenant === entraTenantId);

    // Benutzer suchen: OID → E-Mail → UPN
    let userDoc: any = null;
    if (identity.entraObjectId) {
      const all = await getDocsDirect('users', []);
      userDoc =
        all.find((u) => String(u.entraObjectId || '') === identity.entraObjectId) || null;
    }
    if (!userDoc) {
      const byEmail = await getDocsDirect('users', [
        { type: 'where', field: 'email', op: '==', value: identity.email },
      ]);
      userDoc = byEmail[0] || null;
    }
    if (!userDoc && identity.upn) {
      const byUpn = await getDocsDirect('users', [
        { type: 'where', field: 'upn', op: '==', value: identity.upn },
      ]);
      userDoc = byUpn[0] || null;
    }

    const now = new Date().toISOString();

    // ── Portal org SSO path (linked tenant) ──────────────────────────────
    if (mappedOrg) {
      const decision = decidePortalSsoProvisioning({
        org: mappedOrg,
        existingUser: userDoc
          ? {
              id: userDoc.id,
              role: userDoc.role,
              organizationId: userDoc.organizationId,
              organization_id: userDoc.organization_id,
              approval_status: userDoc.approval_status,
              isDeactivated: userDoc.isDeactivated,
            }
          : null,
        tenantLinked: true,
      });

      if (decision.action === 'reject') {
        return ssoFail(decision.code);
      }

      if (decision.action === 'jit_pending' || decision.action === 'jit_active') {
        const roleId = await ensureClientRoleDoc(decision.role);
        const created = await addDocDirect('users', {
          name: identity.name,
          email: identity.email,
          upn: identity.upn,
          entraObjectId: identity.entraObjectId || null,
          authMethod: 'microsoft365',
          passwordHash: null,
          kuerzel: deriveKuerzel(identity.name),
          role: decision.role,
          roleId,
          is_admin: false,
          company: mappedOrg.name,
          organizationId: decision.organizationId,
          organization_id: decision.organizationId,
          approval_status: decision.approval_status,
          approvalRequestedAt: now,
          isDeactivated: false,
          can_create_tickets: true,
          can_view_knowledgebase: true,
          lastActiveAt: now,
          createdAt: now,
          updatedAt: now,
        });
        if (decision.action === 'jit_pending') {
          // No session cookie — admin must approve first.
          return ssoFail('pending');
        }
        userDoc = { id: created.id, ...created.data, role: decision.role };
      } else if (decision.action === 'login') {
        await updateDocDirect('users', userDoc.id, {
          entraObjectId: identity.entraObjectId || userDoc.entraObjectId || null,
          upn: identity.upn || userDoc.upn || null,
          authMethod: 'microsoft365',
          name: userDoc.name || identity.name,
          organizationId: userDoc.organizationId || mappedOrg.id,
          organization_id: userDoc.organization_id || mappedOrg.id,
          lastActiveAt: now,
          updatedAt: now,
        });
        userDoc = await getDocDirect('users', userDoc.id);
        const token = issueSessionToken({ id: userDoc.id, email: userDoc.email });
        setSessionCookie(res, token);
        return res.redirect(302, `${origin}${decision.redirect}`);
      }
    } else if (userDoc && isClientPortalRole(userDoc.role) && !isHubcomTenant) {
      // Client portal account from an unlinked/unknown tenant — reject.
      return ssoFail('unknown_tenant');
    } else if (userDoc) {
      // Hubcom staff / legacy path
      if (userDoc.isDeactivated) {
        return fail('Ihr Konto wurde deaktiviert. Bitte wenden Sie sich an den Administrator.');
      }
      await updateDocDirect('users', userDoc.id, {
        entraObjectId: identity.entraObjectId || userDoc.entraObjectId || null,
        upn: identity.upn || userDoc.upn || null,
        authMethod: 'microsoft365',
        name: userDoc.name || identity.name,
        lastActiveAt: now,
        updatedAt: now,
      });
      userDoc = await getDocDirect('users', userDoc.id);
    } else if (settings.jitProvisioning && isHubcomTenant) {
      const role = normalizeRole(settings.defaultRole);
      const created = await addDocDirect('users', {
        name: identity.name,
        email: identity.email,
        upn: identity.upn,
        entraObjectId: identity.entraObjectId || null,
        authMethod: 'microsoft365',
        passwordHash: null,
        kuerzel: deriveKuerzel(identity.name),
        role,
        is_admin: role === 'SYSTEM_ADMIN',
        company: '',
        approval_status: 'active',
        isDeactivated: false,
        can_create_tickets: true,
        can_view_knowledgebase: true,
        lastActiveAt: now,
        createdAt: now,
        updatedAt: now,
      });
      userDoc = { id: created.id, ...created.data };
    } else if (!userDoc && entraTenantId && !isHubcomTenant) {
      return ssoFail('unknown_tenant');
    } else {
      return fail(
        'Kein Benutzerkonto gefunden. Bitte lassen Sie sich von einem Administrator freischalten.',
      );
    }

    if (!userDoc) {
      return fail('Anmeldung fehlgeschlagen.');
    }

    // Final approval gate (defense in depth for portal roles).
    if (isClientPortalRole(userDoc.role)) {
      const { isPortalLoginAllowed } = await import('../lib/client-portal/sso-approval.js');
      const gate = isPortalLoginAllowed(userDoc);
      if (gate.ok === false) {
        return ssoFail(gate.reason);
      }
    }

    const token = issueSessionToken({ id: userDoc.id, email: userDoc.email });
    setSessionCookie(res, token);

    const role = normalizeRole(userDoc.role);
    const dest =
      isClientPortalRole(role) || role === 'customer' ? '/portal/dashboard' : '/tickets';
    return res.redirect(302, `${origin}${dest}`);
  } catch (err: any) {
    safeLog('error', '[auth/microsoft] callback failed', err?.message || err);
    return fail('Microsoft-Anmeldung fehlgeschlagen.');
  }
});

export default router;
