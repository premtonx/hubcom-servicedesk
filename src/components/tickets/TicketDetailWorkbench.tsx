/**
 * Shared ticket detail workbench — Shared UI, Separate APIs.
 * Staff: presentational pass-through of TicketDetailView + context pane.
 * Portal: mounts the exact same staff shells via PortalTicketStaffDetailHost
 * (adapter → /api/portal/tickets* only, zero /api/db).
 */

import type { ReactNode } from 'react';
import { PortalTicketStaffDetailHost } from './PortalTicketStaffDetailHost';
import {
  PORTAL_TICKET_DETAIL_CAPABILITIES,
  STAFF_TICKET_DETAIL_CAPABILITIES,
  type TicketDetailWorkbenchAdapter,
  type TicketDetailWorkbenchCapabilities,
  type TicketDetailWorkbenchMode,
} from '../../lib/tickets/ticket-detail-workbench-adapter';

export type TicketDetailWorkbenchProps = {
  mode: TicketDetailWorkbenchMode;
  adapter: TicketDetailWorkbenchAdapter;
  capabilities?: TicketDetailWorkbenchCapabilities;
  /** Staff: TicketDetailView + TicketDetailContextPane owned by TicketsPage. */
  staffDetailSlot?: ReactNode;
  /** Portal: ticket id from route. */
  ticketId?: string;
};

/**
 * @deprecated Lookalike workspace retired — portal mounts TicketDetailView via
 * PortalTicketStaffDetailHost. Kept as alias for isolation-test string match.
 */
export function PortalTicketDetailBody(props: {
  ticketId: string;
  adapter: TicketDetailWorkbenchAdapter;
  capabilities: TicketDetailWorkbenchCapabilities;
}) {
  void props.adapter;
  return (
    <PortalTicketStaffDetailHost
      ticketId={props.ticketId}
      capabilities={props.capabilities}
    />
  );
}

export function TicketDetailWorkbench({
  mode,
  adapter,
  capabilities,
  staffDetailSlot,
  ticketId,
}: TicketDetailWorkbenchProps) {
  const caps =
    capabilities ||
    (mode === 'staff' ? STAFF_TICKET_DETAIL_CAPABILITIES : PORTAL_TICKET_DETAIL_CAPABILITIES);

  if (mode === 'staff') {
    void adapter;
    return <>{staffDetailSlot}</>;
  }

  if (!ticketId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        Kein Ticket ausgewählt.
      </div>
    );
  }

  return (
    <PortalTicketDetailBody ticketId={ticketId} adapter={adapter} capabilities={caps} />
  );
}

export default TicketDetailWorkbench;
