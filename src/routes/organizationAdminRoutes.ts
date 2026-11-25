/**
 * Hubcom SYSTEM_ADMIN controls for Client Organizations (Kunden)
 * and initial CLIENT_ADMIN provisioning.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware.js';
import { forbidClientPortalRoles } from '../middleware/clientPortalMiddleware.js';
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  organizationEnabledModules,
  updateOrganization,
  updateOrganizationBranding,
  updateOrganizationHardwareModule,
} from '../lib/client-portal/organizations.js';
import { normalizeHardwareReturnsConfig } from '../lib/client-portal/hardware-returns.js';
import {
  ensureCompanyForOrganization,
  ensureContactForPortalUser,
  syncCompaniesAndOrganizations,
} from '../lib/client-portal/org-company-sync.js';
import { getDocDirect, getDocsDirect, updateDocDirect } from '../lib/postgres-backend.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { isClientPortalRole, isHubcomStaffRole } from '../lib/client-portal/roles.js';
import {
  parseAndValidateLogoDataUrl,
  resolvePortalTitle,
} from '../lib/client-portal/org-branding.js';
import { parseAndValidateDashboardBannerDataUrl } from '../lib/dashboard-banner-validate.js';
import { findOrganizationEmailChannel } from '../lib/email-ingestion/channel-store.js';
import {
  CLIENT_TEAM_ROLES,
  countActiveClientAdmins,
  createOrInviteTeamMember,
  ensureClientRoleDoc,
  isClientTeamRole,
  portalUserListItem,
  resetTeamMemberPassword,
  setTeamMemberPassword,
  userOrganizationId,
  type ClientTeamRole,
} from '../lib/client-portal/team-service.js';
import {
  appendOrgVaultAudit,
  createOrgVaultSecret,
  deleteOrgVaultSecret,
  getOrgVaultSecretById,
  listOrgVaultSecrets,
  normalizeOrgVaultCategory,
  revealOrgVaultSecretPlaintext,
  toOrgVaultListItem,
  updateOrgVaultSecret,
} from '../lib/client-portal/organization-vault.js';

const router = Router();

router.use(authenticate, forbidClientPortalRoles);

/** requireRole(['SYSTEM_ADMIN', …]) rejects every non–SYSTEM_ADMIN — use this for staff reads. */
function requireHubcomStaff(req: Request, res: Response, next: () => void): any {
  const role = String(req.user?.role || '');
  if (!isHubcomStaffRole(role) && role !== 'SYSTEM_ADMIN' && !(req.user as any)?.is_admin) {
    return res.status(403).json({ error: 'Forbidden: Hubcom staff only.' });
  }
  return next();
}

const orgSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
  is_active: z.boolean().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  portal_title: z.string().max(120).optional().nullable(),
  industry: z.string().max(80).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  tier: z.string().max(80).optional().nullable(),
  sla: z.string().max(120).optional().nullable(),
  contract_renewal: z.string().max(120).optional().nullable(),
  monthly_rate: z.string().max(80).optional().nullable(),
  contract_reference: z.string().max(120).optional().nullable(),
  contract_notes: z.string().max(4000).optional().nullable(),
  contract_term: z.string().max(120).optional().nullable(),
  is_demo: z.boolean().optional(),
  crm_company_id: z.string().max(120).optional().nullable(),
  logo_url: z.string().max(400_000).optional().nullable(),
  portal_banner_url: z.string().max(3_000_000).optional().nullable(),
  hardware_returns_enabled: z.boolean().optional(),
  hardware_returns_config: z.record(z.string(), z.unknown()).optional().nullable(),
});

const hardwareModuleSchema = z.object({
  hardware_returns_enabled: z.boolean().optional(),
  hardware_returns_config: z.record(z.string(), z.unknown()).optional().nullable(),
});

const invitePortalUserSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  role: z.enum(CLIENT_TEAM_ROLES).optional().default('CLIENT_ADMIN'),
  temporaryPassword: z.string().min(10).max(200).optional(),
});

const patchPortalUserSchema = z.object({
  role: z.enum(CLIENT_TEAM_ROLES).optional(),
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

const brandingSchema = z.object({
  logoDataUrl: z.string().min(1).optional().nullable(),
  portal_title: z.string().max(120).optional().nullable(),
  clearLogo: z.boolean().optional(),
});

/**
 * GET /api/admin/organizations
 * Hubcom staff (SYSTEM_ADMIN / AGENT / …) — read-only for Kunden sidebar.
 */
router.get('/', requireHubcomStaff, async (_req: Request, res: Response): Promise<any> => {
  try {
    const organizations = await listOrganizations({ includeInactive: true });
    return res.json({
      organizations: organizations.map((o) => ({
        ...o,
        resolved_portal_title: resolvePortalTitle(o.name, o.portal_title),
      })),
    });
  } catch (err: any) {
    safeLog('error', '[organizations] list failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to list organizations') });
  }
});

/** POST /api/admin/organizations/sync — force companies↔orgs bridge */
router.post('/sync', requireRole(['SYSTEM_ADMIN']), async (_req: Request, res: Response): Promise<any> => {
  try {
    const result = await syncCompaniesAndOrganizations();
    return res.json({ ok: true, result });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Sync failed') });
  }
});

/** POST /api/admin/organizations */
router.post('/', requireRole(['SYSTEM_ADMIN']), async (req: Request, res: Response): Promise<any> => {
  const parsed = orgSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid organization payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const payload = { ...parsed.data };
    if (payload.logo_url && String(payload.logo_url).startsWith('data:')) {
      const logoCheck = parseAndValidateLogoDataUrl(payload.logo_url);
      if (logoCheck.ok === false) {
        return res.status(400).json({ error: logoCheck.error });
      }
      payload.logo_url = logoCheck.dataUrl;
    }
    let organization = await createOrganization(payload);
    const crmCompanyId = await ensureCompanyForOrganization(organization);
    organization = (await getOrganization(organization.id)) || organization;
    return res.status(201).json({
      organization: {
        ...organization,
        crm_company_id: crmCompanyId,
        resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
      },
    });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/unique|duplicate/i.test(message)) {
      return res.status(409).json({ error: 'Organization slug already exists.' });
    }
    safeLog('error', '[organizations] create failed', message);
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to create organization') });
  }
});

/** GET /api/admin/organizations/:id/users — portal users for this Kunden org */
router.get('/:id/users', requireHubcomStaff, async (req: Request, res: Response): Promise<any> => {
  const id = routeParam(req.params.id);
  try {
    const organization = await getOrganization(id);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });

    // getDocsDirect already flattens `data` onto the document — do not re-spread u.data.
    const users = await getDocsDirect('users', []);
    const portalUsers = users
      .filter((u: any) => userOrganizationId(u) === id && isClientPortalRole(u.role))
      .map((u: any) => {
        const item = portalUserListItem(u);
        return {
          id: item.id,
          name: item.name,
          email: item.email,
          role: item.role,
          isDeactivated: !item.isActive,
          invitationStatus: item.invitationStatus,
          invitationEmailReason: item.invitationEmailReason,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    let emailChannel: any = null;
    try {
      emailChannel = await findOrganizationEmailChannel(id);
    } catch {
      emailChannel = null;
    }

    return res.json({
      organizationId: id,
      crm_company_id: organization.crm_company_id,
      users: portalUsers,
      emailChannel: emailChannel
        ? {
            id: emailChannel.id,
            mailbox: emailChannel.mailbox || emailChannel.email || null,
            connectionType: emailChannel.connectionType || null,
            enabled: emailChannel.enabled !== false,
          }
        : null,
      sso_enabled: organization.sso_enabled,
      m365_tenant_id: organization.m365_tenant_id,
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to list portal users') });
  }
});

/** GET /api/admin/organizations/:id (also /api/organizations/:id) */
router.get('/:id', requireHubcomStaff, async (req: Request, res: Response): Promise<any> => {
  const id = routeParam(req.params.id);
  try {
    const organization = await getOrganization(id);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    return res.json({
      organization: {
        ...organization,
        resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
        enabledModules: organizationEnabledModules(organization),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to load organization') });
  }
});

/** PUT /api/admin/organizations/:id */
router.put('/:id', requireRole(['SYSTEM_ADMIN']), async (req: Request, res: Response): Promise<any> => {
  const id = routeParam(req.params.id);
  const parsed = orgSchema.partial().safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid organization payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const payload = { ...parsed.data } as any;
    if (payload.hardware_returns_config) {
      payload.hardware_returns_config = normalizeHardwareReturnsConfig(
        payload.hardware_returns_config,
      );
    }
    const organization = await updateOrganization(id, payload);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    return res.json({
      organization: {
        ...organization,
        enabledModules: organizationEnabledModules(organization),
      },
    });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/unique|duplicate/i.test(message)) {
      return res.status(409).json({ error: 'Organization slug already exists.' });
    }
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to update organization') });
  }
});

/**
 * PUT /api/admin/organizations/:id/hardware-returns
 * SYSTEM_ADMIN — enable/disable module + edit recipient defaults.
 */
router.put(
  '/:id/hardware-returns',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const id = routeParam(req.params.id);
    const parsed = hardwareModuleSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid hardware-returns payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const organization = await updateOrganizationHardwareModule(id, {
        hardware_returns_enabled: parsed.data.hardware_returns_enabled,
        hardware_returns_config: parsed.data.hardware_returns_config
          ? normalizeHardwareReturnsConfig(parsed.data.hardware_returns_config)
          : undefined,
      });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({
        organization: {
          ...organization,
          enabledModules: organizationEnabledModules(organization),
        },
      });
    } catch (err: any) {
      return res
        .status(500)
        .json({ error: safeErrorMessage(err, 'Hardware-Modul konnte nicht gespeichert werden') });
    }
  },
);

/**
 * PUT /api/admin/organizations/:id/branding
 * Upload / update / clear portal logo + title (SYSTEM_ADMIN).
 */
router.put(
  '/:id/branding',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const id = routeParam(req.params.id);
    const parsed = brandingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid branding payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const existing = await getOrganization(id);
      if (!existing) return res.status(404).json({ error: 'Organization not found.' });

      const patch: { logo_url?: string | null; portal_title?: string | null } = {};

      if (parsed.data.clearLogo) {
        patch.logo_url = null;
      } else if (parsed.data.logoDataUrl !== undefined && parsed.data.logoDataUrl !== null) {
        const validated = parseAndValidateLogoDataUrl(parsed.data.logoDataUrl);
        if (validated.ok === false) {
          return res.status(400).json({ error: validated.error });
        }
        patch.logo_url = validated.dataUrl;
      }

      if (parsed.data.portal_title !== undefined) {
        patch.portal_title = parsed.data.portal_title;
      }

      const organization = await updateOrganizationBranding(id, patch);
      return res.json({
        organization: {
          ...organization,
          resolved_portal_title: resolvePortalTitle(
            organization!.name,
            organization!.portal_title,
          ),
        },
      });
    } catch (err: any) {
      safeLog('error', '[organizations] branding update failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to update branding') });
    }
  },
);

/** DELETE /api/admin/organizations/:id/logo */
router.delete(
  '/:id/logo',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const id = routeParam(req.params.id);
    try {
      const organization = await updateOrganizationBranding(id, { logo_url: null });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({ organization });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to delete logo') });
    }
  },
);

/**
 * POST /api/admin/organizations/:id/banner
 * Upload portal dashboard banner (SYSTEM_ADMIN). Body: { bannerDataUrl } or multipart-style data URL.
 */
router.post(
  '/:id/banner',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const id = routeParam(req.params.id);
    try {
      const existing = await getOrganization(id);
      if (!existing) return res.status(404).json({ error: 'Organization not found.' });

      const raw =
        (req.body as any)?.bannerDataUrl ??
        (req.body as any)?.imageDataUrl ??
        (req.body as any)?.portal_banner_url;
      const validated = parseAndValidateDashboardBannerDataUrl(raw);
      if (validated.ok === false) {
        return res.status(400).json({ error: validated.error });
      }

      const organization = await updateOrganizationBranding(id, {
        portal_banner_url: validated.dataUrl,
      });
      return res.json({ organization });
    } catch (err: any) {
      safeLog('error', '[organizations] banner upload failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Banner konnte nicht gespeichert werden') });
    }
  },
);

/** DELETE /api/admin/organizations/:id/banner */
router.delete(
  '/:id/banner',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const id = routeParam(req.params.id);
    try {
      const organization = await updateOrganizationBranding(id, { portal_banner_url: null });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({ organization });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Banner konnte nicht entfernt werden') });
    }
  },
);

/**
 * POST /api/admin/organizations/:id/invite-client-admin
 * Create (or promote) a portal user (CLIENT_ADMIN / CLIENT_SUPPORTER / CLIENT_USER)
 * and mirror them into CRM Kontakte for the linked Unternehmen.
 */
router.post('/:id/invite-client-admin', requireRole(['SYSTEM_ADMIN']), async (req: Request, res: Response): Promise<any> => {
  const organizationId = routeParam(req.params.id);
  const parsed = invitePortalUserSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid invite payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }

  try {
    const organization = await getOrganization(organizationId);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    if (!organization.is_active) {
      return res.status(400).json({ error: 'Organization is inactive.' });
    }

    await ensureCompanyForOrganization(organization);
    const role = (parsed.data.role || 'CLIENT_ADMIN') as ClientTeamRole;
    const invited = await createOrInviteTeamMember({
      organizationId,
      name: parsed.data.name,
      email: parsed.data.email,
      role,
      invitedBy: String(req.user?.id || 'system'),
    });

    await ensureContactForPortalUser({
      organizationId,
      name: parsed.data.name,
      email: parsed.data.email.toLowerCase().trim(),
      role,
      userId: invited.member.id,
      invitationStatus: invited.invitationStatus,
    });

    return res.status(invited.created ? 201 : 200).json({
      success: true,
      invited: invited.created,
      updated: !invited.created,
      user: {
        id: invited.member.id,
        email: invited.member.email,
        name: invited.member.name,
        role: invited.member.role,
        organizationId,
        invitationStatus: invited.invitationStatus,
      },
      emailSent: invited.emailSent,
      emailReason: invited.emailReason || null,
      invitationStatus: invited.invitationStatus,
      // setupLink only after send failure — never a password; invalidate via resend.
      setupLink: invited.emailSent ? null : invited.setupLink,
      organization,
    });
  } catch (err: any) {
    const status = Number(err?.status) || 500;
    safeLog('error', '[organizations] invite-client-admin failed', err?.message || err);
    return res
      .status(status >= 400 && status < 600 ? status : 500)
      .json({ error: safeErrorMessage(err, 'Failed to invite portal user') });
  }
});

/** PATCH /api/admin/organizations/:id/users/:userId — role / active flag */
router.patch(
  '/:id/users/:userId',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const userId = routeParam(req.params.userId);
    const parsed = patchPortalUserSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid portal user patch',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const organization = await getOrganization(organizationId);
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      const user = await getDocDirect('users', userId);
      if (!user || userOrganizationId(user) !== organizationId) {
        return res.status(404).json({ error: 'Portal user not found for this organization.' });
      }
      if (!isClientTeamRole(String(user.role || ''))) {
        return res.status(400).json({ error: 'User is not a client portal member.' });
      }

      const nextRole = (parsed.data.role || user.role) as ClientTeamRole;
      if (
        String(user.role) === 'CLIENT_ADMIN' &&
        (nextRole !== 'CLIENT_ADMIN' || parsed.data.isActive === false)
      ) {
        const remaining = await countActiveClientAdmins(organizationId, userId);
        if (remaining < 1) {
          return res.status(400).json({
            error: 'At least one active CLIENT_ADMIN is required per organization.',
          });
        }
      }

      const roleId = await ensureClientRoleDoc(nextRole);
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
        role: nextRole,
        roleId,
        can_view_knowledgebase: nextRole !== 'CLIENT_USER',
      };
      if (parsed.data.name !== undefined) updates.name = parsed.data.name;
      if (parsed.data.isActive !== undefined) updates.isDeactivated = !parsed.data.isActive;

      await updateDocDirect('users', userId, updates);
      await ensureContactForPortalUser({
        organizationId,
        name: String(parsed.data.name || user.name || ''),
        email: String(user.email || ''),
        role: nextRole,
        userId,
      });

      const refreshed = await getDocDirect('users', userId);
      return res.json({
        user: {
          id: userId,
          name: refreshed?.name || '',
          email: refreshed?.email || '',
          role: refreshed?.role || nextRole,
          isDeactivated: Boolean(refreshed?.isDeactivated),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to update portal user') });
    }
  },
);

/** POST /api/admin/organizations/:id/users/:userId/reset-password */
router.post(
  '/:id/users/:userId/reset-password',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const userId = routeParam(req.params.userId);
    try {
      const organization = await getOrganization(organizationId);
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      const user = await getDocDirect('users', userId);
      if (!user || userOrganizationId(user) !== organizationId) {
        return res.status(404).json({ error: 'Portal user not found for this organization.' });
      }
      const result = await resetTeamMemberPassword({
        organizationId,
        userId,
        requestedBy: String(req.user?.id || 'system'),
      });
      await ensureContactForPortalUser({
        organizationId,
        name: String(user.name || ''),
        email: String(user.email || ''),
        role: String(user.role || 'CLIENT_USER'),
        userId,
        invitationStatus: result.invitationStatus,
      });
      return res.json({
        ok: true,
        emailSent: result.emailSent,
        emailReason: result.emailReason || null,
        invitationStatus: result.invitationStatus,
        setupLink: result.emailSent ? null : result.setupLink,
      });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      return res
        .status(status >= 400 && status < 600 ? status : 500)
        .json({ error: safeErrorMessage(err, 'Failed to reset password') });
    }
  },
);

/**
 * POST /api/admin/organizations/:id/users/:userId/set-password
 * SYSTEM_ADMIN deliberately sets a portal user password (never returned).
 */
router.post(
  '/:id/users/:userId/set-password',
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const userId = routeParam(req.params.userId);
    const parsed = z
      .object({
        password: z.string().min(10).max(200),
        confirm: z.boolean().optional(),
      })
      .safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid password payload (10–200 characters required).',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    if (parsed.data.confirm !== true) {
      return res.status(400).json({
        error: 'Confirmation required: set confirm=true to apply the new password.',
      });
    }
    try {
      const organization = await getOrganization(organizationId);
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      const result = await setTeamMemberPassword({
        organizationId,
        userId,
        password: parsed.data.password,
        setBy: String(req.user?.id || 'system'),
      });
      return res.json({
        ok: true,
        user: {
          id: result.member.id,
          email: result.member.email,
          name: result.member.name,
          role: result.member.role,
          invitationStatus: 'accepted',
        },
      });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      return res
        .status(status >= 400 && status < 600 ? status : 500)
        .json({ error: safeErrorMessage(err, 'Failed to set password') });
    }
  },
);

const staffVaultWriteSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(40).optional(),
  notes: z.string().max(4000).optional().nullable(),
  value: z.string().min(1).max(100_000),
  /** CRITICAL: defaults false — Hubcom-internal unless explicitly shared. */
  client_visible: z.boolean().optional().default(false),
});

/** GET /api/admin/organizations/:id/vault — list durable Tresor entries for a Kunden org. */
router.get('/:id/vault', requireHubcomStaff, async (req: Request, res: Response): Promise<any> => {
  const organizationId = routeParam(req.params.id);
  try {
    const organization = await getOrganization(organizationId);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    const secrets = await listOrgVaultSecrets({
      organizationId,
      clientVisibleOnly: false,
      category: typeof req.query.category === 'string' ? req.query.category : null,
      q: typeof req.query.q === 'string' ? req.query.q : null,
    });
    return res.json({ secrets });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Tresor konnte nicht geladen werden') });
  }
});

/** POST /api/admin/organizations/:id/vault — create secret (client_visible default false). */
router.post('/:id/vault', requireHubcomStaff, async (req: Request, res: Response): Promise<any> => {
  const organizationId = routeParam(req.params.id);
  const parsed = staffVaultWriteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid vault payload',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const organization = await getOrganization(organizationId);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    const secret = await createOrgVaultSecret({
      organizationId,
      clientVisible: Boolean(parsed.data.client_visible),
      createdByUserId: String(req.user?.id || 'system'),
      name: parsed.data.name,
      category: normalizeOrgVaultCategory(parsed.data.category),
      notes: parsed.data.notes,
      plaintext: parsed.data.value,
    });
    await appendOrgVaultAudit({
      secretId: secret.id,
      organizationId,
      actorUserId: String(req.user?.id || 'system'),
      actorEmail: req.user?.email,
      action: 'create',
      detail: `Staff create (client_visible=${secret.client_visible}): ${secret.name}`,
    });
    return res.status(201).json({ secret });
  } catch (err: any) {
    safeLog('error', '[organizations/vault] create failed', err?.message || err);
    const message = String(err?.message || '');
    if (message.includes('VAULT_ENCRYPTION_KEY')) {
      return res.status(503).json({ error: 'Vault encryption is not configured.' });
    }
    return res.status(500).json({ error: safeErrorMessage(err, 'Geheimnis konnte nicht gespeichert werden') });
  }
});

/** PATCH /api/admin/organizations/:id/vault/:secretId */
router.patch(
  '/:id/vault/:secretId',
  requireHubcomStaff,
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const secretId = routeParam(req.params.secretId);
    try {
      const existing = await getOrgVaultSecretById(secretId);
      if (!existing || existing.organization_id !== organizationId) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      const body = req.body || {};
      const secret = await updateOrgVaultSecret({
        id: secretId,
        updatedByUserId: String(req.user?.id || 'system'),
        name: typeof body.name === 'string' ? body.name : undefined,
        category: typeof body.category === 'string' ? body.category : undefined,
        notes: body.notes !== undefined ? body.notes : undefined,
        plaintext: typeof body.value === 'string' ? body.value : undefined,
        clientVisible:
          typeof body.client_visible === 'boolean' ? body.client_visible : undefined,
      });
      if (
        typeof body.client_visible === 'boolean' &&
        body.client_visible !== existing.client_visible
      ) {
        await appendOrgVaultAudit({
          secretId,
          organizationId,
          actorUserId: String(req.user?.id || 'system'),
          actorEmail: req.user?.email,
          action: 'toggle_client_visible',
          detail: `client_visible ${existing.client_visible} → ${body.client_visible}`,
        });
      } else {
        await appendOrgVaultAudit({
          secretId,
          organizationId,
          actorUserId: String(req.user?.id || 'system'),
          actorEmail: req.user?.email,
          action: 'update',
          detail: `Staff update: ${secret?.name || secretId}`,
        });
      }
      return res.json({ secret });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Eintrag konnte nicht gespeichert werden') });
    }
  },
);

/** POST /api/admin/organizations/:id/vault/:secretId/reveal */
router.post(
  '/:id/vault/:secretId/reveal',
  requireHubcomStaff,
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const secretId = routeParam(req.params.secretId);
    try {
      const existing = await getOrgVaultSecretById(secretId);
      if (!existing || existing.organization_id !== organizationId) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      const value = await revealOrgVaultSecretPlaintext(secretId);
      if (value == null) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      await appendOrgVaultAudit({
        secretId,
        organizationId,
        actorUserId: String(req.user?.id || 'system'),
        actorEmail: req.user?.email,
        action: String((req.body as any)?.purpose || '') === 'copy' ? 'copy' : 'reveal',
      });
      return res.json({ id: secretId, value, secret: toOrgVaultListItem(existing) });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Entschlüsselung fehlgeschlagen') });
    }
  },
);

/** DELETE /api/admin/organizations/:id/vault/:secretId */
router.delete(
  '/:id/vault/:secretId',
  requireHubcomStaff,
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = routeParam(req.params.id);
    const secretId = routeParam(req.params.secretId);
    try {
      const existing = await getOrgVaultSecretById(secretId);
      if (!existing || existing.organization_id !== organizationId) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      await deleteOrgVaultSecret(secretId);
      await appendOrgVaultAudit({
        secretId,
        organizationId,
        actorUserId: String(req.user?.id || 'system'),
        actorEmail: req.user?.email,
        action: 'delete',
        detail: `Staff delete: ${existing.name}`,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Löschen fehlgeschlagen') });
    }
  },
);

export default router;
