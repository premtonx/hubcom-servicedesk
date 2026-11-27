import { useEffect, useState } from 'react';
import { BrainCircuit, Mail, Palette, Users } from 'lucide-react';
import { cn } from '../../../lib/utils';
import ClientBrandingPage from '../client-portal/ClientBrandingPage';
import ClientMembersPage from '../client-portal/ClientMembersPage';
import ClientEmailIntegrationPage from '../client-portal/ClientEmailIntegrationPage';
import { MandantenKiRagCard } from '../../client-portal/MandantenKiRagCard';

type PortalSegment = 'branding' | 'members' | 'email' | 'ai';

interface CompanyPortalTabProps {
  organizationId: string | null | undefined;
  companyName: string;
  onOpenEmailConfig?: () => void;
  /** When true, open Mitarbeiter invite dialog. */
  focusInvite?: boolean;
  /** Optional initial segment (e.g. branding quick action). */
  initialSegment?: PortalSegment;
}

const SEGMENTS: Array<{
  id: PortalSegment;
  label: string;
  icon: typeof Palette;
}> = [
  { id: 'branding', label: 'Branding & Module', icon: Palette },
  { id: 'members', label: 'Mitarbeiter & Rollen', icon: Users },
  { id: 'email', label: 'E-Mail, M365 & SSO', icon: Mail },
  { id: 'ai', label: 'KI & Lokaler Server', icon: BrainCircuit },
];

/**
 * Admin Kunden-Portal cockpit — mounts the exact shared portal settings pages
 * with mode=admin + organizationId (apiBase → /api/admin/organizations/:id/…).
 */
export default function CompanyPortalTab({
  organizationId,
  companyName,
  focusInvite,
  initialSegment = 'branding',
}: CompanyPortalTabProps) {
  const [segment, setSegment] = useState<PortalSegment>(
    focusInvite ? 'members' : initialSegment,
  );

  useEffect(() => {
    if (focusInvite) setSegment('members');
  }, [focusInvite]);

  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-dashed border-muted-foreground/20 bg-muted/20 p-10 text-center text-sm text-muted-foreground font-semibold">
        Keine Organisation mit diesem Unternehmen verknüpft. Portal-Einstellungen sind erst nach
        Verknüpfung verfügbar.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-black tracking-tight text-foreground">
            Kunden-Portal — {companyName}
          </h3>
          <p className="text-xs text-muted-foreground font-medium mt-0.5">
            1:1 dieselben Einstellungen wie im Kunden-Portal (Branding, Team, E-Mail/SSO, Mandanten-KI).
          </p>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-muted/50 border border-muted-foreground/10"
        role="tablist"
        aria-label="Kunden-Portal Bereiche"
      >
        {SEGMENTS.map((s) => {
          const Icon = s.icon;
          const active = segment === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSegment(s.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer',
                active
                  ? 'bg-background text-foreground shadow-sm border border-muted-foreground/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/60',
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-muted-foreground/10 bg-background p-4 sm:p-5">
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
    </div>
  );
}
