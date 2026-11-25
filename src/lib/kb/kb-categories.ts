/**
 * Shared KB category helpers — slug ids, org-scoped portal ids, RBAC gates.
 */

export const KB_CATEGORIES_COLLECTION = 'kb_categories';
export const UNCATEGORIZED_CATEGORY_ID = 'uncategorized';

export type KbCategoryRecord = {
  id: string;
  name: string;
  desc?: string;
  owner?: string;
  subCategory?: string;
  iconName?: string;
  order?: number;
  organizationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export function slugifyCategoryName(name: string): string {
  return (
    String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || UNCATEGORIZED_CATEGORY_ID
  );
}

/** Portal category ids are org-prefixed so DPG/Citadelle never collide. */
export function portalCategoryId(organizationId: string, name: string): string {
  const slug = slugifyCategoryName(name);
  return `${String(organizationId).trim()}__${slug}`;
}

export function categoryOrganizationId(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const raw = row.organizationId ?? row.organization_id;
  const id = String(raw || '').trim();
  return id || null;
}

export function isOrgScopedCategory(row: Record<string, unknown> | null | undefined): boolean {
  return Boolean(categoryOrganizationId(row));
}

export function assertStaffKbCategoryWriteRole(role: string | null | undefined): boolean {
  const r = String(role || '').trim();
  return (
    r === 'SYSTEM_ADMIN' ||
    r === 'admin' ||
    r === 'AGENT' ||
    r === 'agent' ||
    r === 'TEAM_LEAD' ||
    r === 'team_lead'
  );
}

export function evaluatePortalKbCategoryWriteAccess(params: {
  role: string | null | undefined;
  sessionOrgId: string | null | undefined;
  targetOrgId?: string | null;
}): { ok: true } | { ok: false; status: 403 | 404 } {
  const role = String(params.role || '').trim();
  const sessionOrg = String(params.sessionOrgId || '').trim();
  if (!sessionOrg) return { ok: false, status: 403 };
  if (role === 'CLIENT_USER') return { ok: false, status: 403 };
  if (role !== 'CLIENT_ADMIN' && role !== 'CLIENT_SUPPORTER') {
    return { ok: false, status: 403 };
  }
  if (params.targetOrgId != null && String(params.targetOrgId).trim() !== sessionOrg) {
    return { ok: false, status: 404 };
  }
  return { ok: true };
}
