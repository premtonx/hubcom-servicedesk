import { useCallback, useEffect, useState } from 'react';
import type { TicketCategory } from '../lib/ticket-categories/types';
import { ticketCategoryService } from '../services/ticketCategoryService';

/** Lädt Ticket-Kategorien (optional nur aktive) und hält sie aktuell. */
export function useTicketCategories(activeOnly = true, options?: { enabled?: boolean }) {
  const enabled = options?.enabled !== false;
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await ticketCategoryService.list(activeOnly);
      setCategories(list);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [activeOnly, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, loading, reload };
}
