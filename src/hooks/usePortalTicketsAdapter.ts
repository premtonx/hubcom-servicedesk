/**
 * Kunden-Portal tickets adapter — TicketsWorkbench ↔ portal ticket REST only.
 * Never calls staff DB routes or staff ticket clients.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientPortalApi } from '../services/clientPortalApi';
import type { TicketsWorkbenchAdapter } from '../lib/tickets/tickets-workbench-adapter';
import type { TicketPriority, TicketStatus } from '../types';

export function usePortalTicketsAdapter(): TicketsWorkbenchAdapter {
  const navigate = useNavigate();

  return useMemo(() => {
    const adapter: TicketsWorkbenchAdapter = {
      async listTickets(options) {
        const result = await clientPortalApi.listTickets({
          scope: options?.scope ?? 'all',
        });
        return {
          tickets: result.tickets,
          counts: result.counts,
        };
      },

      async updateTicketStatus(id, status: TicketStatus) {
        await clientPortalApi.updateTicketStatus(id, status);
      },

      async updateTicketPriority(id, priority: TicketPriority) {
        await clientPortalApi.updateTicketFields(id, { priority });
      },

      async updateTicketFields(id, patch) {
        const next: { status?: TicketStatus; priority?: TicketPriority } = {};
        if (patch.status != null) next.status = patch.status;
        if (patch.priority != null) next.priority = patch.priority;
        if (next.status == null && next.priority == null) return;
        await clientPortalApi.updateTicketFields(id, next);
      },

      openTicket(id: string) {
        navigate(`/portal/tickets/${id}`);
      },

      openCreateTicket() {
        navigate('/portal/tickets/new');
      },
    };
    return adapter;
  }, [navigate]);
}
