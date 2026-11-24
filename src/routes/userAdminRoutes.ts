/**
 * Admin-Benutzerverwaltung: CRUD, Passwort, M365-Sync, Entra-Einstellungen.
 * Mount: /api/admin
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authMiddleware.js';
import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { hashPassword } from '../lib/crypto.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import {
  getEntraSettings,
  redactEntraSettings,
  saveEntraSettings,
} from '../lib/entra/config-store.js';
import { syncM365Users } from '../lib/entra/sync-users.js';
import {
  deriveKuerzel,
  formatUserForAdmin,
  isAdminRole,
  normalizeAuthMethod,
  normalizeRole,
} from '../lib/entra/user-helpers.js';

const router = Router();
const adminOnly = [authenticate, requireRole(['SYSTEM_ADMIN'])] as const;

const roleEnum = z.enum(['SYSTEM_ADMIN', 'agent', 'customer', 'admin', 'team_lead']);
const authMethodEnum = z.enum(['password', 'microsoft365', 'sso']);

const createUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Name ist erforderlich').max(200),
    email: z
      .string()
      .email('Ungültige E-Mail-Adresse')
      .transform((v) => v.toLowerCase().trim()),
    kuerzel: z.string().trim().max(10).optional().nullable(),
    job_title: z.string().trim().max(200).optional().nullable(),
    phone: z.string().trim().max(60).optional().nullable(),
    role: roleEnum.default('agent'),
    company: z.string().trim().max(200).optional().nullable(),
    companyId: z.string().trim().max(128).optional().nullable(),
    contactId: z.string().trim().max(128).optional().nullable(),
    authMethod: authMethodEnum.default('password'),
    password: z.string().min(8, 'Passwort mindestens 8 Zeichen').max(200).optional(),
  })
  .superRefine((data, ctx) => {
    const method = normalizeAuthMethod(data.authMethod);
    if (method === 'password' && !data.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Initialpasswort ist für lokale Benutzer erforderlich',
      });
    }
  });

const patchUserSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z
    .string()
    .email()
    .transform((v) => v.toLowerCase().trim())
    .optional(),
  kuerzel: z.string().trim().max(10).optional().nullable(),
  job_title: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  role: roleEnum.optional(),
  company: z.string().trim().max(200).optional().nullable(),
  companyId: z.string().trim().max(128).optional().nullable(),
  contactId: z.string().trim().max(128).optional().nullable(),
  authMethod: authMethodEnum.optional(),
  isDeactivated: z.boolean().optional(),
  entraObjectId: z.string().trim().max(128).optional().nullable(),
  upn: z.string().trim().max(320).optional().nullable(),
});

const passwordSchema = z.object({
  password: z.string().min(8, 'Passwort mindestens 8 Zeichen').max(200),
});

const entraSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  tenantId: z.string().trim().max(128).optional(),
  clientId: z.string().trim().max(128).optional(),
  clientSecret: z.string().max(500).optional().nullable(),
  redirectUri: z.string().trim().max(500).optional(),
  defaultRole: z.enum(['SYSTEM_ADMIN', 'agent', 'customer']).optional(),
  allowedDomains: z.array(z.string()).optional(),
  jitProvisioning: z.boolean().optional(),
});

async function countActiveAdmins(excludeId?: string): Promise<number> {
  const users = await getDocsDirect('users', []);
  return users.filter((u) => {
    if (excludeId && u.id === excludeId) return false;
    if (u.isDeactivated) return false;
    return isAdminRole(u.role) || u.is_admin === true;
  }).length;
}

async function audit(action: string, details: Record<string, unknown>, req: Request) {
  try {
    await addDocDirect('audits', {
      action,
      ...details,
      performedBy: (req as any).user?.email || 'SYSTEM_ADMIN',
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* non-fatal */
  }
}

/** GET /api/admin/users — vollständige Liste. */
router.get('/users', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const roleFilter = String(req.query.role || 'all').toLowerCase();
    const typeFilter = String(req.query.authMethod || req.query.type || 'all').toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));

    let users = (await getDocsDirect('users', [])).map(formatUserForAdmin);

    if (q) {
      users = users.filter((u) =>
        [u.name, u.email, u.kuerzel, u.company]
          .map((x) => String(x || '').toLowerCase())
          .some((x) => x.includes(q)),
      );
    }
    if (roleFilter && roleFilter !== 'all') {
      if (roleFilter === 'admin' || roleFilter === 'system_admin' || roleFilter === 'admins') {
        users = users.filter((u) => u.role === 'SYSTEM_ADMIN');
      } else if (roleFilter === 'agent' || roleFilter === 'mitarbeiter') {
        users = users.filter((u) => u.role === 'agent');
      } else if (roleFilter === 'customer' || roleFilter === 'kunden') {
        users = users.filter((u) => u.role === 'customer');
      }
    }
    if (typeFilter && typeFilter !== 'all') {
      if (typeFilter === 'password' || typeFilter === 'manual' || typeFilter === 'lokal') {
        users = users.filter((u) => u.authMethod === 'password');
      } else if (
        typeFilter === 'microsoft365' ||
        typeFilter === 'm365' ||
        typeFilter === 'sso'
      ) {
        users = users.filter((u) => u.authMethod === 'microsoft365');
      }
    }

    users.sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
    const totalCount = users.length;
    const start = (page - 1) * limit;
    const pageUsers = users.slice(start, start + limit);

    res.json({
      users: pageUsers,
      pagination: {
        totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
      },
    });
  } catch (err: any) {
    safeLog('error', '[user-admin] list failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Benutzer konnten nicht geladen werden') });
  }
});

/** POST /api/admin/users — neuen Benutzer anlegen. */
router.post('/users', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const parsed = createUserSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Eingabe ungültig',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const authMethod = normalizeAuthMethod(data.authMethod);
    const role = normalizeRole(data.role);

    const existing = await getDocsDirect('users', [
      { type: 'where', field: 'email', op: '==', value: data.email },
    ]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ein Benutzer mit dieser E-Mail existiert bereits.' });
    }

    const now = new Date().toISOString();
    const kuerzel = (data.kuerzel || '').trim() || deriveKuerzel(data.name);
    const passwordHash =
      authMethod === 'password' && data.password ? await hashPassword(data.password) : null;

    const profile = {
      name: data.name,
      email: data.email,
      kuerzel,
      job_title: (data.job_title || '').trim() || null,
      phone: (data.phone || '').trim() || null,
      role,
      is_admin: role === 'SYSTEM_ADMIN',
      company: data.company || '',
      companyId: data.companyId || null,
      contactId: data.contactId || null,
      customerCompany: role === 'customer' ? data.company || null : null,
      authMethod,
      passwordHash,
      entraObjectId: null,
      upn: authMethod === 'microsoft365' ? data.email : null,
      isDeactivated: false,
      can_create_tickets: true,
      can_view_knowledgebase: true,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
    };

    const created = await addDocDirect('users', profile);
    await audit(
      'CREATE_USER',
      {
        targetUserId: created.id,
        targetEmail: data.email,
        details: `Benutzer angelegt (${authMethod}, Rolle ${role})`,
      },
      req,
    );

    res.status(201).json({
      message: 'Benutzer erfolgreich angelegt.',
      user: formatUserForAdmin({ id: created.id, ...profile }),
    });
  } catch (err: any) {
    safeLog('error', '[user-admin] create failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Benutzer konnte nicht angelegt werden') });
  }
});

/** GET/PUT Entra-Einstellungen — vor /users/:id registrieren. */
router.get('/users/entra-settings', ...adminOnly, async (_req: Request, res: Response) => {
  try {
    const settings = await getEntraSettings();
    res.json({ settings: redactEntraSettings(settings) });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Einstellungen nicht ladbar') });
  }
});

router.put('/users/entra-settings', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const parsed = entraSettingsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Eingabe ungültig',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const settings = await saveEntraSettings(parsed.data);
    await audit('UPDATE_ENTRA_SETTINGS', { details: 'Entra-Einstellungen gespeichert' }, req);
    res.json({ message: 'Einstellungen gespeichert.', settings });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Speichern fehlgeschlagen') });
  }
});

/** POST /api/admin/users/sync-m365 */
router.post('/users/sync-m365', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const settings = await getEntraSettings();
    if (!settings.enabled && !(settings.clientId && settings.tenantId && settings.clientSecret)) {
      return res.status(400).json({
        error: 'Microsoft 365 ist nicht konfiguriert. Bitte zuerst die Entra-ID-Einstellungen speichern.',
      });
    }
    const result = await syncM365Users(settings);
    await audit(
      'SYNC_M365_USERS',
      {
        details: `Import ${result.imported}, Update ${result.updated}, Skip ${result.skipped}`,
      },
      req,
    );
    res.json({
      message: `Synchronisation abgeschlossen: ${result.imported} neu, ${result.updated} aktualisiert, ${result.skipped} übersprungen.`,
      result,
    });
  } catch (err: any) {
    safeLog('error', '[user-admin] sync-m365 failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Synchronisation fehlgeschlagen') });
  }
});

/** PATCH /api/admin/users/:id */
router.patch('/users/:id', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const parsed = patchUserSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Eingabe ungültig',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const user = await getDocDirect('users', id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

    const patch = parsed.data;
    const nextRole = patch.role !== undefined ? normalizeRole(patch.role) : normalizeRole(user.role);
    const nextAuth =
      patch.authMethod !== undefined
        ? normalizeAuthMethod(patch.authMethod)
        : normalizeAuthMethod(user.authMethod);
    const nextDeactivated =
      patch.isDeactivated !== undefined ? patch.isDeactivated : user.isDeactivated === true;

    // Selbst-Demotion verhindern
    if ((req as any).user?.id === id && nextRole !== 'SYSTEM_ADMIN') {
      return res.status(403).json({
        error: 'Sie können Ihre eigene Administrator-Rolle nicht entziehen.',
      });
    }

    // Letzten Admin schützen
    if (
      (isAdminRole(user.role) || user.is_admin) &&
      (!isAdminRole(nextRole) || nextDeactivated)
    ) {
      const remaining = await countActiveAdmins(id);
      if (remaining < 1) {
        return res.status(403).json({
          error: 'Der letzte aktive System-Administrator kann nicht deaktiviert oder herabgestuft werden.',
        });
      }
    }

    if (patch.email && patch.email !== user.email) {
      const clash = await getDocsDirect('users', [
        { type: 'where', field: 'email', op: '==', value: patch.email },
      ]);
      if (clash.some((u) => u.id !== id)) {
        return res.status(409).json({ error: 'E-Mail-Adresse wird bereits verwendet.' });
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.email !== undefined) updates.email = patch.email;
    if (patch.kuerzel !== undefined) updates.kuerzel = patch.kuerzel || '';
    if (patch.job_title !== undefined) updates.job_title = patch.job_title || null;
    if (patch.phone !== undefined) updates.phone = patch.phone || null;
    if (patch.company !== undefined) {
      updates.company = patch.company || '';
      if (nextRole === 'customer') updates.customerCompany = patch.company || null;
    }
    if (patch.companyId !== undefined) updates.companyId = patch.companyId;
    if (patch.contactId !== undefined) updates.contactId = patch.contactId;
    if (patch.entraObjectId !== undefined) updates.entraObjectId = patch.entraObjectId;
    if (patch.upn !== undefined) updates.upn = patch.upn;
    if (patch.role !== undefined) {
      updates.role = nextRole;
      updates.is_admin = nextRole === 'SYSTEM_ADMIN';
    }
    if (patch.authMethod !== undefined) {
      updates.authMethod = nextAuth;
      if (nextAuth === 'microsoft365') {
        updates.passwordHash = null;
      }
    }
    if (patch.isDeactivated !== undefined) updates.isDeactivated = nextDeactivated;

    await updateDocDirect('users', id, updates);
    const refreshed = await getDocDirect('users', id);
    await audit(
      'UPDATE_USER',
      { targetUserId: id, targetEmail: refreshed?.email, details: Object.keys(updates).join(',') },
      req,
    );

    res.json({
      message: 'Benutzer aktualisiert.',
      user: formatUserForAdmin(refreshed || { ...user, ...updates, id }),
    });
  } catch (err: any) {
    safeLog('error', '[user-admin] patch failed', err?.message || err);
    res.status(500).json({ error: safeErrorMessage(err, 'Benutzer konnte nicht aktualisiert werden') });
  }
});

/** POST /api/admin/users/:id/password */
router.post('/users/:id/password', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const parsed = passwordSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Eingabe ungültig',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const user = await getDocDirect('users', id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

    if (normalizeAuthMethod(user.authMethod) === 'microsoft365') {
      return res.status(400).json({
        error: 'Das Passwort wird über Microsoft 365 verwaltet und kann hier nicht gesetzt werden.',
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    await updateDocDirect('users', id, {
      passwordHash,
      authMethod: 'password',
      activationToken: null,
      activationTokenExpires: null,
      updatedAt: new Date().toISOString(),
    });

    await audit(
      'SET_PASSWORD',
      { targetUserId: id, targetEmail: user.email, details: 'Passwort zurückgesetzt' },
      req,
    );

    res.json({ success: true, message: 'Passwort wurde gesetzt.' });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Passwort konnte nicht gesetzt werden') });
  }
});

/** DELETE /api/admin/users/:id */
router.delete('/users/:id', ...adminOnly, async (req: Request, res: Response) => {
  try {
    const id = routeParam(req.params.id);
    const user = await getDocDirect('users', id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

    if ((req as any).user?.id === id) {
      return res.status(403).json({ error: 'Sie können Ihr eigenes Konto nicht löschen.' });
    }

    if (isAdminRole(user.role) || user.is_admin) {
      const remaining = await countActiveAdmins(id);
      if (remaining < 1) {
        return res.status(403).json({
          error: 'Der letzte aktive System-Administrator kann nicht gelöscht werden.',
        });
      }
    }

    await deleteDocDirect('users', id);
    await audit(
      'DELETE_USER',
      { targetUserId: id, targetEmail: user.email, details: 'Benutzer gelöscht' },
      req,
    );

    res.json({ success: true, message: 'Benutzer wurde gelöscht.' });
  } catch (err: any) {
    res.status(500).json({ error: safeErrorMessage(err, 'Benutzer konnte nicht gelöscht werden') });
  }
});

export default router;
