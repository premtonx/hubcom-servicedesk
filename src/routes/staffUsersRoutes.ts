/**
 * Hubcom staff directory + permission matrix APIs.
 * Mount: /api/admin
 *
 * GET    /staff-users
 * POST   /staff-users/invite
 * PATCH  /staff-users/:userId
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireCanManageHubcomCore,
} from '../middleware/authMiddleware.js';
import { forbidClientPortalRoles } from '../middleware/clientPortalMiddleware.js';
import { tenantRlsMiddleware } from '../lib/security/tenant-rls.js';
import {
  addDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { hashPassword } from '../lib/crypto.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { isClientPortalRole } from '../lib/client-portal/roles.js';
import { getOrganization, listOrganizations } from '../lib/client-portal/organizations.js';
import { normalizeApprovalStatus } from '../lib/client-portal/sso-approval.js';
import {
  HUBCOM_MATRIX_ROLES,
  isOrgAccessRole,
  listUserOrganizationAccess,
  normalizeHubcomMatrixRole,
  replaceUserOrganizationAccess,
  type OrgAccessRole,
} from '../lib/staff-org-access.js';
import { deriveKuerzel } from '../lib/entra/user-helpers.js';

const router = Router();

router.use(authenticate, tenantRlsMiddleware, forbidClientPortalRoles, requireCanManageHubcomCore);

const matrixRoleEnum = z.enum([
  'SUPER_ADMIN',
  'HUBCOM_ADMIN',
  'HUBCOM_AGENT',
  'HUBCOM_USER',
]);

const orgAssignmentSchema = z.object({
  organization_id: z.string().uuid(),
  access_role: z.enum(['ORG_ADMIN', 'ORG_AGENT']),
});

const inviteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim()),
  role: matrixRoleEnum.default('HUBCOM_USER'),
  approval_status: z.enum(['active', 'pending_approval', 'rejected']).optional(),
  organization_access: z.array(orgAssignmentSchema).optional().default([]),
  authMethod: z.enum(['password', 'microsoft365']).optional().default('microsoft365'),
  password: z.string().min(8).max(200).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: matrixRoleEnum.optional(),
  approval_status: z.enum(['active', 'pending_approval', 'rejected']).optional(),
  isDeactivated: z.boolean().optional(),
  organization_access: z.array(orgAssignmentSchema).optional(),
});

function isStaffUserDoc(u: Record<string, unknown>): boolean {
  const role = String(u.role || '');
  if (isClientPortalRole(role)) return false;
  const orgId =
    (typeof u.organizationId === 'string' && u.organizationId.trim()) ||
    (typeof u.organization_id === 'string' && u.organization_id.trim()) ||
    '';
  // External portal accounts always have organization_id; staff have null.
  if (orgId && isClientPortalRole(role)) return false;
  if (role === 'customer' || role === 'CLIENT' || role === 'Kunde') return false;
  return true;
}

async function formatStaffUser(u: Record<string, any>) {
  const role = normalizeHubcomMatrixRole(u.role, u.is_admin === true);
  const access = await listUserOrganizationAccess(String(u.id));
  return {
    id: u.id,
    name: u.name || '',
    email: u.email || '',
    kuerzel: u.kuerzel || '',
    role,
    is_admin: role === 'SUPER_ADMIN',
    approval_status: normalizeApprovalStatus(u.approval_status ?? u.approvalStatus),
    authMethod: u.authMethod || 'password',
    isDeactivated: u.isDeactivated === true,
    organization_access: access.map((a) => ({
      organization_id: a.organization_id,
      access_role: a.access_role,
      created_at: a.created_at,
      created_by: a.created_by,
    })),
    createdAt: u.createdAt || null,
    lastActiveAt: u.lastActiveAt || u.lastLoginAt || null,
  };
}

/** GET /api/admin/staff-users */
router.get('/staff-users', async (_req: Request, res: Response): Promise<any> => {
  try {
    const users = await getDocsDirect('users', []);
    const staff = users.filter((u) => isStaffUserDoc(u as any));
    const formatted = await Promise.all(staff.map((u) => formatStaffUser(u)));
    formatted.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return res.json({ users: formatted, roles: HUBCOM_MATRIX_ROLES });
  } catch (err: any) {
    safeLog('error', '[staff-users] list failed', err?.message || err);
    return res.status(500).json({ error: safeErrorMessage(err, 'Mitarbeiter konnten nicht geladen werden') });
  }
});

/** POST /api/admin/staff-users/invite */
router.post('/staff-users/invite', async (req: Request, res: Response): Promise<any> => {
  const parsed = inviteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige Einladung',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const email = parsed.data.email;
    const existing = await getDocsDirect('users', [
      { type: 'where', field: 'email', op: '==', value: email },
    ]);
    if (existing?.length) {
      return res.status(409).json({ error: 'Ein Benutzer mit dieser E-Mail existiert bereits.' });
    }

    // Validate org assignments exist
    for (const a of parsed.data.organization_access) {
      const org = await getOrganization(a.organization_id);
      if (!org) {
        return res.status(400).json({
          error: `Organisation ${a.organization_id} nicht gefunden.`,
        });
      }
    }

    const role = parsed.data.role;
    const approval =
      parsed.data.approval_status ||
      (parsed.data.authMethod === 'microsoft365' ? 'pending_approval' : 'active');
    const now = new Date().toISOString();
    const passwordHash =
      parsed.data.authMethod === 'password' && parsed.data.password
        ? await hashPassword(parsed.data.password)
        : null;

    const created = await addDocDirect('users', {
      name: parsed.data.name.trim(),
      email,
      kuerzel: deriveKuerzel(parsed.data.name),
      role,
      is_admin: role === 'SUPER_ADMIN',
      authMethod: parsed.data.authMethod,
      passwordHash,
      approval_status: approval,
      organizationId: null,
      organization_id: null,
      isDeactivated: false,
      can_create_tickets: true,
      can_view_knowledgebase: true,
      invitedBy: String(req.user!.id),
      createdAt: now,
      updatedAt: now,
    });

    const access = await replaceUserOrganizationAccess({
      userId: created.id,
      assignments: parsed.data.organization_access.map((a) => ({
        organization_id: a.organization_id,
        access_role: a.access_role as OrgAccessRole,
      })),
      createdBy: String(req.user!.id),
    });

    const user = await getDocDirect('users', created.id);
    return res.status(201).json({
      success: true,
      user: await formatStaffUser({ id: created.id, ...(user || {}) }),
      organization_access: access,
    });
  } catch (err: any) {
    safeLog('error', '[staff-users] invite failed', err?.message || err);
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Einladung fehlgeschlagen') });
  }
});

/** PATCH /api/admin/staff-users/:userId */
router.patch('/staff-users/:userId', async (req: Request, res: Response): Promise<any> => {
  const userId = routeParam(req.params.userId);
  const parsed = patchSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Ungültige Aktualisierung',
      details: parsed.error.flatten().fieldErrors,
    });
  }
  try {
    const user = await getDocDirect('users', userId);
    if (!user || !isStaffUserDoc(user as any)) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name != null) updates.name = parsed.data.name.trim();
    if (parsed.data.role != null) {
      updates.role = parsed.data.role;
      updates.is_admin = parsed.data.role === 'SUPER_ADMIN';
    }
    if (parsed.data.approval_status != null) {
      updates.approval_status = parsed.data.approval_status;
      if (parsed.data.approval_status === 'active') {
        updates.approvedAt = new Date().toISOString();
        updates.approvedBy = String(req.user!.id);
      }
      if (parsed.data.approval_status === 'rejected') {
        updates.rejectedAt = new Date().toISOString();
        updates.rejectedBy = String(req.user!.id);
      }
    }
    if (parsed.data.isDeactivated != null) {
      updates.isDeactivated = parsed.data.isDeactivated;
    }

    await updateDocDirect('users', userId, updates);

    if (parsed.data.organization_access) {
      for (const a of parsed.data.organization_access) {
        if (!isOrgAccessRole(a.access_role)) {
          return res.status(400).json({ error: 'Ungültige access_role.' });
        }
        const org = await getOrganization(a.organization_id);
        if (!org) {
          return res.status(400).json({
            error: `Organisation ${a.organization_id} nicht gefunden.`,
          });
        }
      }
      await replaceUserOrganizationAccess({
        userId,
        assignments: parsed.data.organization_access,
        createdBy: String(req.user!.id),
      });
    }

    const refreshed = await getDocDirect('users', userId);
    return res.json({
      success: true,
      user: await formatStaffUser({ id: userId, ...(refreshed || {}) }),
    });
  } catch (err: any) {
    safeLog('error', '[staff-users] patch failed', err?.message || err);
    return res
      .status(500)
      .json({ error: safeErrorMessage(err, 'Aktualisierung fehlgeschlagen') });
  }
});

/** GET /api/admin/staff-users/meta — orgs available for assignment */
router.get('/staff-users/meta', async (_req: Request, res: Response): Promise<any> => {
  try {
    const orgs = await listOrganizations({ includeInactive: false });
    return res.json({
      roles: HUBCOM_MATRIX_ROLES,
      organizations: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: safeErrorMessage(err, 'Meta fehlgeschlagen') });
  }
});

export default router;
