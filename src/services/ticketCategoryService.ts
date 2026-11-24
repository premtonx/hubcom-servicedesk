import type { TicketCategory, TicketCategoryInput } from '../lib/ticket-categories/types';

async function parseJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.code;
    err.usageCount = data?.usageCount;
    err.status = res.status;
    throw err;
  }
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

  async update(
    id: string,
    patch: Partial<TicketCategoryInput> & { replacementId?: string },
  ): Promise<TicketCategory> {
    const res = await fetch(`/api/ticket-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await parseJson(res);
    return data.category as TicketCategory;
  },

  async remove(id: string, replacementId?: string): Promise<void> {
    const qs = replacementId ? `?replacementId=${encodeURIComponent(replacementId)}` : '';
    const res = await fetch(`/api/ticket-categories/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },
};
