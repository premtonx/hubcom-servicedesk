/**
 * Kunden-Portal Tickets (`/portal/tickets`).
 * Shared TicketsWorkbench + portal adapter (/api/portal/tickets* only).
 */
import { TicketsWorkbench } from '../../tickets/TicketsWorkbench';
import { PORTAL_TICKETS_CAPABILITIES } from '../../../lib/tickets/tickets-workbench-adapter';
import { usePortalTicketsAdapter } from '../../../hooks/usePortalTicketsAdapter';

export default function ClientTicketsPage() {
  const portalAdapter = usePortalTicketsAdapter();

  return (
    <TicketsWorkbench
      mode="portal"
      adapter={portalAdapter}
      capabilities={PORTAL_TICKETS_CAPABILITIES}
    />
  );
}
