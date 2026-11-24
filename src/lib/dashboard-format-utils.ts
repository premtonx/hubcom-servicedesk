/** German-first formatting helpers for staff & portal dashboards. */

export const DASHBOARD_PRIORITY_LABELS: Record<string, string> = {
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  urgent: 'Dringend',
  critical: 'Dringend',
};

export function dashboardPriorityLabel(priority: string | null | undefined): string {
  const key = String(priority || 'medium').toLowerCase().trim();
  return DASHBOARD_PRIORITY_LABELS[key] || 'Mittel';
}

/** Relative German timestamps: „vor 1 Std.“, „Gestern“, „vor 3 Tg.“ */
export function formatRelativeTime(iso: string, locale: 'de' | 'en' = 'de'): string {
  const ts = new Date(iso).getTime();
  if (!ts || Number.isNaN(ts)) return '—';
  const diffMs = Date.now() - ts;
  const mins = Math.floor(diffMs / 60000);

  if (locale === 'en') {
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  if (mins < 1) return 'Gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return 'vor 1 Std.';
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Gestern';
  if (days < 7) return `vor ${days} Tg.`;
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTrendBadge(
  value: number | null,
  invert = false,
): { label: string; className: string } | null {
  if (value === null || Number.isNaN(value)) return null;
  const effective = invert ? -value : value;
  if (effective > 0) {
    return { label: `↗ ${Math.abs(value)}%`, className: 'text-[#137333]' };
  }
  if (effective < 0) {
    return { label: `↘ ${Math.abs(value)}%`, className: 'text-[#D93025]' };
  }
  return { label: '— 0%', className: 'text-[#80868B]' };
}

/** Short readable ticket number — prefer customId (#NEX-0003), never raw UUID. */
export function dashboardTicketNumber(ticket: {
  id: string;
  customId?: string | null;
}): string {
  const custom = String(ticket.customId || '')
    .trim()
    .replace(/^#/, '');
  if (custom) return `#${custom}`;
  const id = String(ticket.id || '');
  // UUID-like → last 4 digits/chars as numeric-looking fallback
  if (/^[0-9a-f-]{20,}$/i.test(id)) {
    const digits = id.replace(/\D/g, '').slice(-4);
    return digits ? `#${digits.padStart(4, '0')}` : `#${id.slice(-4).toUpperCase()}`;
  }
  return `#${id.slice(-6).toUpperCase()}`;
}

export function organizationInitialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'K';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
