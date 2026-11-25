/**
 * Daily M365 directory sync for orgs with m365_directory_sync.enabled = true.
 */

import { listOrgsNeedingDirectorySync, syncOrganizationDirectoryFromGraph } from './organization-directory-sync.js';

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const orgIds = await listOrgsNeedingDirectorySync();
    for (const orgId of orgIds) {
      try {
        const result = await syncOrganizationDirectoryFromGraph(orgId);
        console.info(
          `[directory-sync] org=${orgId.slice(0, 8)}… synced=${result.syncedCount}`,
        );
      } catch (err: any) {
        console.warn(
          `[directory-sync] org=${orgId.slice(0, 8)}… failed:`,
          err?.message || err,
        );
      }
    }
  } catch (err: any) {
    console.warn('[directory-sync] pass failed:', err?.message || err);
  } finally {
    running = false;
  }
}

/** Start daily directory sync (default 24h). Soft-delayed first tick. */
export function startOrganizationDirectoryScheduler(
  intervalMs = 24 * 60 * 60 * 1000,
): void {
  if (started) return;
  started = true;
  const ms = Math.max(60_000, intervalMs);
  timer = setInterval(() => {
    void tick();
  }, ms);
  // Soft delay so boot doesn't contend with DB init / Graph rate limits.
  setTimeout(() => void tick(), 45_000);
  console.info(`[directory-sync] scheduler started (interval=${ms}ms)`);
}

export function stopOrganizationDirectoryScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  running = false;
}
