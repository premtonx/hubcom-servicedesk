/**
 * Kunden-Portal ticket detail adapter — TicketDetailWorkbench ↔ portal REST only.
 * Never calls staff DB routes or staff ticket clients.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientPortalApi } from '../services/clientPortalApi';
import type { TicketDetailWorkbenchAdapter } from '../lib/tickets/ticket-detail-workbench-adapter';
import type { TicketStatus } from '../types';

export function usePortalTicketDetailAdapter(options?: {
  /** When true, load org members for Beteiligte picker. */
  loadMembers?: boolean;
}): TicketDetailWorkbenchAdapter {
  const navigate = useNavigate();
  const loadMembers = options?.loadMembers === true;

  return useMemo(() => {
    const adapter: TicketDetailWorkbenchAdapter = {
      async getDetail(ticketId: string) {
        const [detail, mems] = await Promise.all([
          clientPortalApi.getTicket(ticketId),
          loadMembers
            ? clientPortalApi.listMembers().catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!detail.ticket) {
          throw new Error('Ticket nicht gefunden oder kein Zugriff.');
        }
        return {
          ticket: detail.ticket,
          messages: detail.messages || [],
          participants: detail.participants || [],
          attachments: detail.attachments || [],
          members: mems || [],
        };
      },

      async reply(ticketId, payload) {
        await clientPortalApi.reply(ticketId, payload);
      },

      async updateStatus(ticketId, status: TicketStatus) {
        return clientPortalApi.updateTicketStatus(ticketId, status);
      },

      async addParticipant(ticketId, userId) {
        await clientPortalApi.addParticipant(ticketId, userId);
      },

      async removeParticipant(ticketId, userId) {
        await clientPortalApi.removeParticipant(ticketId, userId);
      },

      openBack() {
        navigate('/portal/tickets');
      },
    };
    return adapter;
  }, [navigate, loadMembers]);
}
