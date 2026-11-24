/**
 * Kunden-Portal Secure Exchange API — org-scoped vault access.
 *
 * GET    /api/portal/exchange
 * GET    /api/portal/exchange/:id
 * POST   /api/portal/exchange
 * POST   /api/portal/exchange/:id/reveal
 * POST   /api/portal/exchange/:id/revoke
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../lib/postgres-backend.js';
import { requireClientPortalRole } from '../middleware/clientPortalMiddleware.js';
import { resolveOrganizationIdFromUser } from '../lib/client-portal/ticket-visibility.js';
import {
  canPortalUserAccessVaultItem,
  isVaultItemInOrganization,
  sanitizeVaultItemForPortal,
  vaultCreatedByUserId,
} from '../lib/client-portal/exchange-visibility.js';
import {
  assertVaultEncryptionConfigured,
  decryptPayloadAuto,
  encryptExchangeAtRest,
  hashPassword,
} from '../lib/crypto.js';
import { routeParam } from '../lib/route-params.js';
import { safeErrorMessage, safeLog } from '../lib/safe-log.js';
import { appendExchangeAuditLog } from '../lib/exchange-audit-log.js';

const VAULT_ITEMS = 'vault_items';
const VAULT_SECRETS = 'vault_item_secrets';

const router = Router();

const createSchema = z.object({
  content: z.string().min(1),
  secretType: z.string().max(120).optional(),
  expiresAt: z.string().nullable().optional(),
  maxViews: z.number().int().positive().max(1000).optional().default(1),
  passphrase: z.string().min(1).optional(),
  recipientEmails: z.array(z.string().email()).optional(),
  description: z.string().max(2000).optional(),
});

function sessionOrg(req: Request): string | null {
  return resolveOrganizationIdFromUser(req.user!);
}

function canAccess(req: Request, item: Record<string, unknown>): boolean {
  const organizationId = sessionOrg(req);
  if (!organizationId) return false;
  return canPortalUserAccessVaultItem({
    item,
    organizationId,
    role: String(req.user?.role || ''),
    userId: String(req.user?.id || ''),
    userEmail: req.user?.email || null,
  });
}

function isBurnedOrExpired(item: any): boolean {
  if (item?.isBurned || item?.is_active === false) return true;
  if (item?.expiresAt && new Date(item.expiresAt).getTime() < Date.now()) return true;
  const maxViews =
    typeof item?.maxViews === 'number' && item.maxViews > 0
      ? item.maxViews
      : Number(item?.metadata?.maxViews || 0) || Infinity;
  const views = Number(item?.viewCount || 0);
  return Number.isFinite(maxViews) && views >= maxViews;
}

router.get(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }

      const rows = await getDocsDirect(VAULT_ITEMS, []);
      const items = rows
        .filter((row) => canAccess(req, row))
        .map((row) => sanitizeVaultItemForPortal(row))
        .sort((a, b) => {
          const aT = new Date(String(a.createdAt || 0)).getTime();
          const bT = new Date(String(b.createdAt || 0)).getTime();
          return bT - aT;
        });

      return res.json({ items });
    } catch (err: any) {
      safeLog('error', '[portal/exchange] list failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Transfers konnten nicht geladen werden') });
    }
  },
);

router.get(
  '/:id',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const id = routeParam(req.params.id);
      const item = await getDocDirect(VAULT_ITEMS, id);
      if (!item || !canAccess(req, item)) {
        return res.status(404).json({ error: 'Transfer nicht gefunden.' });
      }
      return res.json({ item: sanitizeVaultItemForPortal(item) });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Transfer konnte nicht geladen werden') });
    }
  },
);

router.post(
  '/',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    const organizationId = sessionOrg(req);
    if (!organizationId) {
      return res.status(403).json({ error: 'Organization missing.' });
    }

    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Ungültige Transfer-Daten',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    let secretRef: string | null = null;
    let itemId: string | null = null;

    try {
      assertVaultEncryptionConfigured();
      const { content, secretType, expiresAt, maxViews, passphrase, recipientEmails, description } =
        parsed.data;

      const secretRecord = await addDocDirect(VAULT_SECRETS, {
        createdBy: req.user!.id,
        createdAt: new Date().toISOString(),
      });
      secretRef = secretRecord.id;

      const metadata = {
        isQuantumSafe: true,
        pqcLevel: 3,
        secretType: secretType || 'Text',
        description: description || undefined,
        recipientEmails: recipientEmails || [],
        targetRecipient: recipientEmails?.[0] || undefined,
        maxViews,
        organizationId,
        createdVia: 'client_portal',
      };

      const itemRecord = await addDocDirect(VAULT_ITEMS, {
        type: 'secret',
        secretRef,
        sharesCount: 0,
        expirationType: 'quota',
        expiresAt: expiresAt || null,
        maxViews: Math.max(1, maxViews),
        viewCount: 0,
        passphraseHash: passphrase ? await hashPassword(passphrase) : null,
        isBurned: false,
        createdBy: req.user!.id,
        created_by_user_id: req.user!.id,
        organizationId,
        organization_id: organizationId,
        createdAt: new Date().toISOString(),
        metadata,
      });
      itemId = itemRecord.id;

      const provenance = `exchange:${req.user!.id}:${itemRecord.id}`;
      const encryptedContent = encryptExchangeAtRest(content.trim(), provenance);
      await updateDocDirect(VAULT_SECRETS, secretRef, { encryptedContent });

      void appendExchangeAuditLog({
        userId: req.user!.id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'secret_created',
        itemId: itemRecord.id,
        itemName: String(secretType || 'Portal-Transfer'),
        message: `Portal-Transfer erstellt von ${req.user!.email || req.user!.id} (org ${organizationId}).`,
      });

      const stored = await getDocDirect(VAULT_ITEMS, itemRecord.id);
      return res.status(201).json({
        item: sanitizeVaultItemForPortal(stored || { id: itemRecord.id, organizationId }),
        sharePath: `/v/${itemRecord.id}`,
      });
    } catch (err: any) {
      safeLog('error', '[portal/exchange] create failed', err?.message || err);
      if (secretRef) await deleteDocDirect(VAULT_SECRETS, secretRef).catch(() => undefined);
      if (itemId) await deleteDocDirect(VAULT_ITEMS, itemId).catch(() => undefined);
      const message = String(err?.message || '');
      if (message.includes('VAULT_ENCRYPTION_KEY')) {
        return res.status(503).json({
          error: 'Verschlüsselung ist serverseitig nicht konfiguriert.',
        });
      }
      return res.status(500).json({ error: safeErrorMessage(err, 'Transfer konnte nicht erstellt werden') });
    }
  },
);

router.post(
  '/:id/reveal',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const id = routeParam(req.params.id);
      const item = await getDocDirect(VAULT_ITEMS, id);
      if (!item || !canAccess(req, item)) {
        return res.status(404).json({ error: 'Transfer nicht gefunden.' });
      }
      if (isBurnedOrExpired(item)) {
        return res.status(410).json({ error: 'Transfer ist abgelaufen oder vernichtet.', isBurned: true });
      }
      if (!item.secretRef) {
        return res.status(404).json({ error: 'Kein Inhalt hinterlegt.' });
      }

      const secret = await getDocDirect(VAULT_SECRETS, String(item.secretRef));
      if (!secret?.encryptedContent && !Array.isArray(secret?.encryptedShares)) {
        return res.status(404).json({ error: 'Kein Inhalt hinterlegt.' });
      }

      const nextViewCount = Number(item.viewCount || 0) + 1;
      const maxViews =
        typeof item.maxViews === 'number' && item.maxViews > 0
          ? item.maxViews
          : Number(item.metadata?.maxViews || 1);
      const shouldBurn = nextViewCount >= maxViews;

      await updateDocDirect(VAULT_ITEMS, id, {
        viewCount: nextViewCount,
        ...(shouldBurn
          ? { isBurned: true, is_active: false, burnedAt: new Date().toISOString() }
          : {}),
      });

      const content = secret.encryptedContent
        ? decryptPayloadAuto(secret.encryptedContent)
        : null;
      const shares = Array.isArray(secret.encryptedShares)
        ? secret.encryptedShares.map((payload: unknown) => decryptPayloadAuto(payload as any))
        : [];

      if (shouldBurn && item.secretRef) {
        await deleteDocDirect(VAULT_SECRETS, String(item.secretRef)).catch(() => undefined);
      }

      return res.json({
        id,
        content,
        shares,
        viewCount: nextViewCount,
        maxViews,
        burned: shouldBurn,
      });
    } catch (err: any) {
      safeLog('error', '[portal/exchange] reveal failed', err?.message || err);
      return res.status(500).json({ error: safeErrorMessage(err, 'Inhalt konnte nicht geladen werden') });
    }
  },
);

router.post(
  '/:id/revoke',
  requireClientPortalRole(['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']),
  async (req: Request, res: Response): Promise<any> => {
    try {
      const organizationId = sessionOrg(req);
      if (!organizationId) {
        return res.status(403).json({ error: 'Organization missing.' });
      }
      const id = routeParam(req.params.id);
      const item = await getDocDirect(VAULT_ITEMS, id);
      if (!item || !isVaultItemInOrganization(item, organizationId)) {
        return res.status(404).json({ error: 'Transfer nicht gefunden.' });
      }

      const role = String(req.user?.role || '');
      const createdBy = vaultCreatedByUserId(item);
      const isOrgWide = role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER';
      if (!isOrgWide && createdBy !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden: Sie können nur eigene Transfers widerrufen.' });
      }

      await updateDocDirect(VAULT_ITEMS, id, {
        isBurned: true,
        is_active: false,
        burnedAt: new Date().toISOString(),
      });
      if (item.secretRef) {
        await deleteDocDirect(VAULT_SECRETS, String(item.secretRef)).catch(() => undefined);
      }

      void appendExchangeAuditLog({
        userId: createdBy || req.user!.id,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'credential_burned',
        itemId: id,
        itemName: String(item.metadata?.secretType || 'Portal-Transfer'),
        message: `Portal-Transfer widerrufen von ${req.user!.email || req.user!.id}.`,
      });

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: safeErrorMessage(err, 'Transfer konnte nicht widerrufen werden') });
    }
  },
);

export default router;
