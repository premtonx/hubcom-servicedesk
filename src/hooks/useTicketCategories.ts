import { useCallback, useEffect, useState } from 'react';
import type { TicketCategory } from '../lib/ticket-categories/types';
import { ticketCategoryService } from '../services/ticketCategoryService';

/** Lädt Ticket-Kategorien (optional nur aktive) und hält sie aktuell. */
export function useTicketCategories(activeOnly = true) {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ticketCategoryService.list(activeOnly);
      setCategories(list);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, loading, reload };
}
