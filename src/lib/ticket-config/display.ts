import type { TicketPriorityConfig, TicketStatusConfig } from './types';

const FALLBACK_STATUS_COLOR = '#3B82F6';
const FALLBACK_PRIORITY_COLOR = '#94A3B8';

export function softTintStyles(hex: string): {
  backgroundColor: string;
  borderColor: string;
  color: string;
} {
  const color = hex && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? hex : FALLBACK_STATUS_COLOR;
  return {
    backgroundColor: `color-mix(in srgb, ${color} 14%, white)`,
    borderColor: `color-mix(in srgb, ${color} 32%, white)`,
    color,
  };
}

export function resolveStatusConfig(
  key: string | null | undefined,
  statuses: TicketStatusConfig[],
): { key: string; name: string; color: string; isActive: boolean; known: boolean } {
  const k = String(key || 'open').toLowerCase().trim() || 'open';
  const hit = statuses.find((s) => s.key.toLowerCase() === k);
  if (hit) {
    return {
      key: hit.key,
      name: hit.name,
      color: hit.color || FALLBACK_STATUS_COLOR,
      isActive: hit.isActive,
      known: true,
    };
  }
  return {
    key: k,
    name: k.replace(/_/g, ' '),
    color: FALLBACK_STATUS_COLOR,
    isActive: false,
    known: false,
  };
}

export function resolvePriorityConfig(
  key: string | null | undefined,
  priorities: TicketPriorityConfig[],
): { key: string; name: string; color: string; isActive: boolean; known: boolean } {
  const k = String(key || 'medium').toLowerCase().trim() || 'medium';
  const hit = priorities.find((p) => p.key.toLowerCase() === k);
  if (hit) {
    return {
      key: hit.key,
      name: hit.name,
      color: hit.color || FALLBACK_PRIORITY_COLOR,
      isActive: hit.isActive,
      known: true,
    };
  }
  return {
    key: k,
    name: k.replace(/_/g, ' '),
    color: FALLBACK_PRIORITY_COLOR,
    isActive: false,
    known: false,
  };
}

/** Dropdown options: active items + current value if it is inactive/unknown (so tickets stay editable). */
export function selectableStatusesForValue(
  currentKey: string | null | undefined,
  statuses: TicketStatusConfig[],
): TicketStatusConfig[] {
  const active = statuses.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const k = String(currentKey || '').toLowerCase().trim();
  if (!k) return active;
  if (active.some((s) => s.key.toLowerCase() === k)) return active;
  const orphan = statuses.find((s) => s.key.toLowerCase() === k);
  if (orphan) return [...active, orphan];
  return [
    ...active,
    {
      id: `orphan-${k}`,
      key: k,
      name: k.replace(/_/g, ' '),
      description: '',
      color: FALLBACK_STATUS_COLOR,
      sortOrder: 9999,
      isActive: false,
      workflowKind: 'open',
      createdAt: '',
      updatedAt: '',
    },
  ];
}

export function selectablePrioritiesForValue(
  currentKey: string | null | undefined,
  priorities: TicketPriorityConfig[],
): TicketPriorityConfig[] {
  const active = priorities.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const k = String(currentKey || '').toLowerCase().trim();
  if (!k) return active;
  if (active.some((p) => p.key.toLowerCase() === k)) return active;
  const orphan = priorities.find((p) => p.key.toLowerCase() === k);
  if (orphan) return [...active, orphan];
  return [
    ...active,
    {
      id: `orphan-${k}`,
      key: k,
      name: k.replace(/_/g, ' '),
      description: '',
      color: FALLBACK_PRIORITY_COLOR,
      sortOrder: 9999,
      isActive: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
}
