/**
 * Hintergrund-Job für Zeiterfassung:
 * - erzeugt lokale Gesamt-Excel
 * - synct optional nach Microsoft Graph
 * - monatliche SharePoint-Auto-Sync (Europa/Berlin Tag+Uhrzeit, Period-Lock)
 */
import {
  completeJob,
  enqueueJob,
  failJob,
  leaseNextJob,
  recoverOrphanedJobs,
  type BackgroundJobType,
} from '../job-queue.js';
import { safeErrorMessage } from '../safe-log.js';
import { writeTimeEntriesExportFile } from './excel-export.js';
import { syncTimeEntriesToGraph } from './graph-sync.js';
import {
  loadTimeTrackingSettings,
  monthlySyncPeriodKey,
  saveTimeTrackingSettings,
  shouldRunMonthlySharePointSync,
} from './settings.js';
import { listAllTimeEntries } from './store.js';

export const TIME_EXPORT_JOB_TYPE: BackgroundJobType = 'TIME_EXPORT_SYNC';

let enqueueInterval: ReturnType<typeof setInterval> | null = null;
let drainInterval: ReturnType<typeof setInterval> | null = null;
let monthlyCheckInterval: ReturnType<typeof setInterval> | null = null;
let started = false;
let monthlyLock = false;

async function runTimeExportJob(): Promise<{ filePath: string; graphMessage?: string }> {
  const entries = await listAllTimeEntries();
  const filePath = await writeTimeEntriesExportFile(entries);
  const settings = await loadTimeTrackingSettings();
  let graphMessage: string | undefined;
  if (settings.graph.enabled) {
    const result = await syncTimeEntriesToGraph({ onlyUnsynced: false });
    graphMessage = result.message;
  }
  return { filePath, graphMessage };
}

export async function drainTimeExportQueue(): Promise<void> {
  const workerId = `time-export-${process.pid}`;
  for (let i = 0; i < 5; i += 1) {
    const job = await leaseNextJob(workerId, [TIME_EXPORT_JOB_TYPE]);
    if (!job) return;
    try {
      const result = await runTimeExportJob();
      console.info(
        `[time-export] Job ${job.id} fertig → ${result.filePath}${result.graphMessage ? ` | ${result.graphMessage}` : ''}`,
      );
      await completeJob(job.id);
    } catch (err) {
      await failJob(job.id, safeErrorMessage(err));
    }
  }
}

function intervalMsForSettings(interval: 'hourly' | 'daily' | 'monthly' | 'disabled'): number | null {
  if (interval === 'hourly') return 60 * 60 * 1000;
  if (interval === 'daily') return 24 * 60 * 60 * 1000;
  // monthly handled by dedicated Berlin-calendar checker
  return null;
}

async function maybeEnqueueScheduledJob(): Promise<void> {
  try {
    const settings = await loadTimeTrackingSettings();
    const ms = intervalMsForSettings(settings.syncInterval);
    if (!ms) return;
    await enqueueJob(TIME_EXPORT_JOB_TYPE, { reason: 'schedule' }, { maxAttempts: 3 });
  } catch (err) {
    console.warn('[time-export] enqueue fehlgeschlagen:', safeErrorMessage(err));
  }
}

/** Monthly SharePoint sync — once per configured Berlin day/time (DB period lock). */
export async function maybeRunMonthlySharePointSync(force = false): Promise<{
  ran: boolean;
  exported: number;
  error?: string;
}> {
  if (monthlyLock && !force) return { ran: false, exported: 0 };
  monthlyLock = true;
  try {
    const settings = await loadTimeTrackingSettings();
    if (!force && !shouldRunMonthlySharePointSync(settings)) {
      return { ran: false, exported: 0 };
    }
    const period = monthlySyncPeriodKey(settings.monthlySharePointSync);
    try {
      const result = await syncTimeEntriesToGraph({ onlyUnsynced: true });
      await saveTimeTrackingSettings({
        monthlySharePointSync: {
          ...settings.monthlySharePointSync,
          lastRunAt: new Date().toISOString(),
          lastRunExported: result.added + result.updated,
          lastRunError: result.ok ? null : result.message,
          lastRunPeriodKey: period,
        },
      });
      console.info(
        `[time-export] Monthly SharePoint sync ${period}: +${result.added} ~${result.updated} (${result.message})`,
      );
      return { ran: true, exported: result.added + result.updated };
    } catch (err) {
      const message = safeErrorMessage(err);
      await saveTimeTrackingSettings({
        monthlySharePointSync: {
          ...settings.monthlySharePointSync,
          lastRunAt: new Date().toISOString(),
          lastRunExported: 0,
          lastRunError: message,
          lastRunPeriodKey: period,
        },
      });
      console.warn('[time-export] Monthly SharePoint sync failed:', message);
      return { ran: true, exported: 0, error: message };
    }
  } finally {
    monthlyLock = false;
  }
}

/** Startet Scheduler + Drain-Worker. */
export function startTimeExportScheduler(): void {
  if (started) return;
  started = true;

  void recoverOrphanedJobs('time-export', 15).catch(() => undefined);

  drainInterval = setInterval(() => {
    void drainTimeExportQueue().catch(() => undefined);
  }, 30_000);

  enqueueInterval = setInterval(() => {
    void (async () => {
      const settings = await loadTimeTrackingSettings();
      if (settings.syncInterval === 'disabled' || settings.syncInterval === 'monthly') return;
      if (settings.syncInterval === 'daily') {
        const hour = new Date().getUTCHours();
        if (hour !== 2) return;
      }
      await maybeEnqueueScheduledJob();
    })().catch(() => undefined);
  }, 60 * 60 * 1000);

  // Hourly check for monthly Berlin-calendar SharePoint sync
  monthlyCheckInterval = setInterval(() => {
    void maybeRunMonthlySharePointSync(false).catch(() => undefined);
  }, 60 * 60 * 1000);

  void maybeEnqueueScheduledJob();
  void drainTimeExportQueue().catch(() => undefined);
  void maybeRunMonthlySharePointSync(false).catch(() => undefined);

  console.info(
    '[time-export] Scheduler gestartet (Drain 30s, Config-Check stündlich, Monthly SharePoint stündlich).',
  );
}

export function stopTimeExportScheduler(): void {
  if (enqueueInterval) clearInterval(enqueueInterval);
  if (drainInterval) clearInterval(drainInterval);
  if (monthlyCheckInterval) clearInterval(monthlyCheckInterval);
  enqueueInterval = null;
  drainInterval = null;
  monthlyCheckInterval = null;
  started = false;
}

export { runTimeExportJob };
