/**
 * Short-lived in-memory cache for portal returns dashboard KPIs + trends.
 * TTL 20s per (organizationId, kind[, timeframe]). Invalidate on mutations.
 */

const TTL_MS = 20_000;

type CacheEntry = { expiresAt: number; value: unknown };

const store = new Map<string, CacheEntry>();

function keyDashboard(organizationId: string): string {
  return `dash:${organizationId}`;
}

function keyTrends(organizationId: string, timeframe: string): string {
  return `trends:${organizationId}:${timeframe}`;
}

export function getPortalReturnsCacheTtlMs(): number {
  return TTL_MS;
}

export function getCachedPortalDashboardReturns<T>(organizationId: string): T | null {
  const hit = store.get(keyDashboard(organizationId));
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(keyDashboard(organizationId));
    return null;
  }
  return hit.value as T;
}

export function setCachedPortalDashboardReturns(
  organizationId: string,
  value: unknown,
): void {
  store.set(keyDashboard(organizationId), {
    expiresAt: Date.now() + TTL_MS,
    value,
  });
}

export function getCachedPortalReturnsTrends<T>(
  organizationId: string,
  timeframe: string,
): T | null {
  const k = keyTrends(organizationId, timeframe);
  const hit = store.get(k);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(k);
    return null;
  }
  return hit.value as T;
}

export function setCachedPortalReturnsTrends(
  organizationId: string,
  timeframe: string,
  value: unknown,
): void {
  store.set(keyTrends(organizationId, timeframe), {
    expiresAt: Date.now() + TTL_MS,
    value,
  });
}

/** Drop all dashboard + trends cache entries for one organization. */
export function invalidatePortalReturnsCache(organizationId: string): void {
  const org = String(organizationId || '').trim();
  if (!org) return;
  const prefixDash = `dash:${org}`;
  const prefixTrends = `trends:${org}:`;
  for (const k of store.keys()) {
    if (k === prefixDash || k.startsWith(prefixTrends)) store.delete(k);
  }
}

/** Test helper — wipe entire cache. */
export function clearPortalReturnsCacheForTests(): void {
  store.clear();
}

/** Test helper — current entry count. */
export function portalReturnsCacheSizeForTests(): number {
  return store.size;
}
