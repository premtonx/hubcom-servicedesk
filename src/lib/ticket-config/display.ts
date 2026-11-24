import type { TicketCategory } from '../ticket-categories/types';
import type { TicketPriorityConfig, TicketStatusConfig, TicketTypeConfig } from './types';

const FALLBACK_STATUS_COLOR = '#3B82F6';
const FALLBACK_PRIORITY_COLOR = '#94A3B8';
const FALLBACK_TYPE_COLOR = '#3B82F6';
export const FALLBACK_CATEGORY_COLOR = '#1B6CA8';

/** Prefer live Ticket Configuration name/colour by id (then name), not stale ticket fields. */
export function resolveCategoryConfig(
  categoryId: string | null | undefined,
  categoryName: string | null | undefined,
  categories: TicketCategory[],
): { id: string | null; name: string; color: string; isActive: boolean; known: boolean } {
  const id = categoryId ? String(categoryId) : '';
  if (id) {
    const byId = categories.find((c) => c.id === id);
    if (byId) {
      return {
        id: byId.id,
        name: byId.name,
        color: byId.color || FALLBACK_CATEGORY_COLOR,
        isActive: byId.isActive !== false,
        known: true,
      };
    }
  }
  const nameHint = categoryName ? String(categoryName).trim() : '';
  if (nameHint) {
    const byName = categories.find(
      (c) => c.name.toLowerCase() === nameHint.toLowerCase(),
    );
    if (byName) {
      return {
        id: byName.id,
        name: byName.name,
        color: byName.color || FALLBACK_CATEGORY_COLOR,
        isActive: byName.isActive !== false,
        known: true,
      };
    }
    return {
      id: id || null,
      name: nameHint,
      color: FALLBACK_CATEGORY_COLOR,
      isActive: false,
      known: false,
    };
  }
  return {
    id: null,
    name: '',
    color: FALLBACK_CATEGORY_COLOR,
    isActive: true,
    known: false,
  };
}

/** Active categories for pickers, plus the current value if it is inactive/unknown. */
export function selectableCategoriesForValue(
  categoryId: string | null | undefined,
  categories: TicketCategory[],
): TicketCategory[] {
  const active = categories
    .filter((c) => c.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
  const id = categoryId ? String(categoryId) : '';
  if (!id) return active;
  if (active.some((c) => c.id === id)) return active;
  const orphan = categories.find((c) => c.id === id);
  return orphan ? [...active, orphan] : active;
}

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

export function resolveTypeConfig(
  key: string | null | undefined,
  types: TicketTypeConfig[],
): { key: string; name: string; color: string; isActive: boolean; known: boolean } {
  const k = String(key || 'question').toLowerCase().trim() || 'question';
  const hit = types.find((t) => t.key.toLowerCase() === k);
  if (hit) {
    return {
      key: hit.key,
      name: hit.name,
      color: hit.color || FALLBACK_TYPE_COLOR,
      isActive: hit.isActive,
      known: true,
    };
  }
  return {
    key: k,
    name: k.replace(/_/g, ' '),
    color: FALLBACK_TYPE_COLOR,
    isActive: false,
    known: false,
  };
}

/** Dropdown options for create/edit: active types + current orphan when editing. */
export function selectableTypesForValue(
  currentKey: string | null | undefined,
  types: TicketTypeConfig[],
): TicketTypeConfig[] {
  const active = types.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const k = String(currentKey || '').toLowerCase().trim();
  if (!k) return active;
  if (active.some((t) => t.key.toLowerCase() === k)) return active;
  const orphan = types.find((t) => t.key.toLowerCase() === k);
  if (orphan) return [...active, orphan];
  return [
    ...active,
    {
      id: `orphan-${k}`,
      key: k,
      name: k.replace(/_/g, ' '),
      description: '',
      color: FALLBACK_TYPE_COLOR,
      sortOrder: 9999,
      isActive: false,
      createdAt: '',
      updatedAt: '',
    },
  ];
}
