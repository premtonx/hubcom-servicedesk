/**
 * Kunden-Portal ticket detail adapter — TicketDetailWorkbench ↔ portal REST only.
 * Never calls staff DB routes or staff ticket clients.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientPortalApi } from '../services/clientPortalApi';
import type {
  PortalTicketDetailPayload,
  PortalTicketWorkspaceMeta,
  TicketDetailWorkbenchAdapter,
} from '../lib/tickets/ticket-detail-workbench-adapter';
import type { Ticket, TicketStatus } from '../types';

function emptyMeta(): PortalTicketWorkspaceMeta {
  return {
    agents: [],
    statuses: [],
    priorities: [],
    categories: [],
    ticket_types: [],
  };
}

function mapMeta(raw: any): PortalTicketWorkspaceMeta {
  if (!raw || typeof raw !== 'object') return emptyMeta();
  return {
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    statuses: Array.isArray(raw.statuses) ? raw.statuses : [],
    priorities: Array.isArray(raw.priorities) ? raw.priorities : [],
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    ticket_types: Array.isArray(raw.ticket_types) ? raw.ticket_types : [],
  };
}

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
        const payload: PortalTicketDetailPayload = {
          ticket: detail.ticket as Ticket,
          messages: detail.messages || [],
          participants: detail.participants || [],
          attachments: detail.attachments || [],
          members: mems || [],
          customer: detail.customer || null,
          verlauf: detail.verlauf || [],
          aiInsights: (detail.aiInsights as PortalTicketDetailPayload['aiInsights']) || null,
          assets: detail.assets || [],
          neuralLinks: detail.neuralLinks || [],
          tasks: detail.tasks || [],
          timeEntries: detail.timeEntries || [],
          timeSummary: detail.timeSummary || null,
          meta: mapMeta(detail.meta),
        };
        return payload;
      },

      async reply(ticketId, payload) {
        await clientPortalApi.reply(ticketId, payload);
      },

      async updateStatus(ticketId, status: TicketStatus) {
        return clientPortalApi.updateTicketStatus(ticketId, status);
      },

      async updateFields(ticketId, patch) {
        return clientPortalApi.updateTicketFields(ticketId, patch);
      },

      async aiSync(ticketId, opts) {
        const result = await clientPortalApi.aiSyncTicket(ticketId, opts);
        return {
          ticket: result.ticket,
          aiInsights: result.aiInsights as PortalTicketDetailPayload['aiInsights'],
        };
      },

      async addTask(ticketId, task) {
        return clientPortalApi.addTicketTask(ticketId, task);
      },

      async updateTask(ticketId, taskId, patch) {
        return clientPortalApi.updateTicketTask(ticketId, taskId, patch);
      },

      async deleteTask(ticketId, taskId) {
        return clientPortalApi.deleteTicketTask(ticketId, taskId);
      },

      async addTimeEntry(ticketId, payload) {
        const entry = await clientPortalApi.addTicketTimeEntry(ticketId, payload);
        return entry || {};
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

      openConvertToKb(ticket) {
        const q = new URLSearchParams({
          fromTicket: String(ticket.id || ''),
          subject: String(ticket.subject || ''),
        });
        navigate(`/portal/kb?${q.toString()}`);
      },
    };
    return adapter;
  }, [navigate, loadMembers]);
}
