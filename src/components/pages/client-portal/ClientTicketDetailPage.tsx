/**
 * Thin portal shell — mounts the exact staff TicketDetailView +
 * TicketDetailContextPane via PortalTicketStaffDetailHost.
 * All I/O via portal ticket REST only (never staff DB routes).
 */

import { useParams } from 'react-router-dom';
import { PortalTicketStaffDetailHost } from '../../tickets/PortalTicketStaffDetailHost';

export default function ClientTicketDetailPage() {
  const { ticketId = '' } = useParams();

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <PortalTicketStaffDetailHost ticketId={ticketId} />
    </div>
  );
}
