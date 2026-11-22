import type { TicketCategory } from '../lib/ticket-categories/types';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: 'customer';
  companyId: string | null;
  contactId: string | null;
  customerCompany: string | null;
}

export interface PortalTicket {
  id: string;
  customId: string | null;
  subject: string;
  description: string;
  html_content?: string | null;
  status: string;
  priority: string;
  categoryId?: string | null;
  categoryName?: string | null;
  categorySlug?: string | null;
  companyId?: string | null;
  company?: string | null;
  contactId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  lastReplyAt?: string | null;
  attachments?: PortalAttachment[];
  channel?: string;
}

export interface PortalAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentBase64?: string;
  omitted?: boolean;
  reason?: string;
}

export interface PortalMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderType: string;
  senderName: string;
  content: string;
  html_content?: string | null;
  attachments: PortalAttachment[];
  createdAt: string;
  fromAddress?: string | null;
  toAddress?: string | null;
  cc?: string[] | null;
}

async function portalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/portal${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string })?.error || `Portal-Anfrage fehlgeschlagen (${res.status})`);
  }
  return data as T;
}

export function fileToPortalAttachment(file: File): Promise<PortalAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: base64,
      });
    };
    reader.onerror = () => reject(new Error(`Datei „${file.name}“ konnte nicht gelesen werden`));
    reader.readAsDataURL(file);
  });
}

export const portalService = {
  me: () => portalFetch<{ user: PortalUser }>('/me'),

  categories: () =>
    portalFetch<{ categories: TicketCategory[] }>('/categories').then((d) => d.categories || []),

  listTickets: (params?: { status?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.q) qs.set('q', params.q);
    const suffix = qs.toString() ? `?${qs}` : '';
    return portalFetch<{ tickets: PortalTicket[] }>(`/tickets${suffix}`).then((d) => d.tickets || []);
  },

  getTicket: (id: string) =>
    portalFetch<{ ticket: PortalTicket; messages: PortalMessage[] }>(
      `/tickets/${encodeURIComponent(id)}`,
    ),

  createTicket: (payload: {
    subject: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    categoryId?: string | null;
    attachments?: PortalAttachment[];
  }) =>
    portalFetch<{ success: boolean; ticket: PortalTicket }>('/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  reply: (
    ticketId: string,
    payload: { content: string; attachments?: PortalAttachment[] },
  ) =>
    portalFetch<{
      success: boolean;
      status: string;
      message: PortalMessage;
      ticket: PortalTicket;
    }>(`/tickets/${encodeURIComponent(ticketId)}/replies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
