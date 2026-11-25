/**
 * Shared ticket detail workbench — Shared UI, Separate APIs.
 * Staff: presentational pass-through of TicketDetailView + context pane.
 * Portal: same visual shell (header / conversation / right rail), portal adapter only.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChevronLeft, Loader2, Paperclip, Ticket, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { RichTextEditor } from '../RichTextEditor';
import { ConversationTimeline } from '../ticket-details/ConversationTimeline';
import { cn, getInitials, safeString } from '../../lib/utils';
import { formatTicketCode } from '../../lib/ticketMerge';
import { useTicketStatuses } from '../../hooks/useTicketStatuses';
import { useTicketPriorities } from '../../hooks/useTicketPriorities';
import {
  resolvePriorityConfig,
  resolveStatusConfig,
  softTintStyles,
} from '../../lib/ticket-config/display';
import { useClientPortalSession } from '../../hooks/useClientPortalSession';
import type { Message, Ticket as TicketType, TicketStatus } from '../../types';
import type { PortalTicketAttachment } from '../../services/clientPortalApi';
import {
  PORTAL_TICKET_DETAIL_CAPABILITIES,
  STAFF_TICKET_DETAIL_CAPABILITIES,
  type TicketDetailWorkbenchAdapter,
  type TicketDetailWorkbenchCapabilities,
  type TicketDetailWorkbenchMode,
} from '../../lib/tickets/ticket-detail-workbench-adapter';

export type TicketDetailWorkbenchProps = {
  mode: TicketDetailWorkbenchMode;
  adapter: TicketDetailWorkbenchAdapter;
  capabilities?: TicketDetailWorkbenchCapabilities;
  /** Staff: TicketDetailView + TicketDetailContextPane owned by TicketsPage. */
  staffDetailSlot?: ReactNode;
  /** Portal: ticket id from route. */
  ticketId?: string;
};

function mapPortalMessagesToTimeline(messages: any[]): Message[] {
  return (messages || []).map((m) => ({
    id: String(m.id),
    ticketId: String(m.ticketId || m.ticket_id || ''),
    content: String(m.content || m.html_content || ''),
    html_content: m.html_content ? String(m.html_content) : undefined,
    senderName: String(m.senderName || 'Unbekannt'),
    senderType:
      m.senderType === 'customer' || m.senderType === 'ai'
        ? m.senderType
        : m.senderType === 'agent'
          ? 'agent'
          : 'agent',
    createdAt: m.createdAt || m.created_at || new Date().toISOString(),
    attachments: Array.isArray(m.attachments)
      ? m.attachments.map((a: any) => ({
          filename: String(a.filename || 'file'),
          contentType: String(a.contentType || a.content_type || 'application/octet-stream'),
          size: Number(a.size) || 0,
        }))
      : undefined,
  })) as Message[];
}

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-50">
      <span className="text-[11px] font-semibold text-slate-500 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

function PortalTicketDetailBody({
  ticketId,
  adapter,
  capabilities,
}: {
  ticketId: string;
  adapter: TicketDetailWorkbenchAdapter;
  capabilities: TicketDetailWorkbenchCapabilities;
}) {
  const { session, isOrgWide, isClientAdmin } = useClientPortalSession();
  const { statuses: ticketStatuses } = useTicketStatuses();
  const { priorities: ticketPriorities } = useTicketPriorities();

  const [ticket, setTicket] = useState<TicketType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [members, setMembers] = useState<
    Array<{ id: string; name: string; email: string; role: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [attachments, setAttachments] = useState<PortalTicketAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [isMobilePropertiesOpen, setIsMobilePropertiesOpen] = useState(false);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const canManageParticipants = capabilities.canManageParticipants || isOrgWide;
  const canMarkClosed = capabilities.canMarkClosed || isClientAdmin || isOrgWide;

  const refresh = useCallback(async () => {
    if (!ticketId || !adapter.getDetail) return;
    setLoading(true);
    try {
      const detail = await adapter.getDetail(ticketId);
      setTicket(detail.ticket);
      setMessages(mapPortalMessagesToTimeline(detail.messages));
      setParticipantIds((detail.participants || []).map((p) => p.user_id));
      setMembers(detail.members || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Ticket konnte nicht geladen werden');
      setTicket(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [adapter, ticketId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendReply = async () => {
    if (!session || !ticketId || !adapter.reply) return;
    if (!replyText.trim() || replyText === '<p><br></p>') {
      toast.error('Antwort darf nicht leer sein.');
      return;
    }
    setSending(true);
    try {
      await adapter.reply(ticketId, {
        content: replyText,
        senderName: session.name || session.email,
        attachments,
      });
      setReplyText('');
      setAttachments([]);
      toast.success('Antwort gesendet.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'Senden fehlgeschlagen');
    } finally {
      setSending(false);
    }
  };

  const updateStatus = async (status: TicketStatus) => {
    if (!ticketId || !adapter.updateStatus) return;
    try {
      const updated = await adapter.updateStatus(ticketId, status);
      setTicket(updated || { ...ticket!, status });
      toast.success('Status aktualisiert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Status-Update fehlgeschlagen');
    }
  };

  const addParticipant = async () => {
    if (!ticketId || !addUserId || !adapter.addParticipant) return;
    try {
      await adapter.addParticipant(ticketId, addUserId);
      setAddUserId('');
      toast.success('Teilnehmer hinzugefügt.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Hinzufügen fehlgeschlagen');
    }
  };

  const removeParticipant = async (userId: string) => {
    if (!ticketId || !adapter.removeParticipant) return;
    try {
      await adapter.removeParticipant(ticketId, userId);
      toast.success('Teilnehmer entfernt.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Entfernen fehlgeschlagen');
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next: PortalTicketAttachment[] = [];
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
        toast.error('SVG-Uploads sind nicht erlaubt.');
        continue;
      }
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
      next.push({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        contentBase64: btoa(binary),
      });
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 5));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 bg-slate-50">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
        Ticket wird geladen…
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white dark:bg-slate-900 min-h-0">
        <Ticket className="w-10 h-10 text-muted-foreground opacity-40" />
        <h2 className="text-xl font-bold mt-4 text-foreground">Ticket nicht gefunden</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          Das Ticket ist nicht verfügbar oder Sie haben keinen Zugriff.
        </p>
        <Button variant="outline" size="sm" className="mt-6" onClick={() => adapter.openBack()}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Zurück zur Ticketliste
        </Button>
      </div>
    );
  }

  const ticketRef = ticket.customId
    ? `#${String(ticket.customId).replace(/^#/, '')}`
    : formatTicketCode(ticket);
  const status = String(ticket.status || 'open');
  const isClosed = ['resolved', 'closed'].includes(status.toLowerCase());
  const creatorName = safeString(ticket.customerName) || safeString(ticket.customerEmail) || '—';
  const assigneeName =
    safeString(ticket.agentName) || (ticket.agentId ? 'Zugewiesen' : 'In Prüfung');

  const statusDisplay = resolveStatusConfig(ticket.status, ticketStatuses);
  const statusTint = softTintStyles(statusDisplay.color);
  const priorityDisplay = resolvePriorityConfig(ticket.priority, ticketPriorities);
  const priorityTint = softTintStyles(priorityDisplay.color);

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-row overflow-hidden relative">
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-slate-50">
        {/* Staff-matched header */}
        <div className="flex flex-col gap-1.5 w-full min-w-0 px-4 md:px-6 pt-3 md:pt-4 pb-3 border-b border-slate-100 dark:border-slate-850 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex w-full min-w-0 items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => adapter.openBack()}
                aria-label="Zurück zur Ticketliste"
                title="Zurück zur Ticketliste"
                className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 cursor-pointer transition-colors select-none shrink-0 mt-0.5"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-snug dark:text-slate-50 min-w-0 break-words">
                  {safeString(ticket.subject)}
                </h2>
                <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap leading-none">
                  <span
                    className="inline-flex h-5 items-center gap-1.5 px-2 text-[11px] font-medium rounded-full border shrink-0"
                    style={statusTint}
                    title={statusDisplay.name}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: statusDisplay.color }}
                      aria-hidden
                    />
                    {statusDisplay.name}
                  </span>
                  <span
                    className="inline-flex h-5 items-center gap-1.5 px-2 text-[11px] font-medium rounded-full border shrink-0"
                    style={priorityTint}
                    title={priorityDisplay.name}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: priorityDisplay.color }}
                      aria-hidden
                    />
                    {priorityDisplay.name}
                  </span>
                  <span className="inline-flex h-5 items-center text-[11px] font-medium tracking-normal text-slate-500 min-w-0">
                    {safeString(ticket.company) || 'Kein Unternehmen'} &bull;{' '}
                    {safeString(ticket.customerName) || 'Keine Kontaktperson zugewiesen'} &bull;{' '}
                    <span className="font-mono tabular-nums text-slate-600 font-semibold">
                      {ticketRef}
                    </span>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 h-8 lg:hidden">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setIsMobilePropertiesOpen((v) => !v)}
              >
                Eigenschaften
              </Button>
            </div>
          </div>
        </div>

        {/* Conversation-only tab bar (staff chrome tabs gated off) */}
        <div className="px-6 border-b border-slate-100 dark:border-slate-850 bg-white dark:bg-slate-900 shrink-0 flex items-center justify-between h-[48px] select-none">
          <div className="flex items-center gap-1 h-full overflow-x-auto custom-scrollbar">
            <button
              type="button"
              className="h-full px-4 text-xs border-b-2 border-blue-600 text-blue-600 font-semibold shrink-0 flex items-center gap-2 relative"
            >
              Übersicht
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <div className="w-full space-y-4 pb-12">
            <ConversationTimeline
              ticket={ticket}
              messages={messages}
              agentComments={[]}
              onReplyClick={() => {
                const el = document.getElementById('portal-public-reply-composer');
                el?.scrollIntoView({ behavior: 'smooth' });
              }}
              onQuoteClick={(text) => {
                setReplyText((prev) =>
                  prev
                    ? `${prev}<blockquote>${text}</blockquote><br/>`
                    : `<blockquote>${text}</blockquote><br/>`,
                );
              }}
              onInternalNoteAction={() => undefined}
              onAddAgentComment={() => undefined}
              isTranslating={false}
              translatedTicket={null}
            />

            {capabilities.portalPublicReply ? (
              <div id="portal-public-reply-composer" className="relative space-y-2">
                <div className="flex items-center gap-1 px-1">
                  <span className="h-8 px-3 text-xs border-b-2 border-blue-600 text-blue-600 font-semibold inline-flex items-center">
                    Öffentliche Antwort
                  </span>
                </div>
                <div className="bg-card border border-border rounded-2xl shadow-md p-4 space-y-3">
                  <RichTextEditor
                    value={replyText}
                    onChange={setReplyText}
                    placeholder="Antwort schreiben…"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                      <Paperclip className="w-3.5 h-3.5" />
                      Anhang
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        onChange={(e) => void onPickFiles(e.target.files)}
                      />
                    </label>
                    {attachments.map((a) => (
                      <span
                        key={a.filename}
                        className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px]"
                      >
                        {a.filename}
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) => prev.filter((x) => x.filename !== a.filename))
                          }
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <Button
                      type="button"
                      className="ml-auto h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold"
                      disabled={sending}
                      onClick={() => void sendReply()}
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                      Senden
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>

      {capabilities.portalPropertiesPane ? (
        <aside
          className={cn(
            'w-full lg:w-[320px] shrink-0 border-l border-slate-100 bg-white overflow-y-auto',
            'lg:relative lg:translate-x-0 lg:block',
            isMobilePropertiesOpen
              ? 'absolute inset-y-0 right-0 z-30 shadow-xl'
              : 'hidden lg:block',
          )}
        >
          <div className="p-4 space-y-5">
            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Eigenschaften
              </h3>
              <PropRow label="Status">
                <span
                  className="inline-flex h-5 items-center gap-1.5 px-2 text-[11px] font-medium rounded-full border"
                  style={statusTint}
                >
                  {statusDisplay.name}
                </span>
              </PropRow>
              <PropRow label="Priorität">
                <span
                  className="inline-flex h-5 items-center gap-1.5 px-2 text-[11px] font-medium rounded-full border"
                  style={priorityTint}
                >
                  {priorityDisplay.name}
                </span>
              </PropRow>
              <PropRow label="Kategorie">
                <span className="text-sm text-slate-800">
                  {safeString(ticket.categoryName) || '—'}
                </span>
              </PropRow>
              <PropRow label="Zuständiger Techniker">
                <div className="flex items-center gap-2 min-w-0 justify-end">
                  <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-[9px] font-bold">
                    {getInitials(assigneeName)}
                  </div>
                  <span className="text-sm text-slate-800 truncate">{assigneeName}</span>
                </div>
              </PropRow>
              <PropRow label="Ersteller">
                <div className="flex items-center gap-2 min-w-0 justify-end">
                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-bold">
                    {getInitials(creatorName)}
                  </div>
                  <span className="text-sm text-slate-800 truncate">{creatorName}</span>
                </div>
              </PropRow>
            </section>

            {capabilities.participantsPanel ? (
              <section className="space-y-2">
                <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  Beteiligte
                </h3>
                <ul className="space-y-1.5">
                  {participantIds.length === 0 ? (
                    <li className="text-xs text-slate-400">Keine zusätzlichen Beteiligten</li>
                  ) : (
                    participantIds.map((uid) => {
                      const m = membersById.get(uid);
                      const label = m?.name || m?.email || uid;
                      return (
                        <li
                          key={uid}
                          className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-1.5"
                        >
                          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[9px] font-bold">
                            {getInitials(label)}
                          </div>
                          <span className="text-xs font-semibold text-slate-700 flex-1 truncate">
                            {label}
                          </span>
                          {canManageParticipants ? (
                            <button
                              type="button"
                              className="text-slate-400 hover:text-rose-600"
                              onClick={() => void removeParticipant(uid)}
                              title="Entfernen"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                </ul>
                {canManageParticipants ? (
                  <div className="flex gap-2 pt-1">
                    <select
                      className="flex-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-xs"
                      value={addUserId}
                      onChange={(e) => setAddUserId(e.target.value)}
                    >
                      <option value="">Mitarbeiter wählen…</option>
                      {members
                        .filter((m) => !participantIds.includes(m.id) && m.id !== session?.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.email}
                          </option>
                        ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      disabled={!addUserId}
                      onClick={() => void addParticipant()}
                      title="Hinzufügen"
                    >
                      <UserPlus className="w-4 h-4" />
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}

            {capabilities.statusActions ? (
              <section className="space-y-2 pt-1">
                <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  Aktionen
                </h3>
                {isClosed ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void updateStatus('open')}
                  >
                    Ticket wieder öffnen
                  </Button>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => void updateStatus('resolved')}
                    >
                      Ticket schließen (Gelöst)
                    </Button>
                    {canMarkClosed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="w-full text-slate-600"
                        onClick={() => void updateStatus('closed')}
                      >
                        Als geschlossen markieren
                      </Button>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </aside>
      ) : null}

      {isMobilePropertiesOpen ? (
        <div
          onClick={() => setIsMobilePropertiesOpen(false)}
          className="lg:hidden absolute inset-0 z-20 bg-black/40 backdrop-blur-[1px]"
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

export function TicketDetailWorkbench({
  mode,
  adapter,
  capabilities,
  staffDetailSlot,
  ticketId,
}: TicketDetailWorkbenchProps) {
  const caps =
    capabilities ||
    (mode === 'staff' ? STAFF_TICKET_DETAIL_CAPABILITIES : PORTAL_TICKET_DETAIL_CAPABILITIES);

  if (mode === 'staff') {
    return <>{staffDetailSlot}</>;
  }

  if (!ticketId) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        Kein Ticket ausgewählt.
      </div>
    );
  }

  return (
    <PortalTicketDetailBody ticketId={ticketId} adapter={adapter} capabilities={caps} />
  );
}

export default TicketDetailWorkbench;
