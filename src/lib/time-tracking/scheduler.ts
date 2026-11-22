/**
 * Hintergrund-Job für Zeiterfassung:
 * - erzeugt lokale Gesamt-Excel
 * - synct optional nach Microsoft Graph
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
import { loadTimeTrackingSettings } from './settings.js';
import { listAllTimeEntries } from './store.js';

export const TIME_EXPORT_JOB_TYPE: BackgroundJobType = 'TIME_EXPORT_SYNC';

let enqueueInterval: ReturnType<typeof setInterval> | null = null;
let drainInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

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

function intervalMsForSettings(interval: 'hourly' | 'daily' | 'disabled'): number | null {
  if (interval === 'hourly') return 60 * 60 * 1000;
  if (interval === 'daily') return 24 * 60 * 60 * 1000;
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

/** Startet Scheduler + Drain-Worker. */
export function startTimeExportScheduler(): void {
  if (started) return;
  started = true;

  void recoverOrphanedJobs([TIME_EXPORT_JOB_TYPE], 15).catch(() => undefined);

  // Drain alle 30s
  drainInterval = setInterval(() => {
    void drainTimeExportQueue().catch(() => undefined);
  }, 30_000);

  // Periodisches Enqueue gemäß Admin-Einstellung (prüft stündlich die Config)
  enqueueInterval = setInterval(() => {
    void (async () => {
      const settings = await loadTimeTrackingSettings();
      if (settings.syncInterval === 'disabled') return;
      // daily: nur einmal pro Tag um ~02:00 UTC enqueuen
      if (settings.syncInterval === 'daily') {
        const hour = new Date().getUTCHours();
        if (hour !== 2) return;
      }
      await maybeEnqueueScheduledJob();
    })().catch(() => undefined);
  }, 60 * 60 * 1000);

  // Sofort einmal prüfen
  void maybeEnqueueScheduledJob();
  void drainTimeExportQueue().catch(() => undefined);

  console.info('[time-export] Scheduler gestartet (Drain 30s, Config-Check stündlich).');
}

export function stopTimeExportScheduler(): void {
  if (enqueueInterval) clearInterval(enqueueInterval);
  if (drainInterval) clearInterval(drainInterval);
  enqueueInterval = null;
  drainInterval = null;
  started = false;
}

export { runTimeExportJob };
