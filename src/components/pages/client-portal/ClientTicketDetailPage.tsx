/**
 * Thin portal shell — TicketDetailWorkbench owns the shared staff visual shell.
 * All I/O via usePortalTicketDetailAdapter → /api/portal/tickets* only.
 */

import { useParams } from 'react-router-dom';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { usePortalTicketDetailAdapter } from '../../../hooks/usePortalTicketDetailAdapter';
import { TicketDetailWorkbench } from '../../tickets/TicketDetailWorkbench';
import { PORTAL_TICKET_DETAIL_CAPABILITIES } from '../../../lib/tickets/ticket-detail-workbench-adapter';

export default function ClientTicketDetailPage() {
  const { ticketId = '' } = useParams();
  const { isOrgWide, isClientAdmin } = useClientPortalSession();
  const adapter = usePortalTicketDetailAdapter({ loadMembers: isOrgWide });

  const capabilities = {
    ...PORTAL_TICKET_DETAIL_CAPABILITIES,
    canManageParticipants: isOrgWide,
    canMarkClosed: isClientAdmin || isOrgWide,
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      <TicketDetailWorkbench
        mode="portal"
        adapter={adapter}
        capabilities={capabilities}
        ticketId={ticketId}
      />
    </div>
  );
}
