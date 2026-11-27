import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireRole,
  type AuthenticatedRequest,
} from '../middleware/authMiddleware.js';
import { routeParam } from '../lib/route-params.js';
import { buildTimeEntriesBuffer } from '../lib/time-tracking/excel-export.js';
import { syncTimeEntriesToGraph } from '../lib/time-tracking/graph-sync.js';
import { enqueueJob } from '../lib/job-queue.js';
import {
  loadTimeTrackingSettings,
  redactTimeTrackingSettings,
  saveTimeTrackingSettings,
} from '../lib/time-tracking/settings.js';
import type { TimeTrackingGraphConfig, TimeTrackingSettings } from '../lib/time-tracking/types.js';
import {
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntry,
  listTimeEntries,
  summarizeEntries,
  updateTimeEntry,
} from '../lib/time-tracking/store.js';
import {
  TIME_EXPORT_JOB_TYPE,
  maybeRunMonthlySharePointSync,
  runTimeExportJob,
} from '../lib/time-tracking/scheduler.js';
import { getDocDirect } from '../lib/postgres-backend.js';
import {
  canManageHubcomCore,
  normalizeHubcomMatrixRole,
} from '../lib/staff-org-access.js';

const router = Router();

function actor(req: Request): { userId: string; agentName: string; kuerzel: string } {
  const user = (req as any).user || {};
  const userId = String(user.uid || user.id || user.sub || '');
  const agentName = String(user.name || user.displayName || user.email || 'Unbekannt');
  const kuerzel = String(user.kuerzel || '').trim().toUpperCase();
  return { userId, agentName, kuerzel };
}

function isTimeAdmin(req: Request): boolean {
  const user = (req as AuthenticatedRequest).user;
  if (!user) return false;
  const matrix = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  return (
    matrix === 'SUPER_ADMIN' ||
    matrix === 'HUBCOM_ADMIN' ||
    canManageHubcomCore(user)
  );
}

async function resolveUserKuerzel(userId: string, fallback: string): Promise<string> {
  if (!userId) return fallback;
  try {
    const doc = await getDocDirect('users', userId);
    const fromProfile = String(doc?.kuerzel || '').trim().toUpperCase();
    return fromProfile || fallback;
  } catch {
    return fallback;
  }
}

const createSchema = z
  .object({
    ticketId: z.string().min(1).optional().nullable(),
    organizationId: z.string().uuid().optional().nullable(),
    ticketNumber: z.string().optional(),
    ticketSubject: z.string().optional(),
    customerCompany: z.string().optional(),
    kuerzel: z.string().min(1).max(12),
    hours: z.number().positive().max(24),
    minutes: z.number().int().min(0).max(59).optional(),
    sonderzahlung: z.boolean().optional(),
    description: z.string().max(4000).optional(),
    date: z.string().optional(),
  })
  .refine((d) => Boolean(String(d.ticketId || '').trim()) || Boolean(d.organizationId), {
    message: 'ticket_id oder organization_id erforderlich',
  });

const updateSchema = z.object({
  kuerzel: z.string().min(1).max(12).optional(),
  hours: z.number().positive().max(24).optional(),
  minutes: z.number().int().min(0).max(59).optional(),
  sonderzahlung: z.boolean().optional(),
  description: z.string().max(4000).optional(),
  date: z.string().optional(),
  ticketId: z.string().optional().nullable(),
  organizationId: z.string().uuid().optional().nullable(),
});

const settingsSchema = z.object({
  standardHourlyRate: z.number().min(0).max(10000).optional(),
  specialHourlyRate: z.number().min(0).max(10000).optional(),
  syncInterval: z.enum(['hourly', 'daily', 'monthly', 'disabled']).optional(),
  monthlySharePointSync: z
    .object({
      enabled: z.boolean().optional(),
      dayOfMonth: z.union([z.number().int().min(1).max(28), z.literal('last')]).optional(),
      timeBerlin: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .optional(),
  graph: z
    .object({
      enabled: z.boolean().optional(),
      tenantId: z.string().optional(),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      siteId: z.string().optional(),
      driveId: z.string().optional(),
      workbookPathOrId: z.string().optional(),
      worksheetName: z.string().optional(),
      tableName: z.string().optional(),
    })
    .optional(),
});

/** GET /api/time-entries/settings */
router.get('/settings', authenticate, async (_req: Request, res: Response) => {
  const settings = await loadTimeTrackingSettings();
  res.json({ settings: redactTimeTrackingSettings(settings) });
});

/** PUT /api/time-entries/settings — Admin */
router.put(
  '/settings',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Einstellungen.', details: parsed.error.flatten() });
    }
    const saved = await saveTimeTrackingSettings(
      parsed.data as Partial<TimeTrackingSettings> & {
        graph?: Partial<TimeTrackingGraphConfig>;
      },
    );
    res.json({ settings: redactTimeTrackingSettings(saved) });
  },
);

/** GET /api/time-entries/me/defaults — Kürzel-Vorschlag */
router.get('/me/defaults', authenticate, async (req: Request, res: Response) => {
  const a = actor(req);
  const kuerzel = await resolveUserKuerzel(a.userId, a.kuerzel);
  const settings = await loadTimeTrackingSettings();
  res.json({
    kuerzel,
    agentName: a.agentName,
    isAdmin: isTimeAdmin(req),
    rates: {
      standardHourlyRate: settings.standardHourlyRate,
      specialHourlyRate: settings.specialHourlyRate,
    },
  });
});

/** GET /api/time-entries/export.xlsx */
router.get('/export.xlsx', authenticate, async (req: Request, res: Response) => {
  const admin = isTimeAdmin(req);
  const a = actor(req);
  const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId : '';
  const organizationId =
    typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
  const userId =
    typeof req.query.userId === 'string' && admin ? req.query.userId : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const typeRaw = typeof req.query.type === 'string' ? req.query.type : 'all';
  const type =
    typeRaw === 'with_ticket' || typeRaw === 'without_ticket' ? typeRaw : 'all';

  const entries = await listTimeEntries({
    ticketId: ticketId || undefined,
    organizationId,
    userId: admin ? userId : a.userId,
    from,
    to,
    type,
  });
  const buffer = await buildTimeEntriesBuffer(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = ticketId
    ? `zeiterfassung-ticket-${stamp}.xlsx`
    : admin
      ? `zeiterfassung-gesamt-${stamp}.xlsx`
      : `zeiterfassung-meine-${stamp}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

/** POST /api/time-entries/sync-graph — Admin */
router.post(
  '/sync-graph',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    try {
      const onlyUnsynced = req.body?.onlyUnsynced !== false;
      const result = await syncTimeEntriesToGraph({ onlyUnsynced });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Graph-Sync fehlgeschlagen.',
      });
    }
  },
);

/** POST /api/time-entries/run-monthly-sync — Admin (manual SharePoint monthly run) */
router.post(
  '/run-monthly-sync',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (_req: Request, res: Response) => {
    try {
      const result = await maybeRunMonthlySharePointSync(true);
      res.json({ ok: !result.error, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Monats-Sync fehlgeschlagen.' });
    }
  },
);

/** POST /api/time-entries/run-export-job — Admin */
router.post(
  '/run-export-job',
  authenticate,
  requireRole(['SYSTEM_ADMIN']),
  async (req: Request, res: Response) => {
    const immediate = req.body?.immediate === true;
    if (immediate) {
      try {
        const result = await runTimeExportJob();
        return res.json({ ok: true, ...result });
      } catch (err: any) {
        return res.status(500).json({ ok: false, error: err?.message || 'Export fehlgeschlagen.' });
      }
    }
    const id = await enqueueJob(TIME_EXPORT_JOB_TYPE, { reason: 'manual' }, { maxAttempts: 3 });
    res.json({ ok: true, jobId: id });
  },
);

/** GET /api/time-entries */
router.get('/', authenticate, async (req: Request, res: Response) => {
  const admin = isTimeAdmin(req);
  const a = actor(req);
  const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId : '';
  const organizationId =
    typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
  const userIdFilter =
    typeof req.query.userId === 'string' && admin ? req.query.userId : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const typeRaw = typeof req.query.type === 'string' ? req.query.type : 'all';
  const type =
    typeRaw === 'with_ticket' || typeRaw === 'without_ticket' ? typeRaw : 'all';

  const entries = await listTimeEntries({
    ticketId: ticketId || undefined,
    organizationId,
    userId: admin ? userIdFilter : a.userId,
    from,
    to,
    type,
  });
  res.json({
    entries,
    summary: summarizeEntries(entries),
    scope: admin ? 'all' : 'mine',
  });
});

/** POST /api/time-entries */
router.post('/', authenticate, async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
  }
  const a = actor(req);
  try {
    const entry = await createTimeEntry({
      input: {
        ...parsed.data,
        ticketId: parsed.data.ticketId || null,
        organizationId: parsed.data.organizationId || null,
      },
      userId: a.userId,
      agentName: a.agentName,
    });
    res.status(201).json({ entry });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Speichern fehlgeschlagen.' });
  }
});

/** PATCH /api/time-entries/:id */
router.patch('/:id', authenticate, async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Ungültige Eingabe.', details: parsed.error.flatten() });
  }
  const id = routeParam(req.params.id);
  const existing = await getTimeEntry(id);
  if (!existing) {
    return res.status(404).json({ error: 'Zeiteintrag nicht gefunden.' });
  }
  const a = actor(req);
  if (!isTimeAdmin(req) && existing.userId !== a.userId) {
    return res.status(403).json({ error: 'Forbidden: Nur eigene Zeiteinträge dürfen bearbeitet werden.' });
  }
  try {
    const entry = await updateTimeEntry(id, parsed.data);
    res.json({ entry });
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Aktualisierung fehlgeschlagen.' });
  }
});

/** DELETE /api/time-entries/:id */
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const id = routeParam(req.params.id);
  const existing = await getTimeEntry(id);
  if (!existing) {
    return res.status(404).json({ error: 'Zeiteintrag nicht gefunden.' });
  }
  const a = actor(req);
  if (!isTimeAdmin(req) && existing.userId !== a.userId) {
    return res.status(403).json({ error: 'Forbidden: Nur eigene Zeiteinträge dürfen gelöscht werden.' });
  }
  await deleteTimeEntry(id);
  res.json({ ok: true });
});

export default router;
