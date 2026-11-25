/**
 * Staff tickets adapter — navigation + mutations for TicketsWorkbench.
 * Data subscription stays in TicketsPage (ticketService); this adapter
 * injects open/create/update callbacks so the workbench never imports staff APIs.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ticketService } from '../services/ticketService';
import type { TicketsWorkbenchAdapter } from '../lib/tickets/tickets-workbench-adapter';
import type { Ticket, TicketPriority, TicketStatus } from '../types';

export type StaffTicketsAdapterOptions = {
  /** When set, openTicket delegates here (detail shell in TicketsPage). */
  onOpenTicket?: (id: string) => void;
  onOpenCreateTicket?: () => void;
  /** Optional local optimistic patch after successful update. */
  onTicketPatched?: (id: string, patch: Partial<Ticket>) => void;
};

export function useStaffTicketsAdapter(
  options: StaffTicketsAdapterOptions = {},
): TicketsWorkbenchAdapter {
  const navigate = useNavigate();
  const { onOpenTicket, onOpenCreateTicket, onTicketPatched } = options;

  return useMemo(() => {
    const adapter: TicketsWorkbenchAdapter = {
      async listTickets() {
        // Staff list is push-subscribed in TicketsPage; adapter list is unused there.
        return { tickets: [] };
      },

      async updateTicketStatus(id, status: TicketStatus) {
        await ticketService.updateTicket(id, { status });
        onTicketPatched?.(id, { status });
      },

      async updateTicketPriority(id, priority: TicketPriority) {
        await ticketService.updateTicket(id, { priority });
        onTicketPatched?.(id, { priority });
      },

      async updateTicketFields(id, patch) {
        await ticketService.updateTicket(id, patch);
        onTicketPatched?.(id, patch);
      },

      openTicket(id: string) {
        if (onOpenTicket) {
          onOpenTicket(id);
          return;
        }
        navigate(`/tickets/${id}`);
      },

      openCreateTicket() {
        if (onOpenCreateTicket) {
          onOpenCreateTicket();
          return;
        }
        navigate('/tickets?create=1');
      },
    };
    return adapter;
  }, [navigate, onOpenTicket, onOpenCreateTicket, onTicketPatched]);
}
