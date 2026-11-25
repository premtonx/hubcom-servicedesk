/**
 * Pure helpers for Rücklieferungen Liste | Kanban | Karten layouts.
 */

export const DEFAULT_RETURN_STATUSES = [
  'Neu',
  'Warten auf Third Level',
  'In Bearbeitung',
  'Geschlossen',
] as const;

export type ReturnsLayoutItemLike = {
  hardwareReturn: { status?: string | null };
};

/**
 * Build Kanban columns from the org status catalog plus any orphan statuses
 * present in the current result set (custom admin-added labels stay visible).
 */
export function buildReturnsStatusColumns(
  catalogStatuses: string[],
  items: ReturnsLayoutItemLike[],
): string[] {
  const base =
    catalogStatuses.length > 0 ? [...catalogStatuses] : [...DEFAULT_RETURN_STATUSES];
  const seen = new Set(base.map((s) => s.toLowerCase()));
  for (const it of items) {
    const label = String(it.hardwareReturn?.status || 'Neu').trim() || 'Neu';
    if (!seen.has(label.toLowerCase())) {
      seen.add(label.toLowerCase());
      base.push(label);
    }
  }
  return base;
}

/** Resolve which column a return belongs to (case-insensitive catalog match). */
export function resolveReturnsStatusColumn(
  status: string | null | undefined,
  columns: string[],
): string {
  const label = String(status || 'Neu').trim() || 'Neu';
  return columns.find((c) => c.toLowerCase() === label.toLowerCase()) || columns[0] || 'Neu';
}
