/**
 * Safe, tenant-isolated deletion of CLIENT_* portal users (and linked CRM contacts).
 * Frees the email for re-invite into another organization.
 */

import type pg from 'pg';
import {
  getDocDirect,
  getDocsDirect,
  withPgTransaction,
} from '../postgres-backend.js';
import { isClientPortalRole, isHubcomStaffRole } from './roles.js';
import { userOrganizationId } from './team-service.js';
import { getOrganization } from './organizations.js';

export type PortalUserDeleteActor = {
  id: string;
  role: string;
  organizationId: string | null;
};

export type PortalUserDeleteGate =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

/** Pure RBAC gate used by routes + isolation tests. */
export function evaluatePortalUserDeleteAccess(params: {
  mode: 'admin' | 'portal';
  actor: PortalUserDeleteActor;
  target: {
    id: string;
    role: string;
    organizationId: string | null;
  };
  routeOrgId: string;
}): PortalUserDeleteGate {
  const { mode, actor, target, routeOrgId } = params;

  if (isHubcomStaffRole(target.role) || target.role === 'SYSTEM_ADMIN') {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Hubcom staff accounts cannot be deleted via this endpoint.',
    };
  }
  if (!isClientPortalRole(target.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Target is not a client portal user.',
    };
  }
  if (!target.organizationId || target.organizationId !== routeOrgId) {
    return {
      ok: false,
      status: 404,
      error: 'Portal user not found for this organization.',
    };
  }

  if (mode === 'admin') {
    if (actor.role !== 'SYSTEM_ADMIN') {
      return { ok: false, status: 403, error: 'Forbidden: SYSTEM_ADMIN required.' };
    }
    return { ok: true };
  }

  // Portal CLIENT_ADMIN path
  if (actor.role !== 'CLIENT_ADMIN') {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Only CLIENT_ADMIN can remove team members.',
    };
  }
  if (!actor.organizationId || actor.organizationId !== routeOrgId) {
    return { ok: false, status: 403, error: 'Forbidden: organization mismatch.' };
  }
  if (actor.organizationId !== target.organizationId) {
    return { ok: false, status: 404, error: 'Portal user not found for this organization.' };
  }
  if (actor.id === target.id) {
    return {
      ok: false,
      status: 400,
      error: 'Sie können sich nicht selbst entfernen.',
    };
  }
  return { ok: true };
}

/** Auth status when the user document no longer exists (deleted). */
export function authStatusWhenUserMissing(): 401 {
  return 401;
}

async function findLinkedContactIds(params: {
  userId: string;
  email: string;
  companyId: string | null;
}): Promise<string[]> {
  const ids = new Set<string>();
  const byEmail = params.email
    ? await getDocsDirect('contacts', [
        { type: 'where', field: 'email', op: '==', value: params.email.toLowerCase().trim() },
      ])
    : [];
  for (const c of byEmail) {
    const companyOk =
      !params.companyId || String(c.companyId || '') === String(params.companyId);
    const portalId = String((c.metadata as any)?.portalUserId || '');
    if (companyOk && (portalId === params.userId || !portalId)) {
      ids.add(String(c.id));
    }
  }
  // Also scan contacts that reference this portal user id in metadata.
  const allContacts = await getDocsDirect('contacts', []);
  for (const c of allContacts) {
    const portalId = String((c.metadata as any)?.portalUserId || '');
    if (portalId === params.userId) ids.add(String(c.id));
  }
  return Array.from(ids);
}

/**
 * Detach soft references in JSONB collections, remove participants, delete user + contacts.
 * Runs inside one PostgreSQL transaction.
 */
export async function deletePortalOrganizationUser(params: {
  organizationId: string;
  userId: string;
  actor: PortalUserDeleteActor;
  mode: 'admin' | 'portal';
}): Promise<{
  deletedUserId: string;
  email: string;
  name: string;
  deletedContactIds: string[];
}> {
  const user = await getDocDirect('users', params.userId);
  if (!user) {
    throw Object.assign(new Error('Portal user not found for this organization.'), {
      status: 404,
    });
  }
  const targetOrg = userOrganizationId(user);
  const gate = evaluatePortalUserDeleteAccess({
    mode: params.mode,
    actor: params.actor,
    target: {
      id: params.userId,
      role: String(user.role || ''),
      organizationId: targetOrg,
    },
    routeOrgId: params.organizationId,
  });
  if (gate.ok === false) {
    throw Object.assign(new Error(gate.error), { status: gate.status });
  }

  const org = await getOrganization(params.organizationId);
  if (!org) {
    throw Object.assign(new Error('Organization not found.'), { status: 404 });
  }

  const email = String(user.email || '').toLowerCase().trim();
  const name = String(user.name || email || params.userId);
  const contactIds = await findLinkedContactIds({
    userId: params.userId,
    email,
    companyId: org.crm_company_id || null,
  });

  await withPgTransaction(async (client) => {
    // 1) Participants + soft tokens live on the user doc (deleted with the row).
    await client.query(`DELETE FROM ticket_participants WHERE user_id = $1`, [params.userId]);
    await client.query(`DELETE FROM ticket_participants WHERE added_by = $1`, [params.userId]);

    // 2) Detach historical soft refs without dropping company/ticket records.
    await detachSoftUserRefs(client, params.userId);

    // Org vault — created_by_user_id is NOT NULL TEXT (no FK). Clear updated_by only.
    await client
      .query(
        `UPDATE organization_vault_secrets
            SET updated_by_user_id = NULL
          WHERE updated_by_user_id = $1`,
        [params.userId],
      )
      .catch(() => undefined);

    // 3) Delete linked CRM contacts + the user document.
    for (const contactId of contactIds) {
      await client.query(
        `DELETE FROM geistdesk_documents WHERE collection = 'contacts' AND id = $1`,
        [contactId],
      );
    }
    await client.query(
      `DELETE FROM geistdesk_documents WHERE collection = 'users' AND id = $1`,
      [params.userId],
    );

    // 4) Organization activity log.
    const activityId = `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const activity = {
      id: activityId,
      organizationId: params.organizationId,
      organization_id: params.organizationId,
      type: 'portal_user_removed',
      message: `Portal-Benutzer entfernt: ${name} (${email})`,
      actorId: params.actor.id,
      actorRole: params.actor.role,
      targetUserId: params.userId,
      targetEmail: email,
      createdAt: now,
    };
    await client.query(
      `INSERT INTO geistdesk_documents (collection, id, data)
       VALUES ('organization_activity', $1, $2::jsonb)
       ON CONFLICT (collection, id) DO UPDATE
         SET data = EXCLUDED.data, updated_at = NOW()`,
      [activityId, JSON.stringify(activity)],
    );
  });

  return {
    deletedUserId: params.userId,
    email,
    name,
    deletedContactIds: contactIds,
  };
}

async function detachSoftUserRefs(client: pg.PoolClient, userId: string): Promise<void> {
  // Tickets: clear requester / portalUserId / creator soft refs; keep customer_name/email text.
  await client.query(
    `UPDATE geistdesk_documents
        SET data = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(COALESCE(data, '{}'::jsonb), '{requesterId}', 'null'::jsonb, true),
                    '{requester_id}', 'null'::jsonb, true
                  ),
                  '{portalUserId}', 'null'::jsonb, true
                ),
                '{creatorId}',
                CASE WHEN data->>'creatorId' = $1 THEN 'null'::jsonb ELSE COALESCE(data->'creatorId', 'null'::jsonb) END,
                true
              ),
              '{createdBy}',
              CASE WHEN data->>'createdBy' = $1 THEN 'null'::jsonb ELSE COALESCE(data->'createdBy', 'null'::jsonb) END,
              true
            ),
            updated_at = NOW()
      WHERE collection = 'tickets'
        AND (
          data->>'requesterId' = $1
          OR data->>'requester_id' = $1
          OR data->>'portalUserId' = $1
          OR data->>'creatorId' = $1
          OR data->>'createdBy' = $1
        )`,
    [userId],
  );

  // KB articles
  await client.query(
    `UPDATE geistdesk_documents
        SET data = jsonb_set(
              jsonb_set(
                jsonb_set(COALESCE(data, '{}'::jsonb), '{authorId}', 'null'::jsonb, true),
                '{created_by_user_id}', 'null'::jsonb, true
              ),
              '{createdBy}', 'null'::jsonb, true
            ),
            updated_at = NOW()
      WHERE collection IN ('kb_articles', 'articles', 'knowledge_articles')
        AND (
          data->>'authorId' = $1
          OR data->>'created_by_user_id' = $1
          OR data->>'createdBy' = $1
        )`,
    [userId],
  );

  // Secure Exchange / vault_items
  await client.query(
    `UPDATE geistdesk_documents
        SET data = jsonb_set(
              jsonb_set(COALESCE(data, '{}'::jsonb), '{createdBy}', 'null'::jsonb, true),
              '{created_by_user_id}', 'null'::jsonb, true
            ),
            updated_at = NOW()
      WHERE collection IN ('vault_items', 'exchange_items', 'secure_exchange')
        AND (data->>'createdBy' = $1 OR data->>'created_by_user_id' = $1)`,
    [userId],
  );

  // Audit logs — detach actor
  await client.query(
    `UPDATE geistdesk_documents
        SET data = jsonb_set(
              jsonb_set(COALESCE(data, '{}'::jsonb), '{actorId}', 'null'::jsonb, true),
              '{userId}', 'null'::jsonb, true
            ),
            updated_at = NOW()
      WHERE collection IN ('audit_logs', 'audit')
        AND (data->>'actorId' = $1 OR data->>'userId' = $1)`,
    [userId],
  );
}

/**
 * Delete a CRM contact for an organization. If the contact is linked to a
 * portal user, also deletes that portal user (SYSTEM_ADMIN only via admin route).
 */
export async function deleteOrganizationContact(params: {
  organizationId: string;
  contactId: string;
  actor: PortalUserDeleteActor;
}): Promise<{
  deletedContactId: string;
  deletedUserId: string | null;
  email: string | null;
}> {
  if (params.actor.role !== 'SYSTEM_ADMIN') {
    throw Object.assign(new Error('Forbidden: SYSTEM_ADMIN required.'), { status: 403 });
  }
  const org = await getOrganization(params.organizationId);
  if (!org) {
    throw Object.assign(new Error('Organization not found.'), { status: 404 });
  }
  const contact = await getDocDirect('contacts', params.contactId);
  if (!contact) {
    throw Object.assign(new Error('Kontakt nicht gefunden.'), { status: 404 });
  }
  const companyId = org.crm_company_id;
  if (companyId && String(contact.companyId || '') !== String(companyId)) {
    throw Object.assign(new Error('Kontakt gehört nicht zu dieser Organisation.'), {
      status: 404,
    });
  }

  const portalUserId = String((contact.metadata as any)?.portalUserId || '').trim() || null;
  const email = String(contact.email || '').toLowerCase().trim() || null;

  if (portalUserId) {
    const result = await deletePortalOrganizationUser({
      organizationId: params.organizationId,
      userId: portalUserId,
      actor: params.actor,
      mode: 'admin',
    });
    return {
      deletedContactId: params.contactId,
      deletedUserId: result.deletedUserId,
      email: result.email,
    };
  }

  await withPgTransaction(async (client) => {
    await client.query(
      `DELETE FROM geistdesk_documents WHERE collection = 'contacts' AND id = $1`,
      [params.contactId],
    );
  });

  return {
    deletedContactId: params.contactId,
    deletedUserId: null,
    email,
  };
}
