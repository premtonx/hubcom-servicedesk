/**
 * Pure date helpers for Hardware-Rücklieferungen (safe in Node + browser).
 * node-postgres returns PostgreSQL DATE as JS `Date` — never `String(date).slice(0, 10)`.
 */

/**
 * Normalize DATE / date-like inputs to `YYYY-MM-DD`, or `null` when empty/invalid.
 */
export function toIsoDateOnly(val: unknown): string | null {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    // pg DATE values are typically midnight UTC; use UTC calendar parts.
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const mo = Number(m[2]);
    const day = Number(m[3]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  // Reject locale strings like "Fri Nov 20" / "Thu Dec 03".
  return null;
}

/** Display a date-only value as German `DD.MM.YYYY` (never "Fri Nov 20"). */
export function formatDateDeOnly(val: unknown): string {
  const iso = toIsoDateOnly(val);
  if (iso) {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }
  if (val == null || val === '') return '—';
  const d = val instanceof Date ? val : new Date(String(val));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
