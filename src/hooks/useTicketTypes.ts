import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TicketTypeConfig } from '../lib/ticket-config/types';
import { ticketConfigService } from '../services/ticketConfigService';

/** Loads admin-configured ticket types (includes inactive for legacy display). */
export function useTicketTypes() {
  const [types, setTypes] = useState<TicketTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ticketConfigService.listTypes(false);
      setTypes(list.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch {
      setTypes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const activeTypes = useMemo(
    () => types.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [types],
  );

  return { types, activeTypes, loading, reload };
}
