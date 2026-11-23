import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware.js';
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
  listAllTimeEntries,
  listTimeEntriesByTicket,
  summarizeEntries,
  updateTimeEntry,
} from '../lib/time-tracking/store.js';
import { TIME_EXPORT_JOB_TYPE, runTimeExportJob } from '../lib/time-tracking/scheduler.js';
import { getDocDirect } from '../lib/postgres-backend.js';

const router = Router();

function actor(req: Request): { userId: string; agentName: string; kuerzel: string } {
  const user = (req as any).user || {};
  const userId = String(user.uid || user.id || user.sub || '');
  const agentName = String(user.name || user.displayName || user.email || 'Unbekannt');
  const kuerzel = String(user.kuerzel || '').trim().toUpperCase();
  return { userId, agentName, kuerzel };
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

const createSchema = z.object({
  ticketId: z.string().min(1),
  ticketNumber: z.string().optional(),
  ticketSubject: z.string().optional(),
  customerCompany: z.string().optional(),
  kuerzel: z.string().min(1).max(12),
  hours: z.number().positive().max(24),
  sonderzahlung: z.boolean().optional(),
  description: z.string().max(4000).optional(),
  date: z.string().optional(),
});

const updateSchema = z.object({
  kuerzel: z.string().min(1).max(12).optional(),
  hours: z.number().positive().max(24).optional(),
  sonderzahlung: z.boolean().optional(),
  description: z.string().max(4000).optional(),
  date: z.string().optional(),
});

const settingsSchema = z.object({
  standardHourlyRate: z.number().min(0).max(10000).optional(),
  specialHourlyRate: z.number().min(0).max(10000).optional(),
  syncInterval: z.enum(['hourly', 'daily', 'disabled']).optional(),
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
    rates: {
      standardHourlyRate: settings.standardHourlyRate,
      specialHourlyRate: settings.specialHourlyRate,
    },
  });
});

/** GET /api/time-entries/export.xlsx?ticketId=&from=&to= */
router.get('/export.xlsx', authenticate, async (req: Request, res: Response) => {
  const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const entries = ticketId
    ? await listTimeEntriesByTicket(ticketId)
    : await listAllTimeEntries({ from, to });
  const buffer = await buildTimeEntriesBuffer(entries);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = ticketId
    ? `zeiterfassung-ticket-${stamp}.xlsx`
    : `zeiterfassung-gesamt-${stamp}.xlsx`;
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
  async (_req: Request, res: Response) => {
    try {
      const result = await syncTimeEntriesToGraph({ onlyUnsynced: false });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error: err?.message || 'Graph-Sync fehlgeschlagen.',
      });
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

/** GET /api/time-entries?ticketId=… | from=&to= */
router.get('/', authenticate, async (req: Request, res: Response) => {
  const ticketId = typeof req.query.ticketId === 'string' ? req.query.ticketId : '';
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const entries = ticketId
    ? await listTimeEntriesByTicket(ticketId)
    : await listAllTimeEntries({ from, to });
  res.json({ entries, summary: summarizeEntries(entries) });
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
      input: parsed.data,
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
  try {
    const entry = await updateTimeEntry(routeParam(req.params.id), parsed.data);
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
  await deleteTimeEntry(id);
  res.json({ ok: true });
});

export default router;
