/**
 * Pure helpers for the frontend Mock DB Adapter retry / rate-limit policy.
 * Safe for Node isolation tests (no DOM / fetch).
 */

export const DB_ADAPTER_MAX_429_RETRIES = 2;
export const DB_ADAPTER_BASE_BACKOFF_MS = 1500;
export const DB_ADAPTER_MAX_BACKOFF_MS = 15_000;
export const GET_DOCS_RESPONSE_CACHE_TTL_MS = 2_000;

export type DbHttpStatusClass = 'ok' | 'auth' | 'rate_limit' | 'transient' | 'fatal';

/** Classify an HTTP status for retry decisions. Never retry 401/403. */
export function classifyDbHttpStatus(status: number): DbHttpStatusClass {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 502 || status === 503 || status === 504) return 'transient';
  return 'fatal';
}

/**
 * Parse Retry-After header (seconds or HTTP-date) into a delay in ms.
 * Returns null when absent / unparsable.
 */
export function parseRetryAfterMs(
  retryAfter: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (retryAfter == null) return null;
  const raw = String(retryAfter).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(DB_ADAPTER_MAX_BACKOFF_MS, Math.ceil(seconds * 1000));
  }
  const when = Date.parse(raw);
  if (!Number.isFinite(when)) return null;
  return Math.min(DB_ADAPTER_MAX_BACKOFF_MS, Math.max(0, when - nowMs));
}

/** Exponential backoff with full jitter, capped. attempt is 0-based. */
export function computeBackoffMs(
  attempt: number,
  opts?: { baseMs?: number; maxMs?: number; random?: () => number },
): number {
  const base = opts?.baseMs ?? DB_ADAPTER_BASE_BACKOFF_MS;
  const max = opts?.maxMs ?? DB_ADAPTER_MAX_BACKOFF_MS;
  const rnd = opts?.random ?? Math.random;
  const exp = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.floor(rnd() * (exp + 1));
}

export function resolveRateLimitWaitMs(params: {
  attempt: number;
  retryAfterHeader?: string | null;
  nowMs?: number;
  random?: () => number;
}): number {
  const fromHeader = parseRetryAfterMs(params.retryAfterHeader, params.nowMs);
  if (fromHeader != null && fromHeader > 0) return fromHeader;
  return computeBackoffMs(params.attempt, { random: params.random });
}

export type RateLimitCircuitState = {
  /** Epoch ms until which all /api/db calls should wait. */
  openUntilMs: number;
  consecutive429: number;
};

export function createRateLimitCircuit(): RateLimitCircuitState {
  return { openUntilMs: 0, consecutive429: 0 };
}

/** Record a 429 and open the shared circuit until wait elapses. */
export function tripRateLimitCircuit(
  state: RateLimitCircuitState,
  waitMs: number,
  nowMs = Date.now(),
): RateLimitCircuitState {
  const openUntilMs = Math.max(state.openUntilMs, nowMs + Math.max(0, waitMs));
  return {
    openUntilMs,
    consecutive429: state.consecutive429 + 1,
  };
}

export function clearRateLimitCircuit(state: RateLimitCircuitState): RateLimitCircuitState {
  return { openUntilMs: 0, consecutive429: 0 };
}

export function rateLimitCircuitWaitMs(
  state: RateLimitCircuitState,
  nowMs = Date.now(),
): number {
  return Math.max(0, state.openUntilMs - nowMs);
}

export function shouldRetryDbStatus(
  status: number,
  attemptIndex: number,
  max429Retries = DB_ADAPTER_MAX_429_RETRIES,
): boolean {
  const kind = classifyDbHttpStatus(status);
  if (kind === 'auth' || kind === 'fatal' || kind === 'ok') return false;
  if (kind === 'rate_limit') return attemptIndex < max429Retries;
  if (kind === 'transient') return attemptIndex < max429Retries;
  return false;
}
