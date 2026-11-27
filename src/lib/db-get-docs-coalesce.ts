/**
 * Stable key for identical concurrent get_docs requests.
 * Pure helper — safe to import from Node test runners (no DOM/localStorage).
 */
export function buildGetDocsCoalesceKey(
  collection: string,
  constraints: unknown[] | null | undefined,
): string {
  try {
    return JSON.stringify({
      collection: String(collection || ''),
      constraints: Array.isArray(constraints) ? constraints : [],
    });
  } catch {
    return `${collection}|${String(constraints)}`;
  }
}

/** Short-lived successful get_docs payload for mount coalescing. */
export type GetDocsCacheEntry = {
  result: unknown;
  expiresAtMs: number;
};

export function readGetDocsCacheEntry(
  entry: GetDocsCacheEntry | undefined,
  nowMs = Date.now(),
): unknown | undefined {
  if (!entry) return undefined;
  if (entry.expiresAtMs <= nowMs) return undefined;
  return entry.result;
}

export function buildGetDocsCacheEntry(
  result: unknown,
  ttlMs: number,
  nowMs = Date.now(),
): GetDocsCacheEntry {
  return { result, expiresAtMs: nowMs + Math.max(0, ttlMs) };
}
