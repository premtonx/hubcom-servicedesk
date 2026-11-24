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
  updateOrganization,
  updateOrganizationBranding,
} from '../lib/client-portal/organizations.js';
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
import { findOrganizationEmailChannel } from '../lib/email-ingestion/channel-store.js';
import {
  CLIENT_TEAM_ROLES,
  countActiveClientAdmins,
  createOrInviteTeamMember,
  ensureClientRoleDoc,
  isClientTeamRole,
  portalUserListItem,
  resetTeamMemberPassword,
  userOrganizationId,
  type ClientTeamRole,
} from '../lib/client-portal/team-service.js';

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
  is_demo: z.boolean().optional(),
  crm_company_id: z.string().max(120).optional().nullable(),
  logo_url: z.string().max(400_000).optional().nullable(),
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

/** GET /api/admin/organizations/:id */
router.get('/:id', requireHubcomStaff, async (req: Request, res: Response): Promise<any> => {
  const id = routeParam(req.params.id);
  try {
    const organization = await getOrganization(id);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    return res.json({
      organization: {
        ...organization,
        resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
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
    const organization = await updateOrganization(id, parsed.data);
    if (!organization) return res.status(404).json({ error: 'Organization not found.' });
    return res.json({ organization });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/unique|duplicate/i.test(message)) {
      return res.status(409).json({ error: 'Organization slug already exists.' });
    }
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to update organization') });
  }
});

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
      // setupLink is returned only so admins can copy a resend when mail failed —
      // never a password. Prefer email delivery.
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

export default router;
