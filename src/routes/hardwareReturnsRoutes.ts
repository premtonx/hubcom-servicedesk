/**
 * Staff `/api/returns/*` and Portal `/api/portal/returns/*` — Hardware-Rücklieferungen workbench.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  requireClientPortalRole,
  requireHubcomStaff,
} from '../middleware/clientPortalMiddleware.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  getOrganization,
  organizationEnabledModules,
  updateOrganizationHardwareModule,
} from '../lib/client-portal/organizations.js';
import {
  normalizeHardwareReturnsConfig,
  sanitizeHardwareReturnsConfigForClient,
} from '../lib/client-portal/hardware-returns.js';
import {
  bulkHardwareReturnsAction,
  createHardwareReturnFromWorkbench,
  listHardwareReturnsWorkbench,
  markHardwareReturned,
  previewHardwareReminder,
  sendHardwareReminder,
} from '../lib/client-portal/hardware-returns-escalation.js';
import {
  commitSharePointReturnsImport,
  previewSharePointReturnsImport,
} from '../lib/client-portal/hardware-returns-csv-import.js';
import {
  appendHardwareReturnActivity,
  deleteHardwareReturn,
  evaluateHardwareCatalogsWriteAccess,
  evaluateHardwareModuleAccess,
  listHardwareReturnAssignees,
  resolveHardwareReturnByParam,
  updateHardwareReturnById,
} from '../lib/client-portal/hardware-returns.js';
import {
  evaluateDirectorySearchAccess,
  searchOrganizationDirectoryUsers,
  syncOrganizationDirectoryFromGraph,
} from '../lib/client-portal/organization-directory-sync.js';
import { isClientPortalRole, isHubcomStaffRole } from '../lib/client-portal/roles.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage } from '../lib/safe-log.js';
import {
  isValidReminderStage,
  type ReminderStage,
} from '../lib/client-portal/hardware-returns-recipients.js';
import {
  getCachedPortalReturnsTrends,
  invalidatePortalReturnsCache,
  setCachedPortalReturnsTrends,
} from '../lib/client-portal/portal-returns-cache.js';
import {
  loadPortalReturnsTrendsSql,
  parsePortalReturnsTrendTimeframe,
} from '../lib/client-portal/portal-returns-sql-stats.js';

function stageFromQuery(raw: unknown): ReminderStage | null {
  return isValidReminderStage(raw) ? Number(raw) : null;
}

function bumpReturnsCache(organizationId: string): void {
  invalidatePortalReturnsCache(organizationId);
}

async function resolveOrgForReturns(
  req: Request,
  res: Response,
  preferredOrgId?: string | null,
): Promise<{ organizationId: string; role: string } | null> {
  const role = String(req.user?.role || '');
  if (isClientPortalRole(role)) {
    const organizationId = resolveOrganizationIdFromUser(req.user!);
    if (!organizationId) {
      res.status(403).json({ error: 'Forbidden: no organization.' });
      return null;
    }
    if (role === 'CLIENT_USER') {
      res.status(403).json({ error: 'Forbidden: CLIENT_USER cannot access Rücklieferungen.' });
      return null;
    }
    const org = await getOrganization(organizationId);
    if (!org?.hardware_returns_enabled) {
      res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
      return null;
    }
    const gate = evaluateHardwareModuleAccess({
      orgEnabled: true,
      sessionOrgId: organizationId,
      ticketOrgId: organizationId,
      role,
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    });
    if (gate.ok === false) {
      res.status(gate.status).json({ error: 'Forbidden.' });
      return null;
    }
    return { organizationId, role };
  }

  if (!isHubcomStaffRole(role) && role !== 'SYSTEM_ADMIN' && role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Forbidden.' });
    return null;
  }
  const organizationId = String(preferredOrgId || req.query.organizationId || '').trim();
  if (!organizationId) {
    res.status(400).json({ error: 'organizationId ist erforderlich.' });
    return null;
  }
  const { canAccessOrganization } = await import('../lib/staff-org-access.js');
  const allowed = await canAccessOrganization(req.user as any, organizationId);
  if (!allowed) {
    res.status(403).json({
      error: 'Forbidden: Keine Berechtigung für diese Organisation.',
    });
    return null;
  }
  const org = await getOrganization(organizationId);
  if (!org?.hardware_returns_enabled) {
    res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
    return null;
  }
  return { organizationId, role };
}

function mountReturnsRoutes(router: Router, mode: 'staff' | 'portal'): void {
  const listHandler = async (req: Request, res: Response): Promise<any> => {
    try {
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const result = await listHardwareReturnsWorkbench({
        organizationId: ctx.organizationId,
        view: (req.query.view as any) || 'open',
        search: String(req.query.q || req.query.search || ''),
        mailStatus: (req.query.mailStatus as any) || 'all',
        overdueBucket: (req.query.overdueBucket as any) || 'all',
        deliveryFrom: String(req.query.deliveryFrom || '') || undefined,
        deliveryTo: String(req.query.deliveryTo || '') || undefined,
        dueFrom: String(req.query.dueFrom || '') || undefined,
        dueTo: String(req.query.dueTo || '') || undefined,
        returnedFrom: String(req.query.returnedFrom || '') || undefined,
        returnedTo: String(req.query.returnedTo || '') || undefined,
        shippingMethod: String(req.query.shippingMethod || '') || undefined,
        status: String(req.query.status || '') || undefined,
        assignee: String(req.query.assignee || '') || undefined,
        exportStatus: (req.query.exportStatus as any) || 'all',
        sort: (req.query.sort as any) || 'due_asc',
        limit: Number(req.query.limit) || 100,
        offset: Number(req.query.offset) || 0,
      });
      const org = await getOrganization(ctx.organizationId);
      const settings = sanitizeHardwareReturnsConfigForClient(org?.hardware_returns_config);
      return res.json({
        ...result,
        organizationId: ctx.organizationId,
        enabledModules: organizationEnabledModules(org),
        settings,
        autoSendEnabled: Boolean(settings?.auto_send_enabled),
      });
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({ error: safeErrorMessage(err, 'Liste fehlgeschlagen') });
    }
  };

  router.get('/', listHandler);

  /**
   * GET /trends?timeframe=7d|30d|90d|12m|all
   * SQL generate_series buckets + 20s org cache. Portal CLIENT_USER / disabled module → 403.
   */
  router.get('/trends', async (req: Request, res: Response): Promise<any> => {
    try {
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const timeframe = parsePortalReturnsTrendTimeframe(
        req.query.timeframe || req.query.range,
      );
      const cached = getCachedPortalReturnsTrends<{
        timeframe: string;
        points: unknown[];
      }>(ctx.organizationId, timeframe);
      if (cached) {
        return res.json({
          organizationId: ctx.organizationId,
          timeframe: cached.timeframe,
          points: cached.points,
          cached: true,
        });
      }
      const points = await loadPortalReturnsTrendsSql(ctx.organizationId, timeframe);
      const payload = { timeframe, points };
      setCachedPortalReturnsTrends(ctx.organizationId, timeframe, payload);
      return res.json({
        organizationId: ctx.organizationId,
        timeframe,
        points,
        cached: false,
      });
    } catch (err: any) {
      const status = err?.status || 500;
      return res.status(status).json({
        error: safeErrorMessage(err, 'Trends konnten nicht geladen werden'),
      });
    }
  });

  const createSchema = z.object({
    organizationId: z.string().uuid().optional(),
    /** Betreff — optional (no longer required). */
    subject: z.string().trim().max(500).optional().nullable(),
    description: z.string().trim().max(100_000).optional().nullable(),
    requesterId: z.string().trim().max(128).optional().nullable(),
    customerName: z.string().trim().max(255).optional().nullable(),
    customerEmail: z.string().trim().max(255).optional().nullable(),
    hardwareReturn: z.record(z.string(), z.unknown()).default({}),
  });

  /** POST / — create a standalone Rücklieferung (never creates a normal ticket). */
  router.post('/', async (req: Request, res: Response): Promise<any> => {
    try {
      const parsed = createSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Ungültige Eingabe',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff'
          ? parsed.data.organizationId || String(req.query.organizationId || '')
          : null,
      );
      if (!ctx) return;
      const { sanitizePlainTextField, sanitizeUserHtml } = await import(
        '../lib/security/sanitize.js'
      );
      const result = await createHardwareReturnFromWorkbench({
        organizationId: ctx.organizationId,
        actorId: String(req.user?.id || ''),
        actorName: req.user?.name || null,
        actorEmail: req.user?.email || null,
        subject:
          parsed.data.subject != null
            ? sanitizePlainTextField(parsed.data.subject, 500)
            : parsed.data.subject,
        description:
          parsed.data.description != null
            ? sanitizeUserHtml(parsed.data.description)
            : parsed.data.description,
        requesterId: parsed.data.requesterId,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        hardwareReturn: parsed.data.hardwareReturn as any,
      });
      bumpReturnsCache(ctx.organizationId);
      return res.status(201).json({
        success: true,
        id: result.id,
        ticketId: result.ticketId,
        ticket: result.ticket,
        hardwareReturn: result.hardwareReturn,
      });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Rücklieferung konnte nicht erstellt werden') });
    }
  });

  const updateSchema = z.object({
    organizationId: z.string().uuid().optional(),
    subject: z.string().trim().max(500).optional().nullable(),
    description: z.string().trim().max(100_000).optional().nullable(),
    status: z.string().trim().max(120).optional(),
    customerName: z.string().trim().max(255).optional().nullable(),
    customerEmail: z.string().trim().max(255).optional().nullable(),
    assigneeName: z.string().trim().max(255).optional().nullable(),
    hardwareReturn: z.record(z.string(), z.unknown()).default({}),
  });

  async function updateReturnHandler(req: Request, res: Response): Promise<any> {
    try {
      const idOrTicketId = routeParam(req.params.ticketId || req.params.id);
      const parsed = updateSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Ungültige Eingabe' });
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff'
          ? parsed.data.organizationId || String(req.query.organizationId || '')
          : null,
      );
      if (!ctx) return;
      const org = await getOrganization(ctx.organizationId);
      if (!org?.hardware_returns_enabled) {
        return res.status(404).json({ error: 'Hardware-Rücklieferungen nicht aktiv.' });
      }
      const existing = await resolveHardwareReturnByParam(idOrTicketId, ctx.organizationId);
      if (!existing) return res.status(404).json({ error: 'Rücklieferung nicht gefunden.' });

      const hwPatch = parsed.data.hardwareReturn as Record<string, unknown>;
      const wasReturned = Boolean(existing.returned);
      const hardwareReturn = await updateHardwareReturnById({
        id: existing.id,
        organizationId: ctx.organizationId,
        input: {
          ...(hwPatch as any),
          ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
          ...(parsed.data.description !== undefined
            ? {
                description:
                  parsed.data.description == null
                    ? null
                    : (
                        await import('../lib/security/sanitize.js')
                      ).sanitizeUserHtml(parsed.data.description),
              }
            : {}),
          ...(parsed.data.status !== undefined ? { status: parsed.data.status as any } : {}),
          ...(parsed.data.customerName !== undefined
            ? { employee_name: parsed.data.customerName }
            : {}),
          ...(parsed.data.customerEmail !== undefined
            ? { employee_email: parsed.data.customerEmail }
            : {}),
          ...(parsed.data.assigneeName !== undefined
            ? { assignee_name: parsed.data.assigneeName }
            : {}),
          ticket_id: null,
        },
        mail1Days: org.hardware_returns_config.mail1_days_after_delivery,
      });
      const nowReturned = Boolean(hardwareReturn.returned);
      let activityType: 'updated' | 'returned' | 'unreturned' = 'updated';
      let activityMessage = 'Rücklieferung aktualisiert';
      if (!wasReturned && nowReturned) {
        activityType = 'returned';
        activityMessage = 'Als zurückgeliefert markiert';
      } else if (wasReturned && !nowReturned) {
        activityType = 'unreturned';
        activityMessage = 'Zurücklieferung zurückgesetzt (nicht zurückgeliefert)';
      }
      await appendHardwareReturnActivity(existing.id, {
        at: new Date().toISOString(),
        type: activityType,
        actor: req.user?.name || req.user?.email || null,
        message: activityMessage,
      });
      bumpReturnsCache(ctx.organizationId);
      return res.json({
        success: true,
        id: hardwareReturn.id,
        ticketId: hardwareReturn.id,
        hardwareReturn,
        ticket: {
          id: hardwareReturn.id,
          subject: hardwareReturn.subject,
          customerName: hardwareReturn.employee_name,
          customerEmail: hardwareReturn.employee_email,
          status: hardwareReturn.status,
        },
      });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Speichern fehlgeschlagen') });
    }
  }

  router.get('/settings', async (req: Request, res: Response): Promise<any> => {
    try {
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      if (mode === 'portal' && ctx.role !== 'CLIENT_ADMIN' && ctx.role !== 'SYSTEM_ADMIN') {
        // SUPPORTER may read settings (for matrix visibility) but not write.
      }
      const org = await getOrganization(ctx.organizationId);
      const config = sanitizeHardwareReturnsConfigForClient(org?.hardware_returns_config);
      return res.json({
        hardware_returns_enabled: Boolean(org?.hardware_returns_enabled),
        hardware_returns_config: config,
        catalogs: config?.catalogs || null,
        id_prefix: config?.id_prefix || null,
        m365_directory_sync: config?.m365_directory_sync || null,
        enabledModules: organizationEnabledModules(org),
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Settings laden fehlgeschlagen') });
    }
  });

  /** GET /directory-users — M365 + portal employee autocomplete (org-scoped). */
  router.get('/directory-users', async (req: Request, res: Response): Promise<any> => {
    try {
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const gate = evaluateDirectorySearchAccess({
        sessionOrgId: isClientPortalRole(ctx.role) ? ctx.organizationId : ctx.organizationId,
        targetOrgId: ctx.organizationId,
        role: ctx.role,
        orgEnabled: true,
      });
      if (gate.ok === false) {
        return res.status(gate.status).json({ error: 'Forbidden.' });
      }
      const users = await searchOrganizationDirectoryUsers({
        organizationId: ctx.organizationId,
        query: String(req.query.q || req.query.query || ''),
        limit: Number(req.query.limit) || 15,
      });
      return res.json({ organizationId: ctx.organizationId, users });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Verzeichnissuche fehlgeschlagen') });
    }
  });

  /** POST /directory-sync — trigger immediate M365 sync. */
  router.post('/directory-sync', async (req: Request, res: Response): Promise<any> => {
    try {
      const role = String(req.user?.role || '');
      let organizationId: string | null = null;
      if (mode === 'portal') {
        if (role !== 'CLIENT_ADMIN') {
          return res.status(403).json({ error: 'Forbidden: CLIENT_ADMIN required.' });
        }
        organizationId = resolveOrganizationIdFromUser(req.user!);
      } else {
        if (role !== 'SYSTEM_ADMIN') {
          return res.status(403).json({ error: 'Forbidden: SYSTEM_ADMIN required.' });
        }
        organizationId = String(
          req.body?.organizationId || req.query.organizationId || '',
        ).trim();
      }
      if (!organizationId) {
        return res.status(400).json({ error: 'organizationId ist erforderlich.' });
      }
      const org = await getOrganization(organizationId);
      if (!org?.hardware_returns_enabled) {
        return res.status(403).json({
          error: 'Forbidden: Hardware-Rücklieferungen nicht aktiv.',
        });
      }
      if (mode === 'portal') {
        const sessionOrg = resolveOrganizationIdFromUser(req.user!);
        if (sessionOrg !== organizationId) {
          return res.status(403).json({ error: 'Forbidden.' });
        }
      }
      const result = await syncOrganizationDirectoryFromGraph(organizationId);
      return res.json({
        success: true,
        syncedCount: result.syncedCount,
        lastSyncedAt: result.lastSyncedAt,
      });
    } catch (err: any) {
      return res.status(err?.status || 502).json({
        error: safeErrorMessage(err, 'Verzeichnissynchronisation fehlgeschlagen'),
      });
    }
  });

  /** GET /assignees — selectable Bearbeiter candidates for the org. */
  router.get('/assignees', async (req: Request, res: Response): Promise<any> => {
    try {
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const assignees = await listHardwareReturnAssignees(ctx.organizationId);
      return res.json({
        organizationId: ctx.organizationId,
        assignees,
      });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Bearbeiter laden fehlgeschlagen') });
    }
  });

  const settingsSchema = z.object({
    organizationId: z.string().uuid().optional(),
    hardware_returns_config: z.record(z.string(), z.unknown()).optional(),
    catalogs: z
      .object({
        statuses: z.array(z.string()).optional(),
        device_types: z.array(z.string()).optional(),
        service_levels: z.array(z.string()).optional(),
        slas: z.array(z.string()).optional(),
        shipping_methods: z.array(z.string()).optional(),
      })
      .optional(),
    m365_directory_sync: z
      .object({
        enabled: z.boolean().optional(),
        entra_group_id: z.string().trim().max(80).nullable().optional(),
        tenant_id: z.string().trim().max(80).nullable().optional(),
        client_id: z.string().trim().max(80).nullable().optional(),
        client_secret: z.string().max(4000).nullable().optional(),
      })
      .optional(),
    id_prefix: z.string().trim().max(12).optional(),
    auto_send_enabled: z.boolean().optional(),
  });

  router.patch('/settings', async (req: Request, res: Response): Promise<any> => {
    try {
      const parsed = settingsSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid settings payload' });
      }
      const preferredOrgId =
        mode === 'staff'
          ? parsed.data.organizationId || String(req.query.organizationId || '')
          : null;

      // Catalogs write: CLIENT_USER + disabled orgs → 403 (not 404).
      const role = String(req.user?.role || '');
      let organizationId: string | null = null;
      if (isClientPortalRole(role)) {
        organizationId = resolveOrganizationIdFromUser(req.user!);
        if (role === 'CLIENT_USER') {
          return res.status(403).json({ error: 'Forbidden: CLIENT_USER cannot update catalogs.' });
        }
      } else if (role === 'SYSTEM_ADMIN' || isHubcomStaffRole(role)) {
        organizationId = String(preferredOrgId || '').trim() || null;
        if (!organizationId) {
          return res.status(400).json({ error: 'organizationId ist erforderlich.' });
        }
        if (mode === 'staff' && role !== 'SYSTEM_ADMIN') {
          return res.status(403).json({ error: 'Forbidden: SYSTEM_ADMIN required for settings.' });
        }
      } else {
        return res.status(403).json({ error: 'Forbidden.' });
      }
      if (!organizationId) {
        return res.status(403).json({ error: 'Forbidden: no organization.' });
      }

      const org = await getOrganization(organizationId);
      if (!org) return res.status(404).json({ error: 'Organization not found.' });

      const writeGate = evaluateHardwareCatalogsWriteAccess({
        orgEnabled: Boolean(org.hardware_returns_enabled),
        sessionOrgId: isClientPortalRole(role) ? organizationId : organizationId,
        targetOrgId: organizationId,
        role: mode === 'portal' ? role : role === 'SYSTEM_ADMIN' ? 'SYSTEM_ADMIN' : role,
      });
      if (mode === 'portal' && role !== 'CLIENT_ADMIN' && role !== 'SYSTEM_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: CLIENT_ADMIN required.' });
      }
      if (writeGate.ok === false) {
        return res.status(403).json({
          error: org.hardware_returns_enabled
            ? 'Forbidden.'
            : 'Forbidden: Hardware-Rücklieferungen nicht aktiv.',
        });
      }

      const nextConfig = normalizeHardwareReturnsConfig({
        ...org.hardware_returns_config,
        ...(parsed.data.hardware_returns_config || {}),
        ...(parsed.data.catalogs
          ? {
              catalogs: {
                ...org.hardware_returns_config.catalogs,
                ...parsed.data.catalogs,
              },
            }
          : {}),
        ...(parsed.data.m365_directory_sync
          ? {
              m365_directory_sync: {
                ...org.hardware_returns_config.m365_directory_sync,
                ...parsed.data.m365_directory_sync,
              },
            }
          : {}),
        ...(parsed.data.id_prefix !== undefined ? { id_prefix: parsed.data.id_prefix } : {}),
        ...(parsed.data.auto_send_enabled !== undefined
          ? { auto_send_enabled: parsed.data.auto_send_enabled }
          : {}),
      });
      const updated = await updateOrganizationHardwareModule(organizationId, {
        hardware_returns_config: nextConfig,
      });
      const config = sanitizeHardwareReturnsConfigForClient(updated?.hardware_returns_config);
      return res.json({
        hardware_returns_enabled: Boolean(updated?.hardware_returns_enabled),
        hardware_returns_config: config,
        catalogs: config?.catalogs || null,
        id_prefix: config?.id_prefix || null,
        m365_directory_sync: config?.m365_directory_sync || null,
        enabledModules: organizationEnabledModules(updated),
      });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Settings speichern fehlgeschlagen') });
    }
  });

  const bulkSchema = z.object({
    organizationId: z.string().uuid().optional(),
    ticketIds: z.array(z.string()).max(500).default([]),
    action: z.enum(['mark_returned', 'mark_exported', 'csv_export']),
  });

  router.post('/bulk', async (req: Request, res: Response): Promise<any> => {
    try {
      const parsed = bulkSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid bulk payload' });
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? parsed.data.organizationId || String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const result = await bulkHardwareReturnsAction({
        organizationId: ctx.organizationId,
        ticketIds: parsed.data.ticketIds,
        action: parsed.data.action,
        actorName: req.user?.name || req.user?.email || 'Benutzer',
      });
      if (parsed.data.action !== 'csv_export') {
        bumpReturnsCache(ctx.organizationId);
      }
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Bulk-Aktion fehlgeschlagen') });
    }
  });

  function canImportSharePointCsv(role: string): boolean {
    if (isClientPortalRole(role)) {
      return role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER';
    }
    return (
      role === 'SYSTEM_ADMIN' ||
      role === 'admin' ||
      role === 'AGENT' ||
      role === 'agent'
    );
  }

  const importPreviewSchema = z.object({
    organizationId: z.string().uuid().optional(),
    csvText: z.string().min(1).max(5_000_000).optional(),
    /** Legacy alias — prefer csvText. */
    csv: z.string().min(1).max(5_000_000).optional(),
    scope: z.enum(['all', 'open_only']).optional().default('all'),
    excludeTestRows: z.boolean().optional().default(true),
  }).refine((b) => Boolean((b.csvText || b.csv || '').trim()), {
    message: 'csvText is required',
  });

  const importCommitSchema = z.object({
    organizationId: z.string().uuid().optional(),
    csvText: z.string().min(1).max(5_000_000).optional(),
    csv: z.string().min(1).max(5_000_000).optional(),
    scope: z.enum(['all', 'open_only']).optional().default('all'),
    excludeTestRows: z.boolean().optional().default(true),
    mergeCatalogs: z.boolean().optional().default(false),
    seedDirectory: z.boolean().optional().default(false),
    enableAutoReminders: z.boolean().optional().default(false),
  }).refine((b) => Boolean((b.csvText || b.csv || '').trim()), {
    message: 'csvText is required',
  });

  router.post('/import-csv/preview', async (req: Request, res: Response): Promise<any> => {
    try {
      const parsed = importPreviewSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid preview payload', details: parsed.error.flatten() });
      }
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? parsed.data.organizationId || String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      if (!canImportSharePointCsv(ctx.role)) {
        return res.status(403).json({ error: 'Forbidden: CSV import not allowed for this role.' });
      }
      const result = await previewSharePointReturnsImport({
        organizationId: ctx.organizationId,
        csvText: parsed.data.csvText || parsed.data.csv || '',
        scope: parsed.data.scope,
        excludeTestRows: parsed.data.excludeTestRows,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'CSV-Vorschau fehlgeschlagen') });
    }
  });

  router.post('/import-csv', async (req: Request, res: Response): Promise<any> => {
    try {
      const parsed = importCommitSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid import payload', details: parsed.error.flatten() });
      }
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? parsed.data.organizationId || String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      if (!canImportSharePointCsv(ctx.role)) {
        return res.status(403).json({ error: 'Forbidden: CSV import not allowed for this role.' });
      }
      const result = await commitSharePointReturnsImport({
        organizationId: ctx.organizationId,
        csvText: parsed.data.csvText || parsed.data.csv || '',
        scope: parsed.data.scope,
        excludeTestRows: parsed.data.excludeTestRows,
        mergeCatalogs: parsed.data.mergeCatalogs,
        seedDirectory: parsed.data.seedDirectory,
        enableAutoReminders: parsed.data.enableAutoReminders,
        actorId: req.user?.id,
        actorName: req.user?.name || req.user?.email || 'CSV-Import',
      });
      bumpReturnsCache(ctx.organizationId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'CSV-Import fehlgeschlagen') });
    }
  });

  /** Parametric routes AFTER /settings|/bulk|/import-csv so they are not shadowed. */
  router.put('/:ticketId', updateReturnHandler);
  router.patch('/:ticketId', updateReturnHandler);

  router.get('/:ticketId', async (req: Request, res: Response): Promise<any> => {
    try {
      const idOrTicketId = routeParam(req.params.ticketId);
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const hardwareReturn = await resolveHardwareReturnByParam(idOrTicketId, ctx.organizationId);
      if (!hardwareReturn) {
        return res.status(404).json({ error: 'Rücklieferung nicht gefunden.' });
      }
      return res.json({
        id: hardwareReturn.id,
        ticketId: hardwareReturn.id,
        hardwareReturn,
        ticket: {
          id: hardwareReturn.id,
          subject: hardwareReturn.subject,
          customerName: hardwareReturn.employee_name,
          customerEmail: hardwareReturn.employee_email,
          status: hardwareReturn.status,
          description: hardwareReturn.description,
        },
      });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Laden fehlgeschlagen') });
    }
  });

  router.delete('/:ticketId', async (req: Request, res: Response): Promise<any> => {
    try {
      const idOrTicketId = routeParam(req.params.ticketId);
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || req.body?.organizationId || '') : null,
      );
      if (!ctx) return;
      const existing = await resolveHardwareReturnByParam(idOrTicketId, ctx.organizationId);
      if (!existing) return res.status(404).json({ error: 'Rücklieferung nicht gefunden.' });
      const ok = await deleteHardwareReturn({
        id: existing.id,
        organizationId: ctx.organizationId,
      });
      if (!ok) return res.status(404).json({ error: 'Rücklieferung nicht gefunden.' });
      bumpReturnsCache(ctx.organizationId);
      return res.json({ success: true, id: existing.id });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Löschen fehlgeschlagen') });
    }
  });

  router.get('/:ticketId/preview-reminder', async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = routeParam(req.params.ticketId);
      const stage = stageFromQuery(req.query.stage);
      if (!stage) return res.status(400).json({ error: 'stage must be an integer >= 1' });
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const preview = await previewHardwareReminder({
        ticketId,
        organizationId: ctx.organizationId,
        stage,
      });
      return res.json(preview);
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Vorschau fehlgeschlagen') });
    }
  });

  const sendSchema = z.object({
    stage: z.number().int().min(1).max(100),
    to: z.array(z.string()).optional(),
    cc: z.array(z.string()).optional(),
    saveAsTicketOverride: z.boolean().optional(),
    organizationId: z.string().uuid().optional(),
  });

  router.post('/:ticketId/send-reminder', async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = routeParam(req.params.ticketId);
      const parsed = sendSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid send payload' });
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? parsed.data.organizationId || String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const result = await sendHardwareReminder({
        ticketId,
        organizationId: ctx.organizationId,
        stage: parsed.data.stage,
        to: parsed.data.to,
        cc: parsed.data.cc,
        saveAsTicketOverride: parsed.data.saveAsTicketOverride,
        auto: false,
        actorName: req.user?.name || req.user?.email || 'Benutzer',
      });
      bumpReturnsCache(ctx.organizationId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Versand fehlgeschlagen') });
    }
  });

  const markSchema = z.object({
    returnedAt: z.string().optional().nullable(),
    note: z.string().max(2000).optional().nullable(),
    organizationId: z.string().uuid().optional(),
  });

  router.post('/:ticketId/mark-returned', async (req: Request, res: Response): Promise<any> => {
    try {
      const ticketId = routeParam(req.params.ticketId);
      const parsed = markSchema.safeParse(req.body || {});
      if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
      const ctx = await resolveOrgForReturns(
        req,
        res,
        mode === 'staff' ? parsed.data.organizationId || String(req.query.organizationId || '') : null,
      );
      if (!ctx) return;
      const hardwareReturn = await markHardwareReturned({
        ticketId,
        organizationId: ctx.organizationId,
        returnedAt: parsed.data.returnedAt,
        note: parsed.data.note,
        actorName: req.user?.name || req.user?.email || 'Benutzer',
      });
      bumpReturnsCache(ctx.organizationId);
      return res.json({ success: true, hardwareReturn });
    } catch (err: any) {
      return res
        .status(err?.status || 500)
        .json({ error: safeErrorMessage(err, 'Markieren fehlgeschlagen') });
    }
  });

}

/** Staff router — mount at `/api/returns`. */
export function createStaffHardwareReturnsRouter(): Router {
  const router = Router();
  router.use(authenticate, requireHubcomStaff);
  mountReturnsRoutes(router, 'staff');
  return router;
}

/** Portal router — mount at `/api/portal/returns`. */
export function createPortalHardwareReturnsRouter(): Router {
  const router = Router();
  router.use(
    authenticate,
    requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  );
  // CLIENT_USER is rejected inside resolveOrgForReturns with 403.
  mountReturnsRoutes(router, 'portal');
  return router;
}
