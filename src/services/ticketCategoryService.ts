import type { TicketCategory, TicketCategoryInput } from '../lib/ticket-categories/types';

async function parseJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export const ticketCategoryService = {
  async list(activeOnly = false): Promise<TicketCategory[]> {
    const qs = activeOnly ? '?activeOnly=1' : '';
    const res = await fetch(`/api/ticket-categories${qs}`, { credentials: 'include' });
    const data = await parseJson(res);
    return (data.categories || []) as TicketCategory[];
  },

  async create(input: TicketCategoryInput): Promise<TicketCategory> {
    const res = await fetch('/api/ticket-categories', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseJson(res);
    return data.category as TicketCategory;
  },

  async update(id: string, patch: Partial<TicketCategoryInput>): Promise<TicketCategory> {
    const res = await fetch(`/api/ticket-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await parseJson(res);
    return data.category as TicketCategory;
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/ticket-categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },
};
