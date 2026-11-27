import { BrainCircuit, Mail, Palette, Users, type LucideIcon } from 'lucide-react';
import ClientBrandingPage from '../client-portal/ClientBrandingPage';
import ClientMembersPage from '../client-portal/ClientMembersPage';
import ClientEmailIntegrationPage from '../client-portal/ClientEmailIntegrationPage';
import { MandantenKiRagCard } from '../../client-portal/MandantenKiRagCard';

export type CompanyPortalSegment = 'branding' | 'members' | 'email' | 'ai';

export const COMPANY_PORTAL_SEGMENTS: Array<{
  id: CompanyPortalSegment;
  label: string;
  icon: LucideIcon;
}> = [
  { id: 'branding', label: 'Branding & Module', icon: Palette },
  { id: 'members', label: 'Mitarbeiter & Rollen', icon: Users },
  { id: 'email', label: 'E-Mail, M365 & SSO', icon: Mail },
  { id: 'ai', label: 'KI & Lokaler Server', icon: BrainCircuit },
];

interface CompanyPortalTabProps {
  organizationId: string | null | undefined;
  companyName: string;
  /** Which portal settings panel to render (top-level customer detail tab). */
  segment: CompanyPortalSegment;
  onOpenEmailConfig?: () => void;
  /** When true, open Mitarbeiter invite dialog. */
  focusInvite?: boolean;
}

/**
 * Admin Kunden-Portal panel — mounts the shared portal settings page for one
 * segment with mode=admin + organizationId (no nested sub-tab chrome).
 */
export default function CompanyPortalTab({
  organizationId,
  companyName,
  segment,
  focusInvite,
}: CompanyPortalTabProps) {
  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-dashed border-muted-foreground/20 bg-muted/20 p-10 text-center text-sm text-muted-foreground font-semibold">
        Keine Organisation mit diesem Unternehmen verknüpft. Portal-Einstellungen sind erst nach
        Verknüpfung verfügbar.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-sm">
      {segment === 'branding' ? (
        <ClientBrandingPage
          mode="admin"
          organizationId={organizationId}
          includeAi={false}
          showHardwareModule
          embedded
        />
      ) : null}
      {segment === 'members' ? (
        <ClientMembersPage
          mode="admin"
          organizationId={organizationId}
          embedded
          focusInvite={focusInvite}
        />
      ) : null}
      {segment === 'email' ? (
        <ClientEmailIntegrationPage
          mode="admin"
          organizationId={organizationId}
          embedded
        />
      ) : null}
      {segment === 'ai' ? (
        <MandantenKiRagCard
          mode="admin"
          organizationId={organizationId}
          organizationName={companyName}
        />
      ) : null}
    </div>
  );
}
