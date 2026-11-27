/**
 * Admin security monitor APIs.
 * Mount: /api/admin/security
 *
 * GET  /overview
 * GET  /audit-logs
 * GET  /bans
 * POST /bans
 * POST /bans/:id/unban
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireCanManageHubcomCore,
} from '../middleware/authMiddleware.js';
import { forbidClientPortalRoles } from '../middleware/clientPortalMiddleware.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import {
  createSecurityBan,
  getSecurityOverview,
  liftSecurityBan,
  listActiveBans,
  listSecurityAuditLogs,
  writeSecurityAuditLog,
} from '../lib/security/security-store.js';

const router = Router();

router.use(authenticate, forbidClientPortalRoles, requireCanManageHubcomCore);

router.get('/overview', async (_req, res) => {
  try {
    const overview = await getSecurityOverview();
    return res.json({ overview });
  } catch (err: any) {
    safeLog('error', '[security/overview]', safeErrorMessage(err));
    return res.status(500).json({ error: 'Übersicht konnte nicht geladen werden.' });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const severityRaw = String(req.query.severity || '').trim();
    const severity =
      severityRaw === 'info' || severityRaw === 'warning' || severityRaw === 'critical'
        ? severityRaw
        : null;
    const event_type = String(req.query.event_type || '').trim() || null;
    const limit = Number.parseInt(String(req.query.limit || '100'), 10) || 100;
    const logs = await listSecurityAuditLogs({ limit, severity, event_type });
    return res.json({ logs });
  } catch (err: any) {
    safeLog('error', '[security/audit-logs]', safeErrorMessage(err));
    return res.status(500).json({ error: 'Audit-Log konnte nicht geladen werden.' });
  }
});

router.get('/bans', async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || '100'), 10) || 100;
    const bans = await listActiveBans(limit);
    return res.json({ bans });
  } catch (err: any) {
    safeLog('error', '[security/bans]', safeErrorMessage(err));
    return res.status(500).json({ error: 'Sperrliste konnte nicht geladen werden.' });
  }
});

const manualBanSchema = z.object({
  ban_type: z.enum(['ip', 'account']),
  target_value: z.string().trim().min(1).max(320),
  reason: z.string().trim().min(1).max(500).default('manual'),
  duration_hours: z.number().positive().max(24 * 365).nullable().optional(),
});

router.post('/bans', async (req: any, res) => {
  try {
    const parsed = manualBanSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Ungültige Sperr-Angaben.' });
    }
    const { ban_type, target_value, reason, duration_hours } = parsed.data;
    const durationMs =
      duration_hours == null ? null : Math.round(duration_hours * 60 * 60 * 1000);
    const ban = await createSecurityBan({
      ban_type,
      target_value,
      reason: reason || 'manual',
      durationMs,
      strike_count: 1,
    });
    await writeSecurityAuditLog({
      event_type: 'manual_ban',
      severity: 'warning',
      ip_address: req.clientIp || null,
      user_id: req.user?.id || null,
      path: '/api/admin/security/bans',
      method: 'POST',
      details: {
        ban_id: ban?.id,
        ban_type,
        target_value: target_value.toLowerCase(),
        reason,
        duration_hours: duration_hours ?? null,
      },
    });
    return res.status(201).json({ ban });
  } catch (err: any) {
    safeLog('error', '[security/bans POST]', safeErrorMessage(err));
    return res.status(500).json({ error: 'Sperre konnte nicht erstellt werden.' });
  }
});

router.post('/bans/:id/unban', async (req: any, res) => {
  try {
    const id = routeParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'ban id required' });
    const ban = await liftSecurityBan({
      banId: id,
      liftedBy: String(req.user?.id || 'admin'),
    });
    if (!ban) return res.status(404).json({ error: 'Sperre nicht gefunden.' });
    await writeSecurityAuditLog({
      event_type: 'manual_unban',
      severity: 'info',
      ip_address: req.clientIp || null,
      user_id: req.user?.id || null,
      path: `/api/admin/security/bans/${id}/unban`,
      method: 'POST',
      details: {
        ban_id: ban.id,
        ban_type: ban.ban_type,
        target_value: ban.target_value,
      },
    });
    return res.json({ ban });
  } catch (err: any) {
    safeLog('error', '[security/unban]', safeErrorMessage(err));
    return res.status(500).json({ error: 'Sperre konnte nicht aufgehoben werden.' });
  }
});

export default router;
