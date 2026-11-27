import type { TimeEntry, TimeTrackingSettings } from '../lib/time-tracking/types';

async function parseJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export type TimeEntryListParams = {
  ticketId?: string;
  organizationId?: string;
  userId?: string;
  from?: string;
  to?: string;
  type?: 'all' | 'with_ticket' | 'without_ticket';
};

export const timeEntryService = {
  async getSettings(): Promise<TimeTrackingSettings> {
    const res = await fetch('/api/time-entries/settings', { credentials: 'include' });
    const data = await parseJson(res);
    return data.settings as TimeTrackingSettings;
  },

  async saveSettings(patch: Partial<TimeTrackingSettings>): Promise<TimeTrackingSettings> {
    const res = await fetch('/api/time-entries/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await parseJson(res);
    return data.settings as TimeTrackingSettings;
  },

  async getDefaults(): Promise<{
    kuerzel: string;
    agentName: string;
    isAdmin?: boolean;
    rates: { standardHourlyRate: number; specialHourlyRate: number };
  }> {
    const res = await fetch('/api/time-entries/me/defaults', { credentials: 'include' });
    return parseJson(res);
  },

  async list(params?: TimeEntryListParams): Promise<{
    entries: TimeEntry[];
    summary: { totalHours: number; totalAmount: number; count: number };
    scope?: 'mine' | 'all';
  }> {
    const qs = new URLSearchParams();
    if (params?.ticketId) qs.set('ticketId', params.ticketId);
    if (params?.organizationId) qs.set('organizationId', params.organizationId);
    if (params?.userId) qs.set('userId', params.userId);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.type && params.type !== 'all') qs.set('type', params.type);
    const res = await fetch(`/api/time-entries?${qs.toString()}`, { credentials: 'include' });
    return parseJson(res);
  },

  async create(input: {
    ticketId?: string | null;
    organizationId?: string | null;
    ticketNumber?: string;
    ticketSubject?: string;
    customerCompany?: string;
    kuerzel: string;
    hours: number;
    minutes?: number;
    sonderzahlung?: boolean;
    description?: string;
    date?: string;
  }): Promise<TimeEntry> {
    const res = await fetch('/api/time-entries', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await parseJson(res);
    return data.entry as TimeEntry;
  },

  async update(
    id: string,
    patch: Partial<{
      kuerzel: string;
      hours: number;
      minutes: number;
      sonderzahlung: boolean;
      description: string;
      date: string;
      ticketId: string | null;
      organizationId: string | null;
    }>,
  ): Promise<TimeEntry> {
    const res = await fetch(`/api/time-entries/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await parseJson(res);
    return data.entry as TimeEntry;
  },

  async remove(id: string): Promise<void> {
    const res = await fetch(`/api/time-entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    await parseJson(res);
  },

  downloadExportUrl(params?: TimeEntryListParams): string {
    const qs = new URLSearchParams();
    if (params?.ticketId) qs.set('ticketId', params.ticketId);
    if (params?.organizationId) qs.set('organizationId', params.organizationId);
    if (params?.userId) qs.set('userId', params.userId);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.type && params.type !== 'all') qs.set('type', params.type);
    return `/api/time-entries/export.xlsx?${qs.toString()}`;
  },

  async syncGraph(onlyUnsynced = true): Promise<{
    ok: boolean;
    message: string;
    added: number;
    updated: number;
    skipped: number;
  }> {
    const res = await fetch('/api/time-entries/sync-graph', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onlyUnsynced }),
    });
    return parseJson(res);
  },

  async runMonthlySync(): Promise<{ ok: boolean; ran?: boolean; exported?: number; error?: string }> {
    const res = await fetch('/api/time-entries/run-monthly-sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return parseJson(res);
  },

  async runExportJob(immediate = true): Promise<{ ok: boolean; filePath?: string; jobId?: string }> {
    const res = await fetch('/api/time-entries/run-export-job', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ immediate }),
    });
    return parseJson(res);
  },
};
