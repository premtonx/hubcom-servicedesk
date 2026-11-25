import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Paperclip, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';
import { RichTextEditor } from '../../RichTextEditor';
import { cn, getInitials, safeString } from '../../../lib/utils';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import {
  clientPortalApi,
  type PortalMember,
  type PortalTicketAttachment,
} from '../../../services/clientPortalApi';
import type { Ticket, TicketStatus } from '../../../types';
import { sanitizeTimelineHtml } from '../../../lib/sanitize-html';
import { portalPriorityLabel, portalStatusLabel } from '../../../lib/portal/status';
import { portalPriorityBadgeClass, portalStatusBadgeClass } from '../../portal/portalUi';
import { formatRelativeTime } from '../../../lib/dashboard-format-utils';
import {
  emptyHardwareReturnForm,
  hardwareFormFromRecord,
  hardwareFormToPayload,
  HardwareReturnSections,
  type HardwareReturnFormState,
} from '../../tickets/HardwareReturnSections';

type TimelineItem = {
  id: string;
  content: string;
  senderName: string;
  badge: 'Hubcom Support' | 'Kunden-Support' | 'Mitarbeiter';
  createdAt: string;
  attachments?: PortalTicketAttachment[];
};

function roleBadge(params: {
  senderType?: string;
  senderId?: string;
  membersById: Map<string, PortalMember>;
}): TimelineItem['badge'] {
  const member = params.senderId ? params.membersById.get(params.senderId) : undefined;
  if (member?.role === 'CLIENT_ADMIN' || member?.role === 'CLIENT_SUPPORTER') {
    return 'Kunden-Support';
  }
  if (member?.role === 'CLIENT_USER' || params.senderType === 'customer') {
    return 'Mitarbeiter';
  }
  if (params.senderType === 'agent' || params.senderType === 'ai') {
    return 'Hubcom Support';
  }
  return member ? 'Mitarbeiter' : 'Hubcom Support';
}

export default function ClientTicketDetailPage() {
  const { ticketId = '' } = useParams();
  const { session, isOrgWide, isClientAdmin } = useClientPortalSession();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [members, setMembers] = useState<PortalMember[]>([]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [reply, setReply] = useState('');
  const [attachments, setAttachments] = useState<PortalTicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [addUserId, setAddUserId] = useState('');
  const [hardwareEnabled, setHardwareEnabled] = useState(false);
  const [hardwareForm, setHardwareForm] = useState<HardwareReturnFormState>(() =>
    emptyHardwareReturnForm(),
  );
  const [hardwareDirty, setHardwareDirty] = useState(false);
  const [savingHardware, setSavingHardware] = useState(false);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const canManageParticipants = isOrgWide;
  const canEditHardware = isOrgWide && hardwareEnabled;

  const refresh = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    try {
      // Single portal REST call — never /api/db for ticket/messages.
      const [detail, mems] = await Promise.all([
        clientPortalApi.getTicket(ticketId),
        isOrgWide ? clientPortalApi.listMembers().catch(() => []) : Promise.resolve([]),
      ]);
      setTicket(detail.ticket);
      setMessages(detail.messages || []);
      setParticipants((detail.participants || []).map((p) => p.user_id));
      setMembers(mems || []);
      const enabled = Boolean((detail as any).enabledModules?.hardwareReturns);
      setHardwareEnabled(enabled);
      setHardwareForm(hardwareFormFromRecord((detail as any).hardwareReturn || null));
      setHardwareDirty(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Ticket konnte nicht geladen werden');
      setTicket(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [ticketId, isOrgWide]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const timeline: TimelineItem[] = useMemo(() => {
    if (!ticket) return [];
    const openerContent = String(ticket.html_content || ticket.description || '').trim();
    const rest = messages
      .slice()
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .map((m) => ({
        id: String(m.id),
        content: String(m.content || m.html_content || ''),
        senderName: String(m.senderName || 'Unbekannt'),
        badge: roleBadge({
          senderType: m.senderType,
          senderId: m.senderId,
          membersById,
        }),
        createdAt: String(m.createdAt || ''),
        attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
      }));

    // Avoid duplicating the opener when the first message mirrors the description.
    const firstIsDuplicate =
      rest.length > 0 &&
      openerContent &&
      String(rest[0].content || '')
        .replace(/<[^>]+>/g, '')
        .trim() === openerContent.replace(/<[^>]+>/g, '').trim();

    if (!openerContent || firstIsDuplicate) return rest;

    const opener: TimelineItem = {
      id: 'opener',
      content: openerContent,
      senderName: String(ticket.customerName || ticket.customerEmail || 'Mitarbeiter'),
      badge: roleBadge({
        senderType: 'customer',
        senderId: String(ticket.requesterId || ticket.requester_id || ticket.creatorId || ''),
        membersById,
      }),
      createdAt: String(ticket.createdAt || ''),
      attachments: Array.isArray((ticket as any).attachments)
        ? ((ticket as any).attachments as PortalTicketAttachment[])
        : undefined,
    };
    return [opener, ...rest];
  }, [ticket, messages, membersById]);

  const sendReply = async () => {
    if (!session || !ticketId) return;
    if (!reply.trim() || reply === '<p><br></p>') {
      toast.error('Antwort darf nicht leer sein.');
      return;
    }
    setSending(true);
    try {
      await clientPortalApi.reply(ticketId, {
        content: reply,
        senderName: session.name || session.email,
        attachments,
      });
      setReply('');
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
    if (!ticketId) return;
    try {
      const updated = await clientPortalApi.updateTicketStatus(ticketId, status);
      setTicket(updated || { ...ticket!, status });
      toast.success('Status aktualisiert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Status-Update fehlgeschlagen');
    }
  };

  const addParticipant = async () => {
    if (!ticketId || !addUserId) return;
    try {
      await clientPortalApi.addParticipant(ticketId, addUserId);
      setAddUserId('');
      toast.success('Teilnehmer hinzugefügt.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Hinzufügen fehlgeschlagen');
    }
  };

  const removeParticipant = async (userId: string) => {
    if (!ticketId) return;
    try {
      await clientPortalApi.removeParticipant(ticketId, userId);
      toast.success('Teilnehmer entfernt.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Entfernen fehlgeschlagen');
    }
  };

  const saveHardware = async () => {
    if (!ticketId || !canEditHardware) return;
    setSavingHardware(true);
    try {
      await clientPortalApi.updateHardwareReturn(ticketId, hardwareFormToPayload(hardwareForm));
      setHardwareDirty(false);
      toast.success('Hardware-Daten gespeichert.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Hardware-Speichern fehlgeschlagen');
    } finally {
      setSavingHardware(false);
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
      <div className="h-full flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin inline mr-2" />
        Ticket wird geladen…
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="p-10 space-y-4">
        <Link
          to="/portal/tickets"
          className="text-sm font-semibold text-slate-600 hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Zurück zur Ticketliste
        </Link>
        <p className="text-slate-500">Ticket nicht gefunden oder kein Zugriff.</p>
      </div>
    );
  }

  const creatorName =
    safeString(ticket.customerName) || safeString(ticket.customerEmail) || '—';
  const assigneeName = safeString(ticket.agentName) || (ticket.agentId ? 'Zugewiesen' : 'In Prüfung');
  const customId = String(ticket.customId || ticket.id || '');
  const status = String(ticket.status || 'open');
  const isClosed = ['resolved', 'closed'].includes(status.toLowerCase());

  return (
    <div className="h-full min-h-0 flex flex-col bg-white overflow-hidden">
      <div className="shrink-0 h-12 px-4 border-b border-slate-200 flex items-center gap-3 bg-white">
        <Link
          to="/portal/tickets"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Tickets
        </Link>
        <span className="text-slate-300">/</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 truncate">{ticket.subject}</p>
          <p className="text-[11px] font-mono text-slate-400">
            {customId.startsWith('#') ? customId : `#${customId}`}
          </p>
        </div>
        <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', portalStatusBadgeClass(status))}>
          {portalStatusLabel(status)}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: conversation */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col border-r border-slate-100">
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-4">
            {timeline.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                    {getInitials(item.senderName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">{item.senderName}</p>
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                          item.badge === 'Hubcom Support'
                            ? 'bg-blue-50 text-blue-700'
                            : item.badge === 'Kunden-Support'
                              ? 'bg-violet-50 text-violet-700'
                              : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {item.badge}
                      </span>
                      <span className="text-[11px] text-slate-400 ml-auto">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className="prose prose-sm max-w-none text-slate-700"
                  dangerouslySetInnerHTML={{ __html: sanitizeTimelineHtml(item.content) }}
                />
                {item.attachments && item.attachments.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {item.attachments.map((a, idx) => (
                      <li
                        key={`${a.filename}-${idx}`}
                        className="text-xs text-slate-500 inline-flex items-center gap-1.5 mr-3"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        {a.filename}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <Label className="text-xs font-bold text-slate-600">Öffentliche Antwort</Label>
            <RichTextEditor value={reply} onChange={setReply} placeholder="Antwort schreiben…" />
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

        {/* Right: properties */}
        <aside className="w-full lg:w-[320px] shrink-0 border-t lg:border-t-0 bg-white overflow-y-auto">
          <div className="p-4 space-y-5">
            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Eigenschaften
              </h3>
              <PropRow label="Status">
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', portalStatusBadgeClass(status))}>
                  {portalStatusLabel(status)}
                </span>
              </PropRow>
              <PropRow label="Priorität">
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', portalPriorityBadgeClass(ticket.priority))}>
                  {portalPriorityLabel(ticket.priority)}
                </span>
              </PropRow>
              <PropRow label="Kategorie">
                <span className="text-sm text-slate-800">
                  {safeString(ticket.categoryName) || '—'}
                </span>
              </PropRow>
              <PropRow label="Zuständiger Techniker">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-[9px] font-bold">
                    {getInitials(assigneeName)}
                  </div>
                  <span className="text-sm text-slate-800 truncate">{assigneeName}</span>
                </div>
              </PropRow>
              <PropRow label="Ersteller">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-bold">
                    {getInitials(creatorName)}
                  </div>
                  <span className="text-sm text-slate-800 truncate">{creatorName}</span>
                </div>
              </PropRow>
            </section>

            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Beteiligte
              </h3>
              <ul className="space-y-1.5">
                {participants.length === 0 ? (
                  <li className="text-xs text-slate-400">Keine zusätzlichen Beteiligten</li>
                ) : (
                  participants.map((uid) => {
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
                      .filter((m) => !participants.includes(m.id) && m.id !== session?.id)
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

            {hardwareEnabled ? (
              <section className="space-y-3 pt-1">
                <HardwareReturnSections
                  value={hardwareForm}
                  readOnly={!canEditHardware}
                  compact
                  onChange={(next) => {
                    setHardwareForm(next);
                    setHardwareDirty(true);
                  }}
                />
                {canEditHardware ? (
                  <Button
                    type="button"
                    className="w-full font-bold"
                    disabled={!hardwareDirty || savingHardware}
                    onClick={() => void saveHardware()}
                  >
                    {savingHardware ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                    Hardware-Daten speichern
                  </Button>
                ) : null}
              </section>
            ) : null}

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
                  {isClientAdmin || isOrgWide ? (
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
          </div>
        </aside>
      </div>
    </div>
  );
}

function PropRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-slate-50">
      <span className="text-[11px] font-semibold text-slate-500 shrink-0 pt-0.5">{label}</span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}
