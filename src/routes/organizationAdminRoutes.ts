/**
 * Hubcom SYSTEM_ADMIN controls for Client Organizations (Kunden)
 * and initial CLIENT_ADMIN provisioning.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
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
  addDocDirect,
  getDocsDirect,
  setDocDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { hashPassword } from '../lib/crypto.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { CLIENT_PORTAL_ROLE_SEEDS, isHubcomStaffRole } from '../lib/client-portal/roles.js';
import {
  parseAndValidateLogoDataUrl,
  resolvePortalTitle,
} from '../lib/client-portal/org-branding.js';

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
});

const inviteClientAdminSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  temporaryPassword: z.string().min(10).max(200).optional(),
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
    const organization = await createOrganization(parsed.data);
    return res.status(201).json({ organization });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (/unique|duplicate/i.test(message)) {
      return res.status(409).json({ error: 'Organization slug already exists.' });
    }
    safeLog('error', '[organizations] create failed', message);
    return res.status(500).json({ error: safeErrorMessage(err, 'Failed to create organization') });
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
 * Create (or promote) the initial CLIENT_ADMIN for a Kunden organization.
 */
router.post('/:id/invite-client-admin', requireRole(['SYSTEM_ADMIN']), async (req: Request, res: Response): Promise<any> => {
  const organizationId = routeParam(req.params.id);
  const parsed = inviteClientAdminSchema.safeParse(req.body || {});
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

    // Ensure CLIENT_ADMIN role document exists with a stable id.
    const roleSeed = CLIENT_PORTAL_ROLE_SEEDS.find((r) => r.name === 'CLIENT_ADMIN')!;
    const roleId = roleSeed.id;
    await setDocDirect('roles', roleId, {
      ...roleSeed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const email = parsed.data.email.toLowerCase().trim();
    const existingUsers = await getDocsDirect('users', [
      { type: 'where', field: 'email', op: '==', value: email },
    ]);

    const tempPassword =
      parsed.data.temporaryPassword || randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(tempPassword);
    const now = new Date().toISOString();

    if (existingUsers.length > 0) {
      const user = existingUsers[0];
      await updateDocDirect('users', user.id, {
        name: parsed.data.name,
        role: 'CLIENT_ADMIN',
        roleId,
        organizationId,
        organization_id: organizationId,
        is_admin: false,
        can_create_tickets: true,
        can_view_knowledgebase: true,
        authMethod: user.authMethod || 'password',
        password: passwordHash,
        updatedAt: now,
      });
      return res.status(200).json({
        success: true,
        invited: false,
        updated: true,
        user: {
          id: user.id,
          email,
          name: parsed.data.name,
          role: 'CLIENT_ADMIN',
          organizationId,
        },
        temporaryPassword: tempPassword,
        organization,
      });
    }

    const created = await addDocDirect('users', {
      name: parsed.data.name,
      email,
      role: 'CLIENT_ADMIN',
      roleId,
      organizationId,
      organization_id: organizationId,
      is_admin: false,
      can_create_tickets: true,
      can_view_knowledgebase: true,
      authMethod: 'password',
      password: passwordHash,
      isDeactivated: false,
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json({
      success: true,
      invited: true,
      updated: false,
      user: {
        id: created.id,
        email,
        name: parsed.data.name,
        role: 'CLIENT_ADMIN',
        organizationId,
      },
      temporaryPassword: tempPassword,
      organization,
    });
  } catch (err: any) {
    safeLog('error', '[organizations] invite-client-admin failed', err?.message || err);
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Failed to invite CLIENT_ADMIN') });
  }
});

export default router;
