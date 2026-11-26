/**
 * Thin portal shell — TicketDetailWorkbench owns the shared staff visual shell.
 * All I/O via usePortalTicketDetailAdapter → /api/portal/tickets* only.
 */

import { useParams } from 'react-router-dom';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { usePortalTicketDetailAdapter } from '../../../hooks/usePortalTicketDetailAdapter';
import { TicketDetailWorkbench } from '../../tickets/TicketDetailWorkbench';
import {
  PORTAL_TICKET_DETAIL_CAPABILITIES,
  PORTAL_TICKET_DETAIL_CAPABILITIES_CLIENT_USER,
} from '../../../lib/tickets/ticket-detail-workbench-adapter';

export default function ClientTicketDetailPage() {
  const { ticketId = '' } = useParams();
  const { isOrgWide, isClientAdmin, session } = useClientPortalSession();
  const adapter = usePortalTicketDetailAdapter({ loadMembers: isOrgWide });

  const isClientUser = String(session?.role || '') === 'CLIENT_USER';

  const capabilities = isClientUser
    ? {
        ...PORTAL_TICKET_DETAIL_CAPABILITIES_CLIENT_USER,
        canManageParticipants: false,
        canMarkClosed: false,
      }
    : {
        ...PORTAL_TICKET_DETAIL_CAPABILITIES,
        canManageParticipants: isOrgWide,
        canMarkClosed: isClientAdmin || isOrgWide,
        canEditAssignee: isOrgWide,
        canEditProperties: isOrgWide,
        canUpdatePriority: isOrgWide,
        internalNotes: isOrgWide,
        aiSync: isOrgWide,
        convertToKb: isOrgWide,
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
