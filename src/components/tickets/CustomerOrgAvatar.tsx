/**
 * Compact customer/org logo avatar with initials fallback.
 * Used in ticket list KUNDE column, detail rail, header, and sidebar.
 */

import { cn, getInitials } from '../../lib/utils';
import { organizationInitials } from '../../lib/client-portal/org-branding';

export type CustomerOrgAvatarProps = {
  logoUrl?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const SIZE_CLASS = {
  sm: 'h-7 w-7 text-[9px]',
  md: 'h-8 w-8 text-[10px]',
  lg: 'h-10 w-10 text-xs',
} as const;

export function CustomerOrgAvatar({
  logoUrl,
  companyName,
  contactName,
  size = 'md',
  className,
}: CustomerOrgAvatarProps) {
  const label = String(companyName || contactName || '').trim();
  const initials = label
    ? organizationInitials(label) || getInitials(label) || 'K'
    : 'K';

  return (
    <div
      className={cn(
        'rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm',
        SIZE_CLASS[size],
        className,
      )}
      title={label || undefined}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="max-w-full max-h-full object-contain p-0.5" />
      ) : (
        <span className="font-black uppercase text-slate-600 tracking-tight">{initials}</span>
      )}
    </div>
  );
}

/** Resolve org logo from ticket + maps (staff RLS-scoped org list). */
export function resolveTicketOrgLogo(
  ticket: {
    organizationId?: string | null;
    organization_id?: string | null;
    companyId?: string | null;
    company?: string | null;
  },
  logoByOrgId?: Record<string, string | null>,
  logoByCompanyId?: Record<string, string | null>,
): string | null {
  const orgId = String(ticket.organizationId || ticket.organization_id || '').trim();
  if (orgId && logoByOrgId?.[orgId]) return logoByOrgId[orgId];
  const companyId = String(ticket.companyId || '').trim();
  if (companyId && logoByCompanyId?.[companyId]) return logoByCompanyId[companyId];
  return null;
}
