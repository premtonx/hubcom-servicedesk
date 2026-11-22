/**
 * Kundenzugriff: Ticket-Scope und öffentliche Projektion (ohne interne Daten).
 */

export interface CustomerContext {
  userId: string;
  email: string;
  name: string;
  companyId: string | null;
  contactId: string | null;
  customerCompany: string | null;
}

export function resolveCustomerContext(user: {
  id?: string;
  uid?: string;
  email?: string;
  name?: string;
  dbRecord?: Record<string, unknown> | null;
}): CustomerContext {
  const doc = (user.dbRecord || {}) as Record<string, unknown>;
  const email = String(user.email || doc.email || '')
    .trim()
    .toLowerCase();
  return {
    userId: String(user.id || user.uid || doc.id || ''),
    email,
    name: String(user.name || doc.name || email.split('@')[0] || 'Kunde'),
    companyId: (doc.companyId as string) || (doc.customerCompanyId as string) || null,
    contactId: (doc.contactId as string) || null,
    customerCompany:
      (doc.customerCompany as string) ||
      (doc.companyName as string) ||
      null,
  };
}

function normEmail(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

/** Ticket gehört dem Kunden (eigene Erstellung) oder seiner Firma. */
export function customerCanAccessTicket(
  ticket: Record<string, any> | null | undefined,
  ctx: CustomerContext,
): boolean {
  if (!ticket) return false;

  if (ctx.contactId && String(ticket.contactId || '') === ctx.contactId) return true;
  if (ctx.companyId && String(ticket.companyId || '') === ctx.companyId) return true;

  if (ctx.userId) {
    if (String(ticket.creatorId || '') === ctx.userId) return true;
    if (String(ticket.createdBy || '') === ctx.userId) return true;
    if (String(ticket.portalUserId || '') === ctx.userId) return true;
  }

  if (ctx.email) {
    const candidates = [
      ticket.customerEmail,
      ticket.from_email,
      ticket.customerId,
      ticket.requesterEmail,
      ticket.contactEmail,
    ].map(normEmail);
    if (candidates.includes(ctx.email)) return true;
  }

  if (ctx.customerCompany) {
    const companyName = String(ticket.company || ticket.companyName || '').trim().toLowerCase();
    if (companyName && companyName === ctx.customerCompany.trim().toLowerCase()) return true;
  }

  return false;
}

const INTERNAL_MESSAGE_KEYS = [
  'isInternal',
  'internal',
  'is_internal',
  'visibility',
] as const;

/** Öffentliche Nachrichten — keine internen Notizen / isInternal. */
export function isPublicPortalMessage(msg: Record<string, any>): boolean {
  if (!msg) return false;
  if (msg.isInternal === true || msg.internal === true || msg.is_internal === true) return false;
  if (String(msg.visibility || '').toLowerCase() === 'internal') return false;
  if (String(msg.channel || '').toLowerCase() === 'internal_note') return false;
  // Agenten-Kommentare liegen separat; senderType 'note' ausfiltern
  if (String(msg.senderType || '').toLowerCase() === 'note') return false;
  if (String(msg.senderType || '').toLowerCase() === 'internal') return false;
  return true;
}

export function sanitizeMessageForPortal(msg: Record<string, any>) {
  return {
    id: msg.id,
    ticketId: msg.ticketId,
    senderId: msg.senderId,
    senderType: msg.senderType === 'ai' ? 'agent' : msg.senderType,
    senderName: msg.senderName || (msg.senderType === 'customer' ? 'Sie' : 'Support'),
    content: msg.content || msg.text_content || '',
    html_content: msg.html_content || null,
    attachments: Array.isArray(msg.attachments)
      ? msg.attachments.map((a: any) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          omitted: a.omitted,
          reason: a.reason,
          // contentBase64 nur wenn nicht weggelassen — Download im Portal
          contentBase64: a.omitted ? undefined : a.contentBase64,
        }))
      : [],
    createdAt: msg.createdAt,
    fromAddress: msg.fromAddress || null,
    toAddress: msg.toAddress || null,
    cc: Array.isArray(msg.cc) ? msg.cc : null,
  };
}

/** Ticket-Projektion ohne interne Notizen, KI-Felder, Zeiterfassung. */
export function sanitizeTicketForPortal(ticket: Record<string, any>) {
  return {
    id: ticket.id,
    customId: ticket.customId || null,
    subject: ticket.subject || '',
    description: ticket.description || '',
    html_content: ticket.html_content || null,
    status: ticket.status || 'open',
    priority: ticket.priority || 'medium',
    categoryId: ticket.categoryId || null,
    categoryName: ticket.categoryName || null,
    categorySlug: ticket.categorySlug || null,
    companyId: ticket.companyId || null,
    company: ticket.company || ticket.companyName || null,
    contactId: ticket.contactId || null,
    customerName: ticket.customerName || null,
    customerEmail: ticket.customerEmail || ticket.from_email || null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastReplyAt: ticket.lastReplyAt || null,
    attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
    channel: ticket.channel || 'portal',
  };
}

export { INTERNAL_MESSAGE_KEYS };
