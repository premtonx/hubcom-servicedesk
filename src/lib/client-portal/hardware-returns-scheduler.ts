/**
 * Hourly hardware-returns auto-reminder scheduler (idempotent).
 */

import { runHardwareReturnsAutoSendPass } from './hardware-returns-escalation.js';

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runHardwareReturnsAutoSendPass(new Date());
    if (result.sent > 0 || result.considered > 0) {
      console.info(
        `[hardware-returns] auto-send pass: considered=${result.considered} sent=${result.sent} skipped=${result.skipped}`,
      );
    }
  } catch (err: any) {
    console.warn('[hardware-returns] auto-send pass failed:', err?.message || err);
  } finally {
    running = false;
  }
}

/** Start hourly evaluation of due Mail 1/2/3 reminders. */
export function startHardwareReturnsScheduler(intervalMs = 60 * 60 * 1000): void {
  if (started) return;
  started = true;
  const ms = Math.max(60_000, intervalMs);
  timer = setInterval(() => {
    void tick();
  }, ms);
  // Soft delay so boot doesn't contend with DB init.
  setTimeout(() => void tick(), 15_000);
  console.info(`[hardware-returns] scheduler started (interval=${ms}ms)`);
}

export function stopHardwareReturnsScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  running = false;
}
