/**
 * German labels + session helpers for Mitarbeiter & Berechtigungen UI.
 */

import {
  canManageHubcomCore,
  normalizeHubcomMatrixRole,
  type HubcomMatrixRole,
  type OrgAccessRole,
} from './staff-org-access-shared';

export type StaffSessionAccess = {
  canManageHubcomCore: boolean;
  accessibleOrganizationIds: 'ALL' | string[];
  organizationAccess: Array<{ organization_id: string; access_role: string }>;
};

export const HUBCOM_ROLE_OPTIONS: Array<{
  value: HubcomMatrixRole;
  label: string;
  description: string;
}> = [
  {
    value: 'SUPER_ADMIN',
    label: 'Systemhaus Voll-Admin',
    description: 'Vollzugriff auf Hubcom und automatisch alle Kundenunternehmen',
  },
  {
    value: 'HUBCOM_ADMIN',
    label: 'Hubcom Admin',
    description: 'Verwaltet Hubcom selbst; Kundenunternehmen nur gemäß Auswahl unten',
  },
  {
    value: 'HUBCOM_AGENT',
    label: 'Hubcom Agent / Techniker',
    description: 'Bearbeitet interne Hubcom-Tickets; Kundenunternehmen nur gemäß Auswahl unten',
  },
  {
    value: 'HUBCOM_USER',
    label: 'Hubcom Benutzer',
    description:
      'Sieht/erstellt nur eigene interne Hubcom-Tickets; Kundenunternehmen nur gemäß Auswahl unten',
  },
];

export type CompanyAccessChoice = 'none' | OrgAccessRole;

export const COMPANY_ACCESS_OPTIONS: Array<{
  value: CompanyAccessChoice;
  label: string;
  description: string;
}> = [
  {
    value: 'none',
    label: 'Kein Zugriff',
    description: 'Firma für diesen Kollegen komplett unsichtbar',
  },
  {
    value: 'ORG_AGENT',
    label: 'Agent / Bearbeiter',
    description: 'Tickets & Rücklieferungen bearbeiten',
  },
  {
    value: 'ORG_ADMIN',
    label: 'Kunden-Admin',
    description: 'Vollzugriff inkl. Kunden-Portal-Einstellungen',
  },
];

export function hubcomRoleLabelDe(role: string | null | undefined): string {
  const matrix = normalizeHubcomMatrixRole(role);
  return HUBCOM_ROLE_OPTIONS.find((o) => o.value === matrix)?.label || String(role || '—');
}

export function orgAccessLabelDe(role: string | null | undefined): string {
  if (role === 'ORG_ADMIN') return 'Kunden-Admin';
  if (role === 'ORG_AGENT') return 'Agent';
  return 'Kein Zugriff';
}

export function hubcomRolePillClass(role: string | null | undefined): string {
  const matrix = normalizeHubcomMatrixRole(role);
  switch (matrix) {
    case 'SUPER_ADMIN':
      return 'bg-indigo-50 text-indigo-800 border-indigo-100';
    case 'HUBCOM_ADMIN':
      return 'bg-violet-50 text-violet-800 border-violet-100';
    case 'HUBCOM_AGENT':
      return 'bg-sky-50 text-sky-800 border-sky-100';
    case 'HUBCOM_USER':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

export function orgAccessPillClass(role: string | null | undefined): string {
  if (role === 'ORG_ADMIN') return 'bg-emerald-50 text-emerald-800 border-emerald-100';
  if (role === 'ORG_AGENT') return 'bg-amber-50 text-amber-800 border-amber-100';
  return 'bg-slate-100 text-slate-500 border-slate-200';
}

export function sessionCanManageHubcomCore(user: {
  role?: string | null;
  is_admin?: boolean;
  staffAccess?: StaffSessionAccess | null;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.staffAccess?.canManageHubcomCore === true) return true;
  return canManageHubcomCore(user);
}

export function sessionIsSuperAdmin(user: {
  role?: string | null;
  is_admin?: boolean;
} | null | undefined): boolean {
  return normalizeHubcomMatrixRole(user?.role, user?.is_admin === true) === 'SUPER_ADMIN';
}

/** Hide Mail / Kern-KI / Mitarbeiter for agent-level Hubcom roles. */
export function sessionSeesHubcomCoreSections(user: {
  role?: string | null;
  is_admin?: boolean;
  staffAccess?: StaffSessionAccess | null;
} | null | undefined): boolean {
  return sessionCanManageHubcomCore(user);
}

export function sessionCanManageOrgPortal(
  user: {
    role?: string | null;
    is_admin?: boolean;
    staffAccess?: StaffSessionAccess | null;
  } | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!user || !organizationId) return false;
  if (sessionIsSuperAdmin(user)) return true;
  const row = user.staffAccess?.organizationAccess?.find(
    (a) => a.organization_id === organizationId,
  );
  return row?.access_role === 'ORG_ADMIN';
}

export function sessionCanAccessOrg(
  user: {
    role?: string | null;
    is_admin?: boolean;
    staffAccess?: StaffSessionAccess | null;
  } | null | undefined,
  organizationId: string | null | undefined,
): boolean {
  if (!user || !organizationId) return false;
  if (sessionIsSuperAdmin(user)) return true;
  const accessible = user.staffAccess?.accessibleOrganizationIds;
  if (accessible === 'ALL') return true;
  if (Array.isArray(accessible)) return accessible.includes(organizationId);
  return (
    user.staffAccess?.organizationAccess?.some((a) => a.organization_id === organizationId) ===
    true
  );
}

export function summarizeStaffScopePills(params: {
  role: string;
  organization_access: Array<{ organization_id: string; access_role: string }>;
  orgNameById: Map<string, string>;
}): Array<{ key: string; label: string; className: string }> {
  const role = normalizeHubcomMatrixRole(params.role);
  if (role === 'SUPER_ADMIN') {
    return [
      {
        key: 'super',
        label: 'Systemhaus Voll-Admin · Alle Unternehmen',
        className: hubcomRolePillClass('SUPER_ADMIN'),
      },
    ];
  }
  const pills: Array<{ key: string; label: string; className: string }> = [
    {
      key: 'hubcom',
      label: hubcomRoleLabelDe(role),
      className: hubcomRolePillClass(role),
    },
  ];
  for (const a of params.organization_access) {
    const name = params.orgNameById.get(a.organization_id) || a.organization_id.slice(0, 8);
    pills.push({
      key: a.organization_id,
      label: `${name} (${orgAccessLabelDe(a.access_role)})`,
      className: orgAccessPillClass(a.access_role),
    });
  }
  return pills;
}
