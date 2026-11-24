/**
 * Kunden-Portal Tresor API — organization_vault_secrets with client_visible gate.
 *
 * CLIENT_USER → 403 on every endpoint.
 * CLIENT_ADMIN → full CRUD + reveal for org + client_visible=true
 * CLIENT_SUPPORTER → list/create/reveal/update (no delete)
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireClientPortalRole } from '../middleware/clientPortalMiddleware.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  appendOrgVaultAudit,
  assertPortalVaultRole,
  createOrgVaultSecret,
  deleteOrgVaultSecret,
  getOrgVaultSecretById,
  isOrgVaultVisibleToPortal,
  listOrgVaultSecrets,
  normalizeOrgVaultCategory,
  revealOrgVaultSecretPlaintext,
  toOrgVaultListItem,
  updateOrgVaultSecret,
} from '../lib/client-portal/organization-vault.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';

const router = Router();

const writeSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(40).optional(),
  notes: z.string().max(4000).optional().nullable(),
  value: z.string().min(1).max(100_000),
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(40).optional(),
  notes: z.string().max(4000).optional().nullable(),
  value: z.string().min(1).max(100_000).optional(),
});

function sessionOrg(req: Request): string | null {
  return resolveOrganizationIdFromUser(req.user!);
}

/** Block CLIENT_USER (and any non ADMIN/SUPPORTER) with 403. */
function requirePortalVaultWriter(
  modes: Array<'read' | 'write' | 'delete'> = ['read'],
) {
  return (req: Request, res: Response, next: () => any): any => {
    const role = assertPortalVaultRole(req.user?.role);
    if (!role) {
      return res.status(403).json({
        error: 'Forbidden: Tresor is only available to CLIENT_ADMIN and CLIENT_SUPPORTER.',
      });
    }
    if (modes.includes('delete') && role !== 'CLIENT_ADMIN') {
      return res.status(403).json({
        error: 'Forbidden: Only CLIENT_ADMIN may delete Tresor entries.',
      });
    }
    return next();
  };
}

router.use(
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
);

router.get(
  '/',
  requirePortalVaultWriter(['read']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const secrets = await listOrgVaultSecrets({
        organizationId,
        clientVisibleOnly: true,
        category: typeof req.query.category === 'string' ? req.query.category : null,
        q: typeof req.query.q === 'string' ? req.query.q : null,
      });
      return res.json({ secrets });
    } catch (err: any) {
      safeLog('error', '[portal/vault] list failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Tresor konnte nicht geladen werden') });
    }
  },
);

router.get(
  '/:id',
  requirePortalVaultWriter(['read']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const secret = await getOrgVaultSecretById(id);
      if (!secret || !isOrgVaultVisibleToPortal(secret, organizationId)) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      return res.json({ secret: toOrgVaultListItem(secret) });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Eintrag konnte nicht geladen werden') });
    }
  },
);

router.post(
  '/',
  requirePortalVaultWriter(['write']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = sessionOrg(req);
    if (!organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const parsed = writeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Tresor-Daten',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const secret = await createOrgVaultSecret({
        organizationId,
        // Portal creates are always client-visible for this org.
        clientVisible: true,
        createdByUserId: String(req.user!.id),
        name: parsed.data.name,
        category: normalizeOrgVaultCategory(parsed.data.category),
        notes: parsed.data.notes,
        plaintext: parsed.data.value,
      });
      await appendOrgVaultAudit({
        secretId: secret.id,
        organizationId,
        actorUserId: String(req.user!.id),
        actorEmail: req.user!.email,
        action: 'create',
        detail: `Portal create: ${secret.name}`,
      });
      return res.status(201).json({ secret });
    } catch (err: any) {
      safeLog('error', '[portal/vault] create failed', err?.message || err);
      const message = String(err?.message || '');
      if (message.includes('VAULT_ENCRYPTION_KEY')) {
        return res.status(503).json({ error: 'Verschlüsselung ist serverseitig nicht konfiguriert.' });
      }
      return res.status(500).json({ error: safeErrorMessage(err, 'Eintrag konnte nicht erstellt werden') });
    }
  },
);

router.patch(
  '/:id',
  requirePortalVaultWriter(['write']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = sessionOrg(req);
    if (!organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Tresor-Daten',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    try {
      const id = routeParam(req.params.id);
      const existing = await getOrgVaultSecretById(id);
      if (!existing || !isOrgVaultVisibleToPortal(existing, organizationId)) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      const secret = await updateOrgVaultSecret({
        id,
        updatedByUserId: String(req.user!.id),
        name: parsed.data.name,
        category: parsed.data.category,
        notes: parsed.data.notes,
        plaintext: parsed.data.value,
        // Never allow portal to flip client_visible off / change org.
        clientVisible: true,
      });
      await appendOrgVaultAudit({
        secretId: id,
        organizationId,
        actorUserId: String(req.user!.id),
        actorEmail: req.user!.email,
        action: 'update',
        detail: `Portal update: ${secret?.name || id}`,
      });
      return res.json({ secret });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Eintrag konnte nicht gespeichert werden') });
    }
  },
);

router.post(
  '/:id/reveal',
  requirePortalVaultWriter(['read']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const existing = await getOrgVaultSecretById(id);
      if (!existing || !isOrgVaultVisibleToPortal(existing, organizationId)) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      const value = await revealOrgVaultSecretPlaintext(id);
      if (value == null) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      const action = String((req.body as any)?.purpose || 'reveal') === 'copy' ? 'copy' : 'reveal';
      await appendOrgVaultAudit({
        secretId: id,
        organizationId,
        actorUserId: String(req.user!.id),
        actorEmail: req.user!.email,
        action,
        detail: `Portal ${action}`,
      });
      return res.json({ id, value });
    } catch (err: any) {
      safeLog('error', '[portal/vault] reveal failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Geheimnis konnte nicht entschlüsselt werden') });
    }
  },
);

router.delete(
  '/:id',
  requirePortalVaultWriter(['delete']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const existing = await getOrgVaultSecretById(id);
      if (!existing || !isOrgVaultVisibleToPortal(existing, organizationId)) {
        return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
      }
      await deleteOrgVaultSecret(id);
      await appendOrgVaultAudit({
        secretId: id,
        organizationId,
        actorUserId: String(req.user!.id),
        actorEmail: req.user!.email,
        action: 'delete',
        detail: `Portal delete: ${existing.name}`,
      });
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Eintrag konnte nicht gelöscht werden') });
    }
  },
);

export default router;
