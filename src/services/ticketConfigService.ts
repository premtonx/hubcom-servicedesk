import type {
  TicketPriorityConfig,
  TicketStatusConfig,
  TicketTypeConfig,
} from '../lib/ticket-config/types';

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

export type StatusWithUsage = TicketStatusConfig & { usageCount?: number };
export type PriorityWithUsage = TicketPriorityConfig & { usageCount?: number };
export type TypeWithUsage = TicketTypeConfig & { usageCount?: number };

export const ticketConfigService = {
  async listStatuses(activeOnly = false): Promise<StatusWithUsage[]> {
    const qs = activeOnly ? '?activeOnly=1' : '';
    const res = await fetch(`/api/ticket-config/statuses${qs}`, { credentials: 'include' });
    const data = await parseJson(res);
    return (data.statuses || []) as StatusWithUsage[];
  },

  async createStatus(input: Record<string, unknown>): Promise<TicketStatusConfig> {
    const res = await fetch('/api/ticket-config/statuses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return (await parseJson(res)).status;
  },

  async updateStatus(id: string, patch: Record<string, unknown>): Promise<TicketStatusConfig> {
    const res = await fetch(`/api/ticket-config/statuses/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return (await parseJson(res)).status;
  },

  async removeStatus(id: string, replacementKey?: string): Promise<void> {
    const qs = replacementKey ? `?replacementKey=${encodeURIComponent(replacementKey)}` : '';
    const res = await fetch(`/api/ticket-config/statuses/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },

  async listPriorities(activeOnly = false): Promise<PriorityWithUsage[]> {
    const qs = activeOnly ? '?activeOnly=1' : '';
    const res = await fetch(`/api/ticket-config/priorities${qs}`, { credentials: 'include' });
    const data = await parseJson(res);
    return (data.priorities || []) as PriorityWithUsage[];
  },

  async createPriority(input: Record<string, unknown>): Promise<TicketPriorityConfig> {
    const res = await fetch('/api/ticket-config/priorities', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return (await parseJson(res)).priority;
  },

  async updatePriority(id: string, patch: Record<string, unknown>): Promise<TicketPriorityConfig> {
    const res = await fetch(`/api/ticket-config/priorities/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return (await parseJson(res)).priority;
  },

  async removePriority(id: string, replacementKey?: string): Promise<void> {
    const qs = replacementKey ? `?replacementKey=${encodeURIComponent(replacementKey)}` : '';
    const res = await fetch(`/api/ticket-config/priorities/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },

  async listTypes(activeOnly = false): Promise<TypeWithUsage[]> {
    const qs = activeOnly ? '?activeOnly=1' : '';
    const res = await fetch(`/api/ticket-config/types${qs}`, { credentials: 'include' });
    const data = await parseJson(res);
    return (data.types || []) as TypeWithUsage[];
  },

  async createType(input: Record<string, unknown>): Promise<TicketTypeConfig> {
    const res = await fetch('/api/ticket-config/types', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return (await parseJson(res)).type;
  },

  async updateType(id: string, patch: Record<string, unknown>): Promise<TicketTypeConfig> {
    const res = await fetch(`/api/ticket-config/types/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return (await parseJson(res)).type;
  },

  async removeType(id: string, replacementKey?: string): Promise<void> {
    const qs = replacementKey ? `?replacementKey=${encodeURIComponent(replacementKey)}` : '';
    const res = await fetch(`/api/ticket-config/types/${encodeURIComponent(id)}${qs}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },
};
