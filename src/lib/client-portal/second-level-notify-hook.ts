/**
 * Fire-and-forget 2nd-Level notify after a ticket PATCH transition.
 * Never throws — mail failure must not fail the PATCH response.
 */

import { getOrganization } from './organizations.js';
import {
  evaluateSecondLevelNotifyTrigger,
  resolveSecondLevelNotifySettings,
  sendSecondLevelAssignmentNotification,
  type TicketActivityEntry,
} from './second-level-notify.js';
import { updateDocDirect } from '../postgres-backend.js';
import { safeLog } from '../safe-log.js';
import { ticketOrganizationId } from './ticket-visibility.js';

export async function maybeNotifySecondLevelAfterTicketPatch(params: {
  previousTicket: Record<string, unknown>;
  nextTicket: Record<string, unknown>;
  ticketId: string;
  assignedByName: string;
  organizationId?: string | null;
}): Promise<{
  notified: boolean;
  activityLog?: TicketActivityEntry[];
  reason?: string;
}> {
  try {
    const orgId =
      (params.organizationId || '').trim() ||
      ticketOrganizationId(params.nextTicket) ||
      ticketOrganizationId(params.previousTicket) ||
      null;
    if (!orgId) {
      return { notified: false, reason: 'no_organization' };
    }

    const org = await getOrganization(orgId);
    if (!org) return { notified: false, reason: 'org_missing' };

    const settings = resolveSecondLevelNotifySettings(org);
    const decision = evaluateSecondLevelNotifyTrigger({
      previousTicket: params.previousTicket,
      nextTicket: params.nextTicket,
      settings,
    });
    if (decision.shouldSend === false) {
      return { notified: false, reason: decision.reason };
    }

    const sendResult = await sendSecondLevelAssignmentNotification({
      organization: org,
      ticket: { ...params.nextTicket, id: params.ticketId },
      assignedByName: params.assignedByName,
      settings,
    });

    if (sendResult.activityLog) {
      try {
        await updateDocDirect('tickets', params.ticketId, {
          activityLog: sendResult.activityLog,
          activity_log: sendResult.activityLog,
          updatedAt: new Date().toISOString(),
        });
      } catch (err: any) {
        safeLog(
          'warn',
          '[second-level-notify] activityLog persist failed',
          err?.message || err,
        );
      }
    }

    return {
      notified: sendResult.sent,
      activityLog: sendResult.activityLog,
      reason: sendResult.reason,
    };
  } catch (err: any) {
    safeLog('error', '[second-level-notify] hook failed', err?.message || err);
    return { notified: false, reason: err?.message || 'hook_failed' };
  }
}
