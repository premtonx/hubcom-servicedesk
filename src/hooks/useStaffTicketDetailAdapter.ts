/**
 * Staff ticket detail adapter — navigation only.
 * TicketDetailWorkbench staff mode uses staffDetailSlot; mutations stay in TicketsPage.
 */

import { useMemo } from 'react';
import type { TicketDetailWorkbenchAdapter } from '../lib/tickets/ticket-detail-workbench-adapter';

export function useStaffTicketDetailAdapter(options: {
  onBack: () => void;
}): TicketDetailWorkbenchAdapter {
  const { onBack } = options;
  return useMemo(
    () => ({
      openBack: onBack,
    }),
    [onBack],
  );
}
