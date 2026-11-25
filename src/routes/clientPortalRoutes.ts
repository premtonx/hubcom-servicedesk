/**
 * Client-facing portal APIs (CLIENT_ADMIN / CLIENT_SUPPORTER / CLIENT_USER).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  attachClientOrganizationContext,
  requireClientPortalRole,
} from '../middleware/clientPortalMiddleware.js';
import { getDocsDirect } from '../lib/postgres-backend.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  getOrganization,
  organizationEnabledModules,
  updateOrganizationBranding,
} from '../lib/client-portal/organizations.js';
import {
  parseAndValidateLogoDataUrl,
  resolvePortalTitle,
} from '../lib/client-portal/org-branding.js';
import { parseAndValidateDashboardBannerDataUrl } from '../lib/dashboard-banner-validate.js';

const router = Router();

router.use(authenticate, attachClientOrganizationContext);

async function loadOrgBranding(organizationId: string | null | undefined) {
  if (!organizationId) return null;
  const org = await getOrganization(organizationId);
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    logo_url: org.logo_url,
    portal_title: org.portal_title,
    portal_banner_url: org.portal_banner_url,
    resolved_portal_title: resolvePortalTitle(org.name, org.portal_title),
    hardware_returns_enabled: Boolean(org.hardware_returns_enabled),
    enabledModules: organizationEnabledModules(org),
  };
}

/** GET /api/portal/me — session identity for the Kunden-Portal shell. */
router.get('/me', requireClientPortalRole(), async (req: Request, res: Response): Promise<any> => {
  const organizationId = resolveOrganizationIdFromUser(req.user!);
  const organization = await loadOrgBranding(organizationId);
  return res.json({
    user: {
      id: req.user!.id,
      name: req.user!.name,
      email: req.user!.email,
      role: req.user!.role,
      organizationId,
    },
    organization,
    enabledModules: organization?.enabledModules || { hardwareReturns: false },
  });
});

/** GET /api/portal/organization — branding for the signed-in client org. */
router.get(
  '/organization',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      const organization = await loadOrgBranding(organizationId);
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({ organization });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to load organization') });
    }
  },
);

const portalBrandingSchema = z.object({
  logoDataUrl: z.string().min(1).optional().nullable(),
  portal_title: z.string().max(120).optional().nullable(),
  clearLogo: z.boolean().optional(),
});

/**
 * PUT /api/portal/organization/branding
 * CLIENT_ADMIN only — scoped strictly to their own organization_id.
 */
router.put(
  '/organization/branding',
  requireClientPortalRole(['CLIENT_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const parsed = portalBrandingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid branding payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

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

      const organization = await updateOrganizationBranding(organizationId, patch);
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({
        organization: {
          id: organization.id,
          name: organization.name,
          logo_url: organization.logo_url,
          portal_title: organization.portal_title,
          resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
        },
      });
    } catch (err: any) {
      safeLog('error', '[portal] branding update failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to update branding') });
    }
  },
);

/** DELETE /api/portal/organization/logo — CLIENT_ADMIN, own org only. */
router.delete(
  '/organization/logo',
  requireClientPortalRole(['CLIENT_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const organization = await updateOrganizationBranding(organizationId, { logo_url: null });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({
        organization: {
          id: organization.id,
          name: organization.name,
          logo_url: organization.logo_url,
          portal_title: organization.portal_title,
          portal_banner_url: organization.portal_banner_url,
          resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to delete logo') });
    }
  },
);

/**
 * POST /api/portal/branding/banner — CLIENT_ADMIN, own organization only.
 * Body: { bannerDataUrl } (PNG/JPEG/WebP, max 2 MB).
 */
router.post(
  '/branding/banner',
  requireClientPortalRole(['CLIENT_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const raw =
        (req.body as any)?.bannerDataUrl ??
        (req.body as any)?.imageDataUrl ??
        (req.body as any)?.portal_banner_url;
      const validated = parseAndValidateDashboardBannerDataUrl(raw);
      if (validated.ok === false) {
        return res.status(400).json({ error: validated.error });
      }
      const organization = await updateOrganizationBranding(organizationId, {
        portal_banner_url: validated.dataUrl,
      });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({
        organization: {
          id: organization.id,
          name: organization.name,
          logo_url: organization.logo_url,
          portal_title: organization.portal_title,
          portal_banner_url: organization.portal_banner_url,
          resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
        },
      });
    } catch (err: any) {
      safeLog('error', '[portal] banner upload failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Banner konnte nicht gespeichert werden') });
    }
  },
);

/** DELETE /api/portal/branding/banner — CLIENT_ADMIN, own organization only. */
router.delete(
  '/branding/banner',
  requireClientPortalRole(['CLIENT_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const organization = await updateOrganizationBranding(organizationId, {
        portal_banner_url: null,
      });
      if (!organization) return res.status(404).json({ error: 'Organization not found.' });
      return res.json({
        organization: {
          id: organization.id,
          name: organization.name,
          logo_url: organization.logo_url,
          portal_title: organization.portal_title,
          portal_banner_url: organization.portal_banner_url,
          resolved_portal_title: resolvePortalTitle(organization.name, organization.portal_title),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Banner konnte nicht entfernt werden') });
    }
  },
);

/** GET /api/portal/members — same-organization directory. */
router.get(
  '/members',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      const users = await getDocsDirect('users', []);
      let members = users
        .filter((u) => {
          const oid =
            (typeof u.organizationId === 'string' && u.organizationId) ||
            (typeof u.organization_id === 'string' && u.organization_id) ||
            '';
          return oid === organizationId;
        })
        .map((u) => ({
          id: u.id,
          name: u.name || '',
          email: u.email || '',
          role: u.role || 'CLIENT_USER',
          isDeactivated: u.isDeactivated === true,
        }));

      if (req.user!.role === 'CLIENT_USER') {
        members = members.filter((m) => m.id === req.user!.id);
      }

      return res.json({ members });
    } catch (err: any) {
      safeLog('error', '[portal] list members failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Failed to list members') });
    }
  },
);

const inviteMemberSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  role: z.enum(['CLIENT_SUPPORTER', 'CLIENT_USER']),
});

/** POST /api/portal/members — CLIENT_ADMIN invites a colleague (secure setup link). */
router.post(
  '/members',
  requireClientPortalRole(['CLIENT_ADMIN']),
  async (req: Request, res: Response): Promise<any> => {
    const parsed = inviteMemberSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid member payload',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

      const { createOrInviteTeamMember } = await import('../lib/client-portal/team-service.js');
      const result = await createOrInviteTeamMember({
        organizationId,
        name: parsed.data.name,
        email: parsed.data.email,
        role: parsed.data.role,
        invitedBy: String(req.user!.id),
      });

      return res.status(result.created ? 201 : 200).json({
        success: true,
        member: {
          id: result.member.id,
          name: result.member.name,
          email: result.member.email,
          role: result.member.role,
        },
        emailSent: result.emailSent,
        emailReason: result.emailReason || null,
        invitationStatus: result.invitationStatus,
        setupLink: result.emailSent ? null : result.setupLink,
      });
    } catch (err: any) {
      const status = Number(err?.status) || 500;
      safeLog('error', '[portal] invite member failed', err?.message || err);
      return res
        .status(status >= 400 && status < 600 ? status : 500)
        .json({ error: safeErrorMessage(err, 'Failed to invite member') });
    }
  },
);

/**
 * GET /api/portal/dashboard
 * Role-aware first-page payload, strictly scoped to req.user.organization_id.
 * CLIENT_USER sees only own/participant tickets; never returns internal notes
 * or cross-tenant data.
 */
router.get(
  '/dashboard',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = resolveOrganizationIdFromUser(req.user!);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organisation fehlt.' });
      }

      // Reject spoofed cross-tenant query params.
      const spoofed =
        req.query.organizationId ||
        req.query.organization_id ||
        (req.body && (req.body.organizationId || req.body.organization_id));
      if (spoofed && String(spoofed) !== organizationId) {
        return res.status(403).json({ error: 'Mandantenübergreifender Zugriff verweigert.' });
      }

      const org = await getOrganization(organizationId);
      if (!org || !org.is_active) {
        return res.status(404).json({ error: 'Organisation nicht gefunden.' });
      }

      const role = String(req.user!.role || '');
      const userId = String(req.user!.id);
      const { listTicketIdsForParticipant } = await import(
        '../lib/client-portal/ticket-participants.js'
      );
      const { buildPortalDashboardPayload } = await import(
        '../lib/client-portal/portal-dashboard-service.js'
      );
      const { listOrganizationUsers } = await import('../lib/client-portal/team-service.js');
      const { findOrganizationEmailChannel } = await import(
        '../lib/email-ingestion/channel-store.js'
      );

      const allTickets = await getDocsDirect('tickets', []);
      const orgTickets = allTickets.filter((t) => {
        const oid = String(t.organizationId || t.organization_id || '').trim();
        return oid === organizationId;
      });

      let participantTicketIds: string[] = [];
      if (role === 'CLIENT_USER') {
        participantTicketIds = await listTicketIdsForParticipant(userId);
      }

      let teamSummary = null;
      let emailStatus = null;

      if (role === 'CLIENT_ADMIN') {
        const members = await listOrganizationUsers(organizationId);
        const active = members.filter((m) => m.isActive);
        teamSummary = {
          totalActive: active.length,
          clientAdmins: active.filter((m) => m.role === 'CLIENT_ADMIN').length,
          clientSupporters: active.filter((m) => m.role === 'CLIENT_SUPPORTER').length,
          clientUsers: active.filter((m) => m.role === 'CLIENT_USER').length,
        };

        const channel = await findOrganizationEmailChannel(organizationId);
        emailStatus = {
          configured: Boolean(channel),
          healthy:
            Boolean(channel) &&
            channel!.status !== 'disabled' &&
            channel!.status !== 'auth_error' &&
            channel!.status !== 'failed' &&
            channel!.lastTestOk !== false,
          mailbox: channel?.mailbox || channel?.email || null,
          status: channel?.status || null,
          sendAsEnabled: channel?.sendAsEnabled === true,
        };
      }

      let returnsKpis = null;
      const hardwareReturnsEnabled = Boolean(org.hardware_returns_enabled);
      if (
        hardwareReturnsEnabled &&
        (role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER')
      ) {
        try {
          const { listHardwareReturnsWorkbench } = await import(
            '../lib/client-portal/hardware-returns-escalation.js'
          );
          const listed = await listHardwareReturnsWorkbench({
            organizationId,
            view: 'all',
            limit: 1,
            offset: 0,
          });
          returnsKpis = {
            open: listed.kpis.open,
            overdue: listed.kpis.overdue,
            stage3: listed.kpis.stage3,
            returnedLast30: listed.kpis.returnedLast30,
          };
        } catch (err: any) {
          safeLog('warn', '[portal] dashboard returns KPIs skipped', err?.message || err);
          returnsKpis = null;
        }
      }

      const payload = buildPortalDashboardPayload({
        role,
        userId,
        userName: String(req.user!.name || req.user!.email || ''),
        organizationId,
        organization: {
          id: org.id,
          name: org.name,
          logoUrl: org.logo_url,
          portalBannerUrl: org.portal_banner_url,
          portalTitle: resolvePortalTitle(org.name, org.portal_title),
          hardwareReturnsEnabled,
        },
        tickets: orgTickets,
        participantTicketIds,
        teamSummary,
        emailStatus,
        returnsKpis,
      });

      return res.json(payload);
    } catch (err: any) {
      if (err?.status === 403) {
        return res.status(403).json({ error: err.message || 'Zugriff verweigert.' });
      }
      safeLog('error', '[portal] dashboard failed', err?.message || err);
      return res.status(500).json({
        error: safeErrorMessage(err, 'Dashboard konnte nicht geladen werden'),
      });
    }
  },
);

export default router;
