import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TicketPriorityConfig } from '../lib/ticket-config/types';
import { ticketConfigService } from '../services/ticketConfigService';

/** Loads admin-configured priorities ordered lowest → highest. */
export function useTicketPriorities(options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const [priorities, setPriorities] = useState<TicketPriorityConfig[]>([]);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) {
      setPriorities([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await ticketConfigService.listPriorities(false);
      setPriorities(list.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      setPriorities([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activePriorities = useMemo(
    () => priorities.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [priorities],
  );

  /** sortOrder map for ranking (higher sortOrder = higher priority). */
  const rankByKey = useMemo(() => {
    const map = new Map<string, number>();
    priorities.forEach((p) => map.set(p.key.toLowerCase(), p.sortOrder));
    return map;
  }, [priorities]);

  return { priorities, activePriorities, rankByKey, loading, reload };
}
