/**
 * Transaction-scoped PostgreSQL tenant RLS helper (SET LOCAL).
 * Pooled connections never leak org context: SET LOCAL resets on COMMIT/ROLLBACK.
 */

import type { NextFunction, Response } from 'express';
import type pg from 'pg';
import {
  getTenantRlsClient,
  getTenantRlsStore,
  runWithTenantRlsStore,
  type TenantRlsMode,
  type TenantRlsStore,
} from './tenant-rls-context.js';
import { TENANT_RLS_DDL } from './tenant-rls-ddl.js';
import { isClientPortalRole } from '../client-portal/roles.js';
import { resolveOrganizationIdFromUser } from '../client-portal/ticket-visibility.js';
import {
  canManageHubcomCore,
  normalizeHubcomMatrixRole,
} from '../staff-org-access-shared.js';

export type TenantContextInput = {
  mode: TenantRlsMode;
  orgId?: string | null;
  allowedOrgIds?: string[] | 'ALL' | null;
};

let rlsReady = false;

export async function ensureTenantRlsPolicies(query: (sql: string) => Promise<unknown>): Promise<void> {
  await query(TENANT_RLS_DDL);
  rlsReady = true;
}

export function isTenantRlsReady(): boolean {
  return rlsReady;
}

async function applyTenantLocalSettings(
  client: pg.PoolClient,
  ctx: TenantContextInput,
): Promise<void> {
  // Assume hubcom_app when available so RLS applies even for table owners.
  try {
    await client.query('SET LOCAL ROLE hubcom_app');
  } catch {
    /* role may not exist yet on fresh DBs before ensureTenantRlsPolicies */
  }

  await client.query(`SELECT set_config('app.rls_mode', $1, true)`, [ctx.mode]);

  if (ctx.mode === 'portal') {
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
      String(ctx.orgId || ''),
    ]);
    await client.query(`SELECT set_config('app.allowed_org_ids', '', true)`);
  } else if (ctx.mode === 'staff_scoped') {
    const allowed =
      ctx.allowedOrgIds === 'ALL'
        ? ''
        : (ctx.allowedOrgIds || []).map((id) => String(id).trim()).filter(Boolean).join(',');
    await client.query(`SELECT set_config('app.allowed_org_ids', $1, true)`, [allowed]);
    await client.query(`SELECT set_config('app.current_org_id', '', true)`);
  } else {
    await client.query(`SELECT set_config('app.current_org_id', '', true)`);
    await client.query(`SELECT set_config('app.allowed_org_ids', '', true)`);
  }
}

/**
 * Run work inside a single DB transaction with SET LOCAL tenant GUCs.
 * All queryDb / getDocsDirect calls while the ALS store is active reuse this client.
 */
export async function withTenantContext<T>(
  ctx: TenantContextInput,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const existing = getTenantRlsStore();
  // Nesting: only reuse when the active context already matches the request.
  // Never reuse system/super_admin for a portal/staff_scoped call (would bypass isolation).
  if (existing) {
    const sameMode = existing.mode === ctx.mode;
    const samePortalOrg =
      ctx.mode !== 'portal' || String(existing.orgId || '') === String(ctx.orgId || '');
    const elevatingToSystem =
      (ctx.mode === 'system' || ctx.mode === 'super_admin') &&
      (existing.mode === 'system' || existing.mode === 'super_admin');
    if ((sameMode && samePortalOrg) || elevatingToSystem) {
      return fn(existing.client);
    }
  }

  const { getPgPool } = await import('../postgres-backend.js');
  const pool = getPgPool();
  const client = await pool.connect();
  const store: TenantRlsStore = {
    client,
    mode: ctx.mode,
    orgId: ctx.orgId,
    allowedOrgIds: Array.isArray(ctx.allowedOrgIds) ? ctx.allowedOrgIds : undefined,
  };

  try {
    await client.query('BEGIN');
    await applyTenantLocalSettings(client, ctx);
    const result = await runWithTenantRlsStore(store, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    // Reset role before returning to pool (SET LOCAL already cleared on end of txn,
    // but be explicit for session leftovers if BEGIN never ran).
    try {
      await client.query('RESET ROLE');
    } catch {
      /* ignore */
    }
    client.release();
  }
}

/**
 * Boot / workers / pre-auth: full document access under FORCE RLS + hubcom_app.
 * Reuses an existing system/super_admin ALS context when already active.
 */
export async function withSystemTenantContext<T>(fn: () => Promise<T>): Promise<T> {
  return withTenantContext({ mode: 'system' }, async () => fn());
}

/**
 * Express middleware: bind the request to system RLS mode (SET LOCAL) until
 * the response finishes. Use for pre-auth paths that must read/write
 * geistdesk_documents without a portal/staff org context.
 */
export function systemRlsMiddleware(
  req: any,
  res: Response,
  next: NextFunction,
): void {
  let settled = false;
  const finish = (err?: unknown) => {
    if (settled) return;
    settled = true;
    if (err && !res.headersSent) {
      next(err);
    }
  };

  void withTenantContext({ mode: 'system' }, async () => {
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        res.removeListener('finish', done);
        res.removeListener('close', done);
        resolve();
      };
      res.on('finish', done);
      res.on('close', done);
      try {
        next();
      } catch (err) {
        reject(err);
      }
    });
  })
    .then(() => finish())
    .catch((err) => finish(err));
}

/**
 * Resolve RLS context from an authenticated user (sync; uses staffAccess when present).
 * - SUPER_ADMIN / HUBCOM_ADMIN / unrestricted Hubcom core → super_admin
 * - Scoped HUBCOM_AGENT / HUBCOM_USER → staff_scoped
 * - CLIENT_* portal → portal
 * - Unauthenticated callers should use system mode via systemRlsMiddleware
 */
export function resolveTenantContextFromUser(user: any): TenantContextInput | null {
  if (!user) return null;

  if (isClientPortalRole(user.role)) {
    const orgId = resolveOrganizationIdFromUser(user);
    if (!orgId) return null;
    return { mode: 'portal', orgId };
  }

  const matrix = normalizeHubcomMatrixRole(user.role, user.is_admin === true);
  // Hubcom core admins retain full visibility under FORCE RLS (PII & Compliance, /api/db).
  if (
    matrix === 'SUPER_ADMIN' ||
    matrix === 'HUBCOM_ADMIN' ||
    canManageHubcomCore(user)
  ) {
    return { mode: 'super_admin' };
  }

  const staffAccess = user.staffAccess;
  const accessible = staffAccess?.accessibleOrganizationIds;
  if (accessible === 'ALL') {
    return { mode: 'super_admin' };
  }
  const allowed = Array.isArray(accessible)
    ? accessible.map(String)
    : Array.isArray(staffAccess?.organizationAccess)
      ? staffAccess.organizationAccess
          .map((r: any) => String(r.organization_id || ''))
          .filter(Boolean)
      : [];

  if (matrix === 'HUBCOM_AGENT' || matrix === 'HUBCOM_USER') {
    return { mode: 'staff_scoped', allowedOrgIds: allowed };
  }

  return { mode: 'system' };
}

/** Resolve RLS context from an authenticated Express request. */
export function resolveTenantContextFromRequest(req: any): TenantContextInput | null {
  return resolveTenantContextFromUser(req?.user);
}

/**
 * Ensure req.user.staffAccess is populated (needed for staff_scoped RLS).
 * Safe to call after authenticate; no-ops for portal users.
 */
export async function enrichRequestStaffAccess(req: any): Promise<void> {
  const user = req?.user;
  if (!user || isClientPortalRole(user.role) || user.staffAccess) return;
  try {
    const {
      canManageHubcomCore: canCore,
      getAccessibleOrganizationIds,
      listUserOrganizationAccess,
    } = await import('../staff-org-access.js');
    const accessible = await getAccessibleOrganizationIds(user);
    const rows = await listUserOrganizationAccess(String(user.id || ''));
    user.staffAccess = {
      canManageHubcomCore: canCore(user),
      accessibleOrganizationIds: accessible,
      organizationAccess: rows.map((r) => ({
        organization_id: r.organization_id,
        access_role: r.access_role,
      })),
    };
  } catch {
    /* staff access optional — matrix role still drives SUPER_ADMIN / HUBCOM_ADMIN */
  }
}

/**
 * Express middleware: bind the request to a tenant RLS transaction until the
 * response finishes.
 *
 * Mount globally on `/api` after optionalAuthenticate (so cookie/Bearer sessions
 * populate req.user). Unauthenticated requests fall back to `{ mode: 'system' }`
 * so FORCE RLS never fail-closes vault/exchange/dashboard queries.
 * Portal/returns may remount after authenticate to refine to portal/staff scope.
 */
export function tenantRlsMiddleware(
  req: any,
  res: Response,
  next: NextFunction,
): void {
  let settled = false;
  const finish = (err?: unknown) => {
    if (settled) return;
    settled = true;
    if (err && !res.headersSent) {
      next(err);
    }
  };

  void (async () => {
    await enrichRequestStaffAccess(req);
    const ctx: TenantContextInput =
      resolveTenantContextFromRequest(req) || { mode: 'system' };
    await withTenantContext(ctx, async () => {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          res.removeListener('finish', done);
          res.removeListener('close', done);
          resolve();
        };
        res.on('finish', done);
        res.on('close', done);
        try {
          next();
        } catch (err) {
          reject(err);
        }
      });
    });
  })()
    .then(() => finish())
    .catch((err) => finish(err));
}

/** Pure evaluator for tests (mirrors SQL helpers without Postgres). */
export function evaluateRlsOrgAllowed(params: {
  mode: TenantRlsMode | '' | null;
  orgId: string | null | undefined;
  currentOrgId?: string | null;
  allowedOrgIds?: string[];
}): boolean {
  const mode = params.mode || '';
  const orgId = params.orgId == null || params.orgId === '' ? null : String(params.orgId);
  if (mode === 'super_admin' || mode === 'system') return true;
  if (mode === 'portal') {
    return orgId != null && orgId === String(params.currentOrgId || '');
  }
  if (mode === 'staff_scoped') {
    if (orgId == null) return true;
    return (params.allowedOrgIds || []).includes(orgId);
  }
  return false;
}

export function assertSetLocalDoesNotBleed(params: {
  firstOrg: string;
  secondOrg: string;
  seenAfterFirst: string[];
  seenAfterSecond: string[];
}): boolean {
  // After first portal context, only firstOrg rows; after second, only secondOrg —
  // never a mix that would indicate pool bleed.
  const onlyFirst =
    params.seenAfterFirst.length > 0 &&
    params.seenAfterFirst.every((id) => id === params.firstOrg);
  const onlySecond =
    params.seenAfterSecond.length > 0 &&
    params.seenAfterSecond.every((id) => id === params.secondOrg);
  const noCross =
    !params.seenAfterFirst.includes(params.secondOrg) &&
    !params.seenAfterSecond.includes(params.firstOrg);
  return onlyFirst && onlySecond && noCross;
}

export { getTenantRlsStore, getTenantRlsClient };
