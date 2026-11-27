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
