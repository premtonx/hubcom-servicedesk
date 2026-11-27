/**
 * Admin portal-* settings mirrors for /api/admin/organizations/:id/…
 * SYSTEM_ADMIN only; CLIENT_* blocked by parent forbidClientPortalRoles.
 * Reuses the same services as /api/portal/* (org-scoped to :id).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCanManageOrganization } from '../middleware/authMiddleware.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import {
  getOrganization,
  organizationEnabledModules,
  updateOrganizationBranding,
  updateOrganizationHardwareModule,
  updateOrganizationPortalModules,
  updateOrganizationSsoSettings,
  updateOrganizationSecondLevelSettings,
} from '../lib/client-portal/organizations.js';
import {
  parseAndValidateFaviconDataUrl,
  parseAndValidateLogoDataUrl,
  resolvePortalTitle,
} from '../lib/client-portal/org-branding.js';
import { parsePortalThemePatch } from '../lib/client-portal/portal-theme.js';
import { parseAndValidateDashboardBannerDataUrl } from '../lib/dashboard-banner-validate.js';
import {
  createEmailChannel,
  findOrganizationEmailChannel,
  updateEmailChannel,
  updateEmailChannelStatus,
} from '../lib/email-ingestion/channel-store.js';
import { createEmailIngestionDriver } from '../lib/email-ingestion/factory.js';
import { decryptEmailChannelSecret } from '../lib/email-ingestion/channel-secret-crypto.js';
import type { EmailChannelConfig } from '../lib/email-ingestion/types.js';
import {
  normalizeSecondLevelNotifySettings,
  parseSecondLevelEmails,
  resolveSecondLevelNotifySettings,
} from '../lib/client-portal/second-level-notify.js';
import { parseAndValidateSignatureLogoDataUrl } from '../lib/email-signature.js';
import {
  CLIENT_TEAM_ROLES,
  approvePortalSsoUser,
  rejectPortalSsoUser,
  createOrInviteTeamMember,
  countActiveClientAdmins,
  ensureClientRoleDoc,
  isClientTeamRole,
  listOrganizationUsers,
  toTeamMemberView,
  userOrganizationId,
  type ClientTeamRole,
} from '../lib/client-portal/team-service.js';
import { deletePortalOrganizationUser } from '../lib/client-portal/portal-user-delete.js';
import { isClientPortalRole } from '../lib/client-portal/roles.js';
import { getDocDirect, updateDocDirect } from '../lib/postgres-backend.js';

const router = Router();

/**
 * Portal-* mirrors require SUPER_ADMIN or ORG_ADMIN on :id
 * (HUBCOM_ADMIN / HUBCOM_USER with ORG_ADMIN assignment).
 */
const requireStaffAdmin = requireCanManageOrganization('id');

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => {
      if (value == null) return undefined;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    });

function orgIdFromReq(req: Request): string {
  return routeParam(req.params.id);
}

function publicChannelView(channel: EmailChannelConfig | null) {
  if (!channel) return null;
  const logoData = channel.signature_logo_data || null;
  const logoMime = channel.signature_logo_mime || null;
  return {
    id: channel.id,
    name: channel.name,
    email: channel.email,
    mailbox: channel.mailbox || channel.email,
    tenantId: channel.tenantId || null,
    clientId: channel.clientId || null,
    hasClientSecret: Boolean(
      channel.hasClientSecret ||
        channel.clientSecretSet ||
        (channel.clientSecret && channel.clientSecret.length > 0),
    ),
    inboundEnabled: channel.inboundEnabled !== false,
    sendAsEnabled: Boolean(channel.sendAsEnabled),
    status: channel.status,
    lastTestOk: channel.lastTestOk ?? null,
    lastTestAt: channel.lastTestAt ?? null,
    lastError: channel.lastError ?? null,
    organizationId: channel.organizationId || channel.organization_id || null,
    connectionType: channel.connectionType,
    signature_enabled: channel.signature_enabled !== false,
    signature_html: channel.signature_html || null,
    signature_logo_mime: logoMime,
    hasSignatureLogo: Boolean(logoData),
    signature_logo_data: logoData
      ? logoData.startsWith('data:')
        ? logoData
        : `data:${logoMime || 'image/png'};base64,${logoData}`
      : null,
  };
}

function publicOrgEmailView(org: NonNullable<Awaited<ReturnType<typeof getOrganization>>>) {
  const sl = resolveSecondLevelNotifySettings(org);
  return {
    id: org.id,
    name: org.name,
    domain: org.domain,
    m365TenantId: org.m365_tenant_id,
    ssoEnabled: org.sso_enabled,
    ssoApprovalMode: org.sso_approval_mode,
    second_level_notify_enabled: sl.second_level_notify_enabled,
    second_level_support_emails: sl.second_level_support_emails,
    second_level_label: sl.second_level_label,
    secondLevelNotify: sl,
  };
}

async function requireOrg(req: Request, res: Response) {
  const id = orgIdFromReq(req);
  const org = await getOrganization(id);
  if (!org) {
    res.status(404).json({ error: 'Organisation nicht gefunden.' });
    return null;
  }
  return org;
}

/* ─── Branding & Modules ───────────────────────────────────────────── */

const brandingPutSchema = z.object({
  logoDataUrl: z.string().min(1).optional().nullable(),
  portal_title: z.string().max(120).optional().nullable(),
  clearLogo: z.boolean().optional(),
  hardware_returns_enabled: z.boolean().optional(),
  secure_exchange_enabled: z.boolean().optional(),
  vault_enabled: z.boolean().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  sidebarColor: z.string().nullable().optional(),
  themeMode: z.enum(['light', 'dark', 'system']).optional(),
  allowUserThemeToggle: z.boolean().optional(),
});

router.get('/:id/portal-branding', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const modules = organizationEnabledModules(org);
    const theme = org.portal_theme;
    return res.json({
      organization: {
        ...org,
        resolved_portal_title: resolvePortalTitle(org.name, org.portal_title),
        enabledModules: modules,
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        sidebarColor: theme.sidebarColor,
        themeMode: theme.themeMode,
        allowUserThemeToggle: theme.allowUserThemeToggle,
      },
      branding: {
        logo_url: org.logo_url,
        favicon_url: org.favicon_url,
        portal_title: org.portal_title,
        portal_banner_url: org.portal_banner_url,
        resolved_portal_title: resolvePortalTitle(org.name, org.portal_title),
        primaryColor: theme.primaryColor,
        secondaryColor: theme.secondaryColor,
        sidebarColor: theme.sidebarColor,
        themeMode: theme.themeMode,
        allowUserThemeToggle: theme.allowUserThemeToggle,
        portal_theme: theme,
      },
      modules: {
        hardware_returns_enabled: modules.hardwareReturns,
        secure_exchange_enabled: modules.secureExchange,
        vault_enabled: modules.vault,
      },
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Branding konnte nicht geladen werden') });
  }
});

router.put('/:id/portal-branding', requireStaffAdmin, async (req, res): Promise<any> => {
  const parsed = brandingPutSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige Branding-Daten',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const id = org.id;

    const themeParsed = parsePortalThemePatch(parsed.data);
    if (themeParsed.ok === false) {
      return res.status(400).json({ error: themeParsed.error });
    }

    const patch: {
      logo_url?: string | null;
      portal_title?: string | null;
      portal_theme?: typeof themeParsed.patch;
    } = {};
    if (parsed.data.clearLogo) {
      patch.logo_url = null;
    } else if (parsed.data.logoDataUrl != null) {
      const validated = parseAndValidateLogoDataUrl(parsed.data.logoDataUrl);
      if (validated.ok === false) {
        return res.status(400).json({ error: validated.error });
      }
      patch.logo_url = validated.dataUrl;
    }
    if (parsed.data.portal_title !== undefined) {
      patch.portal_title = parsed.data.portal_title;
    }
    if (Object.keys(themeParsed.patch).length > 0) {
      patch.portal_theme = themeParsed.patch;
    }
    let organization = await updateOrganizationBranding(id, patch);

    if (
      parsed.data.secure_exchange_enabled !== undefined ||
      parsed.data.vault_enabled !== undefined
    ) {
      organization = await updateOrganizationPortalModules(id, {
        secure_exchange_enabled: parsed.data.secure_exchange_enabled,
        vault_enabled: parsed.data.vault_enabled,
      });
    }
    if (parsed.data.hardware_returns_enabled !== undefined) {
      organization = await updateOrganizationHardwareModule(id, {
        hardware_returns_enabled: parsed.data.hardware_returns_enabled,
      });
    }

    organization = (await getOrganization(id)) || organization;
    return res.json({
      organization: {
        ...organization,
        resolved_portal_title: resolvePortalTitle(
          organization!.name,
          organization!.portal_title,
        ),
        enabledModules: organizationEnabledModules(organization!),
      },
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Branding konnte nicht gespeichert werden') });
  }
});

router.post('/:id/portal-branding/logo', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const raw =
      (req.body as any)?.logoDataUrl ??
      (req.body as any)?.imageDataUrl ??
      (req.body as any)?.logo_url;
    const validated = parseAndValidateLogoDataUrl(raw);
    if (validated.ok === false) {
      return res.status(400).json({ error: validated.error });
    }
    const organization = await updateOrganizationBranding(org.id, {
      logo_url: validated.dataUrl,
    });
    return res.json({ organization });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Logo konnte nicht gespeichert werden') });
  }
});

router.delete('/:id/portal-branding/logo', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const organization = await updateOrganizationBranding(org.id, { logo_url: null });
    return res.json({ organization });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Logo konnte nicht entfernt werden') });
  }
});

router.post('/:id/portal-branding/favicon', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const raw =
      (req.body as any)?.faviconDataUrl ??
      (req.body as any)?.imageDataUrl ??
      (req.body as any)?.favicon_url;
    const validated = parseAndValidateFaviconDataUrl(raw);
    if (validated.ok === false) {
      return res.status(400).json({ error: validated.error });
    }
    const organization = await updateOrganizationBranding(org.id, {
      favicon_url: validated.dataUrl,
    });
    return res.json({ organization });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Favicon konnte nicht gespeichert werden') });
  }
});

router.delete('/:id/portal-branding/favicon', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const organization = await updateOrganizationBranding(org.id, { favicon_url: null });
    return res.json({ organization });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Favicon konnte nicht entfernt werden') });
  }
});

router.post('/:id/portal-branding/banner', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const raw =
      (req.body as any)?.bannerDataUrl ??
      (req.body as any)?.imageDataUrl ??
      (req.body as any)?.portal_banner_url;
    const validated = parseAndValidateDashboardBannerDataUrl(raw);
    if (validated.ok === false) {
      return res.status(400).json({ error: validated.error });
    }
    const organization = await updateOrganizationBranding(org.id, {
      portal_banner_url: validated.dataUrl,
    });
    return res.json({ organization });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Banner konnte nicht gespeichert werden') });
  }
});

router.delete('/:id/portal-branding/banner', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const organization = await updateOrganizationBranding(org.id, {
      portal_banner_url: null,
    });
    return res.json({ organization });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Banner konnte nicht entfernt werden') });
  }
});

/* ─── E-Mail / M365 / SSO ──────────────────────────────────────────── */

const channelUpsertSchema = z.object({
  email: optionalText(320),
  mailbox: optionalText(320),
  tenantId: optionalText(255),
  clientId: optionalText(255),
  clientSecret: optionalText(500),
  inboundEnabled: z.boolean().optional(),
  sendAsEnabled: z.boolean().optional(),
  name: optionalText(200),
  signature_enabled: z.boolean().optional(),
  signature_html: z.string().max(50_000).optional().nullable(),
  signature_logo_data: z.string().max(400_000).optional().nullable(),
  signature_logo_mime: z
    .enum(['image/png', 'image/jpeg', 'image/webp'])
    .optional()
    .nullable(),
  m365TenantId: optionalText(255),
  m365_tenant_id: optionalText(255),
  ssoEnabled: z.boolean().optional(),
  sso_enabled: z.boolean().optional(),
  ssoApprovalMode: z
    .enum(['admin_approval', 'pre_provisioned_only', 'auto_domain'])
    .optional(),
  sso_approval_mode: z
    .enum(['admin_approval', 'pre_provisioned_only', 'auto_domain'])
    .optional(),
  second_level_notify_enabled: z.boolean().optional(),
  second_level_support_emails: z
    .union([z.string().max(2000), z.array(z.string().email().max(320)).max(20)])
    .optional()
    .nullable(),
  second_level_label: z.string().max(80).optional().nullable(),
});

router.get('/:id/portal-email', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const channel = await findOrganizationEmailChannel(org.id);
    return res.json({
      channel: publicChannelView(channel),
      organization: publicOrgEmailView(org),
      settings: resolveSecondLevelNotifySettings(org),
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'E-Mail-Einstellungen konnten nicht geladen werden') });
  }
});

router.put('/:id/portal-email', requireStaffAdmin, async (req, res): Promise<any> => {
  const parsed = channelUpsertSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige E-Mail-Einstellungen',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const organizationId = org.id;

    const supportEmail = parsed.data.mailbox || parsed.data.email || undefined;
    const existing = await findOrganizationEmailChannel(organizationId, {
      includeSecrets: true,
    });

    let channel: EmailChannelConfig | null = existing;
    if (supportEmail || parsed.data.tenantId || parsed.data.clientId || parsed.data.clientSecret) {
      let signatureLogoData = parsed.data.signature_logo_data;
      let signatureLogoMime = parsed.data.signature_logo_mime || undefined;
      if (signatureLogoData != null && String(signatureLogoData).trim() !== '') {
        const raw = String(signatureLogoData);
        if (raw.startsWith('data:')) {
          const validated = parseAndValidateSignatureLogoDataUrl(raw);
          if (validated.ok === false) {
            return res.status(400).json({ error: validated.error });
          }
          signatureLogoData = validated.base64;
          signatureLogoMime = validated.mime as 'image/png' | 'image/jpeg' | 'image/webp';
        }
      } else if (signatureLogoData === null || signatureLogoData === '') {
        signatureLogoData = null;
        signatureLogoMime = null;
      } else {
        signatureLogoData = undefined;
        signatureLogoMime = undefined;
      }

      const payload: Partial<EmailChannelConfig> = {
        name: parsed.data.name || existing?.name || `M365 — ${supportEmail || org.name}`,
        email: supportEmail || existing?.email,
        mailbox: supportEmail || existing?.mailbox || existing?.email,
        connectionType: 'microsoft_graph',
        provider: 'microsoft',
        enabled: true,
        tenantId: parsed.data.tenantId ?? existing?.tenantId ?? undefined,
        clientId: parsed.data.clientId ?? existing?.clientId ?? undefined,
        clientSecret: parsed.data.clientSecret,
        organizationId,
        organization_id: organizationId,
        inboundEnabled:
          parsed.data.inboundEnabled !== undefined
            ? parsed.data.inboundEnabled
            : existing?.inboundEnabled !== false,
        sendAsEnabled:
          parsed.data.sendAsEnabled !== undefined
            ? parsed.data.sendAsEnabled
            : Boolean(existing?.sendAsEnabled),
        status: existing?.status || 'pending',
      };
      if (parsed.data.signature_enabled !== undefined) {
        payload.signature_enabled = parsed.data.signature_enabled;
      }
      if (parsed.data.signature_html !== undefined) {
        payload.signature_html = parsed.data.signature_html;
      }
      if (signatureLogoData !== undefined) {
        payload.signature_logo_data = signatureLogoData;
        payload.signature_logo_mime = signatureLogoMime ?? null;
      }

      if (existing) {
        channel = await updateEmailChannel(existing.id, payload);
      } else {
        if (!payload.tenantId || !payload.clientId || !payload.clientSecret) {
          return res.status(400).json({
            error:
              'Tenant ID, Client ID und Client Secret sind erforderlich, um einen Graph-Kanal anzulegen.',
          });
        }
        if (!payload.email) {
          return res.status(400).json({ error: 'Support-E-Mail (mailbox) ist erforderlich.' });
        }
        channel = await createEmailChannel(payload);
      }
    }

    const m365TenantId =
      parsed.data.m365TenantId ?? parsed.data.m365_tenant_id ?? undefined;
    const ssoEnabled = parsed.data.ssoEnabled ?? parsed.data.sso_enabled;
    const ssoApprovalMode =
      parsed.data.ssoApprovalMode ?? parsed.data.sso_approval_mode ?? undefined;
    if (
      m365TenantId !== undefined ||
      ssoEnabled !== undefined ||
      ssoApprovalMode !== undefined
    ) {
      await updateOrganizationSsoSettings(organizationId, {
        m365_tenant_id: m365TenantId === undefined ? undefined : m365TenantId || null,
        sso_enabled: ssoEnabled,
        sso_approval_mode: ssoApprovalMode,
      });
    }

    if (
      parsed.data.second_level_notify_enabled !== undefined ||
      parsed.data.second_level_support_emails !== undefined ||
      parsed.data.second_level_label !== undefined
    ) {
      const emailsRaw = parsed.data.second_level_support_emails;
      const emails =
        emailsRaw === undefined ? undefined : parseSecondLevelEmails(emailsRaw ?? '');
      await updateOrganizationSecondLevelSettings(organizationId, {
        second_level_notify_enabled: parsed.data.second_level_notify_enabled,
        second_level_support_emails: emails,
        second_level_label: parsed.data.second_level_label,
      });
    }

    const refreshed = await getOrganization(organizationId);
    return res.json({
      channel: publicChannelView(channel),
      organization: refreshed ? publicOrgEmailView(refreshed) : null,
      settings: refreshed
        ? resolveSecondLevelNotifySettings(refreshed)
        : normalizeSecondLevelNotifySettings({}),
    });
  } catch (err: any) {
    safeLog('error', '[admin/portal-email] put failed', err?.message || err);
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'E-Mail-Einstellungen konnten nicht gespeichert werden') });
  }
});

router.post('/:id/portal-email/test', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const existing = await findOrganizationEmailChannel(org.id, { includeSecrets: true });
    let clientSecret = String((req.body as any)?.clientSecret || '');
    if (!clientSecret || clientSecret === '••••••••') {
      clientSecret = existing?.clientSecret
        ? decryptEmailChannelSecret(existing.clientSecret) || ''
        : '';
    }
    const tenantId =
      String((req.body as any)?.tenantId || existing?.tenantId || '').trim();
    const clientId =
      String((req.body as any)?.clientId || existing?.clientId || '').trim();
    const mailbox = String(
      (req.body as any)?.mailbox ||
        (req.body as any)?.email ||
        existing?.mailbox ||
        existing?.email ||
        '',
    ).trim();
    if (!tenantId || !clientId || !clientSecret) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: 'Tenant ID, Client ID und Client Secret sind für den Test erforderlich.',
      });
    }
    const driver = createEmailIngestionDriver({
      id: existing?.id || `test-${org.id}`,
      name: existing?.name || 'test',
      email: mailbox || 'test@example.com',
      mailbox: mailbox || undefined,
      connectionType: 'microsoft_graph',
      provider: 'microsoft',
      enabled: true,
      tenantId,
      clientId,
      clientSecret,
      organizationId: org.id,
      inboundEnabled: true,
      sendAsEnabled: true,
      status: 'pending',
    } as EmailChannelConfig);
    const started = Date.now();
    await driver.testConnection();
    const latencyMs = Date.now() - started;
    if (existing?.id) {
      await updateEmailChannelStatus(existing.id, {
        status: 'connected',
        lastTestOk: true,
        lastTestAt: new Date().toISOString(),
        lastError: null,
      });
    }
    return res.json({
      ok: true,
      success: true,
      latencyMs,
      message: 'M365-Verbindung erfolgreich.',
      organizationId: org.id,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: safeErrorMessage(err, 'Verbindungstest fehlgeschlagen'),
    });
  }
});

/* ─── Members & Roles ──────────────────────────────────────────────── */

const memberCreateSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  role: z.enum(CLIENT_TEAM_ROLES).default('CLIENT_USER'),
});

const memberPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.enum(CLIENT_TEAM_ROLES).optional(),
  isActive: z.boolean().optional(),
});

router.get('/:id/portal-members', requireStaffAdmin, async (req, res): Promise<any> => {
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const members = await listOrganizationUsers(org.id);
    const pendingApprovals = members.filter((m) => m.approvalStatus === 'pending_approval');
    // Outstanding invites are tracked on the member rows; empty array when none.
    const invites = members.filter(
      (m) =>
        m.approvalStatus !== 'pending_approval' &&
        m.isActive === false &&
        !m.lastLoginAt,
    );
    const summary = {
      totalActive: members.filter((m) => m.isActive).length,
      clientAdmins: members.filter((m) => m.role === 'CLIENT_ADMIN' && m.isActive).length,
      clientSupporters: members.filter((m) => m.role === 'CLIENT_SUPPORTER' && m.isActive)
        .length,
      clientUsers: members.filter((m) => m.role === 'CLIENT_USER' && m.isActive).length,
      total: members.length,
      pendingApprovals: pendingApprovals.length,
      invites: invites.length,
    };
    return res.json({
      members,
      pendingApprovals,
      invites,
      summary,
      organizationId: org.id,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Mitglieder konnten nicht geladen werden') });
  }
});

router.post('/:id/portal-members', requireStaffAdmin, async (req, res): Promise<any> => {
  const parsed = memberCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige Mitglieder-Daten',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    if (!isClientTeamRole(parsed.data.role)) {
      return res.status(400).json({ error: 'Rolle muss eine Portal-Rolle sein.' });
    }
    const result = await createOrInviteTeamMember({
      organizationId: org.id,
      name: parsed.data.name.trim(),
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: String(req.user!.id),
    });
    return res.status(result.created ? 201 : 200).json({
      success: true,
      member: result.member,
      setupLink: result.emailSent ? null : result.setupLink,
      emailSent: result.emailSent,
      emailReason: result.emailReason || null,
      invitationStatus: result.invitationStatus,
      created: result.created,
      organizationId: org.id,
    });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Mitglied konnte nicht angelegt werden') });
  }
});

router.patch('/:id/portal-members/:userId', requireStaffAdmin, async (req, res): Promise<any> => {
  const userId = routeParam(req.params.userId);
  const parsed = memberPatchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige Aktualisierung',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const user = await getDocDirect('users', userId);
    if (!user || userOrganizationId(user) !== org.id) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
    }
    if (!isClientPortalRole(user.role) && user.role !== 'customer') {
      return res.status(403).json({ error: 'Hubcom-Mitarbeiter können hier nicht geändert werden.' });
    }
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
    if (parsed.data.role !== undefined) {
      if (!isClientTeamRole(parsed.data.role)) {
        return res.status(400).json({ error: 'Rolle muss eine Portal-Rolle sein.' });
      }
      if (
        user.role === 'CLIENT_ADMIN' &&
        parsed.data.role !== 'CLIENT_ADMIN' &&
        user.isDeactivated !== true
      ) {
        const remaining = await countActiveClientAdmins(org.id, userId);
        if (remaining < 1) {
          return res.status(400).json({
            error: 'Die letzte aktive CLIENT_ADMIN-Rolle kann nicht entzogen werden.',
          });
        }
      }
      const roleId = await ensureClientRoleDoc(parsed.data.role as ClientTeamRole);
      updates.role = parsed.data.role;
      updates.roleId = roleId;
      updates.is_admin = false;
      updates.can_view_knowledgebase = parsed.data.role !== 'CLIENT_USER';
    }
    if (parsed.data.isActive !== undefined) {
      if (parsed.data.isActive === false && user.role === 'CLIENT_ADMIN' && user.isDeactivated !== true) {
        const remaining = await countActiveClientAdmins(org.id, userId);
        if (remaining < 1) {
          return res.status(400).json({
            error: 'Der letzte aktive CLIENT_ADMIN kann nicht deaktiviert werden.',
          });
        }
      }
      updates.isDeactivated = !parsed.data.isActive;
    }
    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({ error: 'Keine änderbaren Felder angegeben.' });
    }
    await updateDocDirect('users', userId, updates);
    const refreshed = await getDocDirect('users', userId);
    return res.json({
      success: true,
      member: toTeamMemberView({ id: userId, ...(refreshed || user) }),
      organizationId: org.id,
    });
  } catch (err: any) {
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Mitglied konnte nicht aktualisiert werden') });
  }
});

router.delete('/:id/portal-members/:userId', requireStaffAdmin, async (req, res): Promise<any> => {
  const userId = routeParam(req.params.userId);
  try {
    const org = await requireOrg(req, res);
    if (!org) return;
    const result = await deletePortalOrganizationUser({
      organizationId: org.id,
      userId,
      mode: 'admin',
      actor: {
        id: String(req.user?.id || ''),
        role: String(req.user?.role || 'SYSTEM_ADMIN'),
        organizationId: null,
      },
    });
    return res.json({ success: true, ...result, organizationId: org.id });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Mitglied konnte nicht gelöscht werden') });
  }
});

router.post(
  '/:id/portal-members/:userId/approve',
  requireStaffAdmin,
  async (req, res): Promise<any> => {
    const userId = routeParam(req.params.userId);
    const parsed = z.object({ role: z.enum(CLIENT_TEAM_ROLES) }).safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'role (CLIENT_ADMIN | CLIENT_SUPPORTER | CLIENT_USER) ist erforderlich.',
      });
    }
    try {
      const org = await requireOrg(req, res);
      if (!org) return;
      const member = await approvePortalSsoUser({
        organizationId: org.id,
        userId,
        role: parsed.data.role,
        approvedBy: String(req.user!.id),
      });
      return res.json({ success: true, member, organizationId: org.id });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      if (status < 500) return res.status(status).json({ error: err.message });
      return res.status(500).json({ error: safeErrorMessage(err, 'Freigabe fehlgeschlagen') });
    }
  },
);

router.post(
  '/:id/portal-members/:userId/reject',
  requireStaffAdmin,
  async (req, res): Promise<any> => {
    const userId = routeParam(req.params.userId);
    try {
      const org = await requireOrg(req, res);
      if (!org) return;
      const member = await rejectPortalSsoUser({
        organizationId: org.id,
        userId,
        rejectedBy: String(req.user!.id),
      });
      return res.json({ success: true, member, organizationId: org.id });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      if (status < 500) return res.status(status).json({ error: err.message });
      return res.status(500).json({ error: safeErrorMessage(err, 'Ablehnung fehlgeschlagen') });
    }
  },
);

export default router;
