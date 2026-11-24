import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TicketStatusConfig } from '../lib/ticket-config/types';
import { ticketConfigService } from '../services/ticketConfigService';

/** Loads admin-configured ticket statuses (includes inactive for display of legacy ticket values). */
export function useTicketStatuses() {
  const [statuses, setStatuses] = useState<TicketStatusConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ticketConfigService.listStatuses(false);
      setStatuses(list);
    } catch {
      setStatuses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeStatuses = useMemo(
    () => statuses.filter((s) => s.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [statuses],
  );

  return { statuses, activeStatuses, loading, reload };
}
