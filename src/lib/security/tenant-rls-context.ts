/**
 * AsyncLocalStorage for transaction-scoped tenant RLS (SET LOCAL).
 * Kept dependency-free so postgres-backend can read the active client
 * without circular imports.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type pg from 'pg';

export type TenantRlsMode = 'portal' | 'staff_scoped' | 'super_admin' | 'system';

export type TenantRlsStore = {
  client: pg.PoolClient;
  mode: TenantRlsMode;
  orgId?: string | null;
  allowedOrgIds?: string[];
};

const tenantRlsAls = new AsyncLocalStorage<TenantRlsStore>();

export function getTenantRlsStore(): TenantRlsStore | undefined {
  return tenantRlsAls.getStore();
}

export function getTenantRlsClient(): pg.PoolClient | null {
  return tenantRlsAls.getStore()?.client || null;
}

export function runWithTenantRlsStore<T>(store: TenantRlsStore, fn: () => Promise<T>): Promise<T> {
  return tenantRlsAls.run(store, fn);
}
