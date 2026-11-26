/**
 * Kunden-Portal ticket detail — full Hubcom workspace tabs + Eigenschaften.
 * Data exclusively via TicketDetailWorkbenchAdapter → /api/portal/tickets*.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  BookOpen,
  CheckSquare,
  ChevronLeft,
  Clock,
  Loader2,
  MessageSquare,
  NotebookPen,
  Paperclip,
  Plus,
  Sparkles,
  Ticket,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { RichTextEditor } from '../RichTextEditor';
import { ConversationTimeline } from '../ticket-details/ConversationTimeline';
import { cn, getInitials, safeString } from '../../lib/utils';
import { formatTicketCode } from '../../lib/ticketMerge';
import { useClientPortalSession } from '../../hooks/useClientPortalSession';
import type { Message, Ticket as TicketType, TicketStatus } from '../../types';
import type { PortalTicketAttachment } from '../../services/clientPortalApi';
import type {
  PortalTicketDetailPayload,
  TicketDetailWorkbenchAdapter,
  TicketDetailWorkbenchCapabilities,
} from '../../lib/tickets/ticket-detail-workbench-adapter';

type DetailTab =
  | 'conversation'
  | 'customer'
  | 'timeline'
  | 'ai_insights'
  | 'assets'
  | 'related_tickets'
  | 'tasks'
  | 'time';

const TAB_DEFS: Array<{ id: DetailTab; label: string; cap?: keyof TicketDetailWorkbenchCapabilities }> = [
  { id: 'conversation', label: 'Übersicht' },
  { id: 'customer', label: 'Kunde', cap: 'tabCustomer' },
  { id: 'timeline', label: 'Verlauf', cap: 'tabTimeline' },
  { id: 'ai_insights', label: 'KI-Erkenntnisse', cap: 'tabAiInsights' },
  { id: 'assets', label: 'Assets', cap: 'tabAssets' },
  { id: 'related_tickets', label: 'Neuronale Verknüpfungen', cap: 'tabRelatedTickets' },
  { id: 'tasks', label: 'Aufgaben', cap: 'tabTasks' },
  { id: 'time', label: 'Zeiterfassung', cap: 'tabTime' },
];

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
        : m.senderType === 'internal' || m.is_internal === true || m.isInternal === true
          ? 'agent'
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
      <div className="min-w-0 text-right w-full max-w-[180px]">{children}</div>
    </div>
  );
}

function FieldSelect({
  value,
  disabled,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select
      className="w-full h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 disabled:bg-slate-50 disabled:text-slate-500"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function PortalTicketDetailWorkspace({
  ticketId,
  adapter,
  capabilities,
}: {
  ticketId: string;
  adapter: TicketDetailWorkbenchAdapter;
  capabilities: TicketDetailWorkbenchCapabilities;
}) {
  const { session, isOrgWide, isClientAdmin } = useClientPortalSession();

  const [ticket, setTicket] = useState<TicketType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [rawMessages, setRawMessages] = useState<any[]>([]);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [members, setMembers] = useState<
    Array<{ id: string; name: string; email: string; role: string }>
  >([]);
  const [workspace, setWorkspace] = useState<Pick<
    PortalTicketDetailPayload,
    | 'customer'
    | 'verlauf'
    | 'aiInsights'
    | 'assets'
    | 'neuralLinks'
    | 'tasks'
    | 'timeEntries'
    | 'timeSummary'
    | 'meta'
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [attachments, setAttachments] = useState<PortalTicketAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [composerMode, setComposerMode] = useState<'public' | 'internal'>('public');
  const [addUserId, setAddUserId] = useState('');
  const [isMobilePropertiesOpen, setIsMobilePropertiesOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('conversation');
  const [notesExpanded, setNotesExpanded] = useState(true);
  const [aiSyncing, setAiSyncing] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [timeHours, setTimeHours] = useState('1');
  const [timeDesc, setTimeDesc] = useState('');
  const [timeBusy, setTimeBusy] = useState(false);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const canManageParticipants = capabilities.canManageParticipants || isOrgWide;
  const canMarkClosed = capabilities.canMarkClosed || isClientAdmin || isOrgWide;
  const canEdit = capabilities.canEditProperties === true;
  const meta = workspace?.meta;
  const agents = meta?.agents || [];

  const visibleTabs = TAB_DEFS.filter((t) => !t.cap || capabilities[t.cap] === true);

  const refresh = useCallback(async () => {
    if (!ticketId || !adapter.getDetail) return;
    setLoading(true);
    try {
      const detail = await adapter.getDetail(ticketId);
      setTicket(detail.ticket);
      setRawMessages(detail.messages || []);
      setMessages(mapPortalMessagesToTimeline(detail.messages));
      setParticipantIds((detail.participants || []).map((p) => p.user_id));
      setMembers(detail.members || []);
      setWorkspace({
        customer: detail.customer,
        verlauf: detail.verlauf || [],
        aiInsights: detail.aiInsights,
        assets: detail.assets || [],
        neuralLinks: detail.neuralLinks || [],
        tasks: detail.tasks || [],
        timeEntries: detail.timeEntries || [],
        timeSummary: detail.timeSummary,
        meta: detail.meta,
      });
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

  const patchFields = async (patch: Parameters<NonNullable<TicketDetailWorkbenchAdapter['updateFields']>>[1]) => {
    if (!ticketId || !adapter.updateFields) return;
    try {
      const updated = await adapter.updateFields(ticketId, patch);
      if (updated) setTicket(updated);
      else await refresh();
      toast.success('Eigenschaften gespeichert.');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Update fehlgeschlagen');
    }
  };

  const sendReply = async () => {
    if (!session || !ticketId || !adapter.reply) return;
    if (!replyText.trim() || replyText === '<p><br></p>') {
      toast.error('Antwort darf nicht leer sein.');
      return;
    }
    const isInternal = composerMode === 'internal' && capabilities.internalNotes;
    setSending(true);
    try {
      await adapter.reply(ticketId, {
        content: replyText,
        senderName: session.name || session.email,
        attachments: isInternal ? [] : attachments,
        is_internal: isInternal,
      });
      setReplyText('');
      setAttachments([]);
      toast.success(isInternal ? 'Interne Notiz gespeichert.' : 'Antwort gesendet.');
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

  const runAiSync = async () => {
    if (!ticketId || !adapter.aiSync || !capabilities.aiSync) return;
    setAiSyncing(true);
    try {
      const result = await adapter.aiSync(ticketId, { forceRefresh: true });
      if (result.ticket) setTicket(result.ticket);
      setWorkspace((prev) =>
        prev
          ? { ...prev, aiInsights: result.aiInsights || prev.aiInsights }
          : prev,
      );
      toast.success('KI-Sync abgeschlossen.');
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'KI-Sync fehlgeschlagen');
    } finally {
      setAiSyncing(false);
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

  const internalNotesFromMessages = useMemo(
    () =>
      (rawMessages || []).filter(
        (m) => m.is_internal === true || m.isInternal === true || m.senderType === 'internal',
      ),
    [rawMessages],
  );

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
  const assigneeId = String(
    (ticket as any).assigneeId || (ticket as any).assignee_id || ticket.agentId || '',
  );
  const assigneeName =
    agents.find((a) => a.id === assigneeId)?.name ||
    safeString(ticket.agentName) ||
    (assigneeId ? 'Zugewiesen' : 'Nicht zugewiesen');

  const statusOptions = (meta?.statuses || []).map((s) => ({
    value: String(s.key || s.id),
    label: String(s.name || s.key || s.id),
  }));
  const priorityOptions = (meta?.priorities || []).map((p) => ({
    value: String(p.key || p.id),
    label: String(p.name || p.key || p.id),
  }));
  const categoryOptions = (meta?.categories || []).map((c) => ({
    value: String(c.id),
    label: String(c.name || c.id),
  }));
  const typeOptions = (meta?.ticket_types || []).map((t) => ({
    value: String(t.key || t.id),
    label: String(t.name || t.key || t.id),
  }));
  const agentOptions = agents.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.role === 'CLIENT_ADMIN' ? 'Admin' : 'Supporter'})`,
  }));

  const suggestedReply =
    workspace?.aiInsights?.suggestedReply ||
    (ticket as any).suggested_reply ||
    (ticket as any).aiSuggestedDraft ||
    '';
  const aiSummary =
    workspace?.aiInsights?.summary || (ticket as any).aiSummary || (ticket as any).ai_summary || '';
  const aiInsightsList = Array.isArray(workspace?.aiInsights?.insights)
    ? workspace!.aiInsights!.insights!
    : Array.isArray((ticket as any).aiInsights)
      ? ((ticket as any).aiInsights as unknown[])
      : [];

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full flex flex-row overflow-hidden relative">
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-slate-50">
        <div className="flex flex-col gap-1.5 w-full min-w-0 px-4 md:px-6 pt-3 md:pt-4 pb-3 border-b border-slate-100 bg-white shrink-0">
          <div className="flex w-full min-w-0 items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => adapter.openBack()}
                aria-label="Zurück zur Ticketliste"
                className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer transition-colors shrink-0 mt-0.5"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-snug min-w-0 break-words">
                  {safeString(ticket.subject)}
                </h2>
                <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap leading-none text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">{status}</span>
                  <span>•</span>
                  <span>{safeString(ticket.priority) || '—'}</span>
                  <span>•</span>
                  <span className="font-mono tabular-nums text-slate-600 font-semibold">{ticketRef}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
              {capabilities.aiSync ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  disabled={aiSyncing}
                  onClick={() => void runAiSync()}
                >
                  {aiSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  KI-Sync
                </Button>
              ) : null}
              {capabilities.convertToKb ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => adapter.openConvertToKb?.(ticket)}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  In KB
                </Button>
              ) : null}
              {capabilities.internalNotes ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => {
                    setActiveTab('conversation');
                    setComposerMode('internal');
                    setTimeout(() => {
                      document.getElementById('portal-public-reply-composer')?.scrollIntoView({
                        behavior: 'smooth',
                      });
                    }, 50);
                  }}
                >
                  <NotebookPen className="w-3.5 h-3.5" />
                  Notiz
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs lg:hidden"
                onClick={() => setIsMobilePropertiesOpen((v) => !v)}
              >
                Eigenschaften
              </Button>
            </div>
          </div>
        </div>

        <div className="px-6 border-b border-slate-100 bg-white shrink-0 flex items-center h-[48px] select-none">
          <div className="flex items-center gap-1 h-full overflow-x-auto custom-scrollbar">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'h-full px-4 text-xs border-b-2 transition-all shrink-0 flex items-center gap-2 relative',
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 font-semibold'
                    : 'border-transparent text-slate-500 font-medium hover:text-slate-800',
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <div className="w-full space-y-4 pb-12">
            {activeTab === 'conversation' ? (
              <div className="space-y-4">
                {capabilities.aiSummaryCard && aiSummary ? (
                  <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs uppercase tracking-wider mb-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      KI-Orchestrator Detailanalyse
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">{String(aiSummary)}</p>
                    {suggestedReply ? (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                          KI-vorgeschlagene Strategie
                        </p>
                        <p className="text-sm text-slate-700">{String(suggestedReply)}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 text-xs"
                          onClick={() => {
                            setComposerMode('public');
                            setReplyText(String(suggestedReply));
                          }}
                        >
                          In Antwort übernehmen
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {capabilities.internalNotes ? (
                  <div className="bg-amber-50/15 border border-amber-200/40 rounded-2xl overflow-hidden shadow-sm">
                    <button
                      type="button"
                      onClick={() => setNotesExpanded((v) => !v)}
                      className="w-full flex items-center justify-between p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center border border-amber-200 text-amber-800">
                          <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-800">
                            Interne Agenten-Arbeitsplatz-Notizen
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {internalNotesFromMessages.length} Notiz(en)
                          </p>
                        </div>
                      </div>
                    </button>
                    {notesExpanded ? (
                      <div className="px-4 pb-4 space-y-2">
                        {internalNotesFromMessages.length === 0 ? (
                          <p className="text-xs text-slate-400">Noch keine internen Notizen.</p>
                        ) : (
                          internalNotesFromMessages.map((n) => (
                            <div
                              key={String(n.id)}
                              className="rounded-xl border border-amber-100 bg-white/70 p-3 text-sm text-slate-700"
                            >
                              <p className="text-[10px] font-bold text-amber-700 mb-1">
                                {String(n.senderName || 'Intern')} ·{' '}
                                {String(n.createdAt || n.created_at || '')}
                              </p>
                              <div
                                className="prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{
                                  __html: String(n.content || n.html_content || ''),
                                }}
                              />
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <ConversationTimeline
                  ticket={ticket}
                  messages={messages.filter(
                    (m) =>
                      !rawMessages.find(
                        (r) =>
                          String(r.id) === m.id &&
                          (r.is_internal === true || r.isInternal === true),
                      ),
                  )}
                  agentComments={[]}
                  onReplyClick={() => {
                    document.getElementById('portal-public-reply-composer')?.scrollIntoView({
                      behavior: 'smooth',
                    });
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
                      <button
                        type="button"
                        className={cn(
                          'h-8 px-3 text-xs border-b-2 inline-flex items-center font-semibold',
                          composerMode === 'public'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500',
                        )}
                        onClick={() => setComposerMode('public')}
                      >
                        Öffentliche Antwort
                      </button>
                      {capabilities.internalNotes ? (
                        <button
                          type="button"
                          className={cn(
                            'h-8 px-3 text-xs border-b-2 inline-flex items-center font-semibold',
                            composerMode === 'internal'
                              ? 'border-amber-600 text-amber-700'
                              : 'border-transparent text-slate-500',
                          )}
                          onClick={() => setComposerMode('internal')}
                        >
                          Interne Notiz
                        </button>
                      ) : null}
                    </div>
                    <div className="bg-card border border-border rounded-2xl shadow-md p-4 space-y-3">
                      <RichTextEditor
                        value={replyText}
                        onChange={setReplyText}
                        placeholder={
                          composerMode === 'internal'
                            ? 'Interne Notiz schreiben…'
                            : 'Antwort schreiben…'
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {composerMode === 'public' ? (
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
                        ) : null}
                        {attachments.map((a) => (
                          <span
                            key={a.filename}
                            className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px]"
                          >
                            {a.filename}
                            <button
                              type="button"
                              onClick={() =>
                                setAttachments((prev) =>
                                  prev.filter((x) => x.filename !== a.filename),
                                )
                              }
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <Button
                          type="button"
                          className={cn(
                            'ml-auto h-9 text-white font-bold',
                            composerMode === 'internal'
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-blue-600 hover:bg-blue-700',
                          )}
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
            ) : null}

            {activeTab === 'customer' && capabilities.tabCustomer ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Kunde</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Name</dt>
                    <dd>{String(workspace?.customer?.name || creatorName || '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">E-Mail</dt>
                    <dd>{String(workspace?.customer?.email || ticket.customerEmail || '—')}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">Organisation</dt>
                    <dd>
                      {String(
                        (workspace?.customer?.organization as any)?.name ||
                          ticket.company ||
                          '—',
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">SLA / Tier</dt>
                    <dd>
                      {String(
                        (workspace?.customer?.organization as any)?.sla ||
                          (workspace?.customer?.organization as any)?.tier ||
                          (ticket as any).slaTier ||
                          '—',
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {activeTab === 'timeline' && capabilities.tabTimeline ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Verlauf</h3>
                {(workspace?.verlauf || []).length === 0 ? (
                  <p className="text-sm text-slate-400">Kein Verlauf vorhanden.</p>
                ) : (
                  <ol className="space-y-3">
                    {(workspace?.verlauf || []).map((ev) => (
                      <li
                        key={String(ev.id || ev.at)}
                        className="flex gap-3 border-l-2 border-slate-200 pl-3"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-800">
                            {String(ev.label || ev.kind || 'Ereignis')}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {String(ev.at || '')}
                            {ev.actor ? ` · ${String(ev.actor)}` : ''}
                          </p>
                          {ev.contentPreview ? (
                            <p className="text-sm text-slate-600 mt-1">
                              {String(ev.contentPreview)}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}

            {activeTab === 'ai_insights' && capabilities.tabAiInsights ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900">KI-Erkenntnisse</h3>
                  {capabilities.aiSync ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      disabled={aiSyncing}
                      onClick={() => void runAiSync()}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Aktualisieren
                    </Button>
                  ) : null}
                </div>
                <p className="text-sm text-slate-700">{String(aiSummary || 'Noch keine Analyse.')}</p>
                {aiInsightsList.length > 0 ? (
                  <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                    {aiInsightsList.map((line, i) => (
                      <li key={i}>{String(line)}</li>
                    ))}
                  </ul>
                ) : null}
                {workspace?.aiInsights?.rootCause ? (
                  <p className="text-sm">
                    <span className="font-bold text-slate-800">Ursache: </span>
                    {String(workspace.aiInsights.rootCause)}
                  </p>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'assets' && capabilities.tabAssets ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Assets</h3>
                {(workspace?.assets || []).length === 0 ? (
                  <p className="text-sm text-slate-400">Keine verknüpften Assets.</p>
                ) : (
                  <ul className="space-y-2">
                    {(workspace?.assets || []).map((a) => (
                      <li
                        key={String(a.id)}
                        className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                      >
                        <p className="font-semibold text-slate-800">{String(a.name || a.id)}</p>
                        <p className="text-[11px] text-slate-500">{String(a.type || '')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === 'related_tickets' && capabilities.tabRelatedTickets ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Neuronale Verknüpfungen</h3>
                {(workspace?.neuralLinks || []).length === 0 ? (
                  <p className="text-sm text-slate-400">Keine verknüpften Tickets.</p>
                ) : (
                  <ul className="space-y-2">
                    {(workspace?.neuralLinks || []).map((link) => (
                      <li
                        key={String(link.id)}
                        className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                      >
                        <p className="font-semibold text-slate-800">
                          {String(link.customId || link.id)} — {String(link.subject || '')}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {String(link.status || '')} · {String(link.priority || '')}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === 'tasks' && capabilities.tabTasks ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" /> Aufgaben
                </h3>
                <ul className="space-y-2">
                  {(workspace?.tasks || []).map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(task.completed)}
                        disabled={!canEdit && !capabilities.canUpdateStatus}
                        onChange={(e) => {
                          void (async () => {
                            if (!adapter.updateTask) return;
                            const tasks = await adapter.updateTask(ticketId, task.id, {
                              completed: e.target.checked,
                            });
                            setWorkspace((prev) => (prev ? { ...prev, tasks } : prev));
                          })();
                        }}
                      />
                      <span
                        className={cn(
                          'flex-1 text-sm',
                          task.completed ? 'line-through text-slate-400' : 'text-slate-800',
                        )}
                      >
                        {task.task}
                      </span>
                      {canEdit ? (
                        <button
                          type="button"
                          className="text-slate-400 hover:text-rose-600"
                          onClick={() => {
                            void (async () => {
                              if (!adapter.deleteTask) return;
                              const tasks = await adapter.deleteTask(ticketId, task.id);
                              setWorkspace((prev) => (prev ? { ...prev, tasks } : prev));
                            })();
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <div className="flex gap-2">
                    <input
                      className="flex-1 h-9 rounded-md border border-slate-200 px-3 text-sm"
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      placeholder="Neue Aufgabe…"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9"
                      disabled={!newTask.trim()}
                      onClick={() => {
                        void (async () => {
                          if (!adapter.addTask || !newTask.trim()) return;
                          const tasks = await adapter.addTask(ticketId, newTask.trim());
                          setNewTask('');
                          setWorkspace((prev) => (prev ? { ...prev, tasks } : prev));
                        })();
                      }}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === 'time' && capabilities.tabTime ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Zeiterfassung
                </h3>
                <p className="text-xs text-slate-500">
                  Summe: {Number(workspace?.timeSummary?.totalHours || 0).toFixed(2)} h
                </p>
                <ul className="space-y-2">
                  {(workspace?.timeEntries || []).map((entry) => (
                    <li
                      key={String(entry.id)}
                      className="rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <p className="font-semibold text-slate-800">
                        {Number(entry.hours || 0)} h · {String(entry.kuerzel || '')}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {String(entry.date || '')} · {String(entry.description || '')}
                      </p>
                    </li>
                  ))}
                </ul>
                {canEdit ? (
                  <div className="grid grid-cols-1 sm:grid-cols-[80px_1fr_auto] gap-2 pt-2">
                    <input
                      className="h-9 rounded-md border border-slate-200 px-2 text-sm"
                      value={timeHours}
                      onChange={(e) => setTimeHours(e.target.value)}
                      placeholder="Std"
                    />
                    <input
                      className="h-9 rounded-md border border-slate-200 px-3 text-sm"
                      value={timeDesc}
                      onChange={(e) => setTimeDesc(e.target.value)}
                      placeholder="Beschreibung"
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9"
                      disabled={timeBusy}
                      onClick={() => {
                        void (async () => {
                          if (!adapter.addTimeEntry) return;
                          const hours = Number(timeHours);
                          if (!(hours > 0)) {
                            toast.error('Stunden müssen größer als 0 sein.');
                            return;
                          }
                          setTimeBusy(true);
                          try {
                            await adapter.addTimeEntry(ticketId, {
                              hours,
                              description: timeDesc,
                            });
                            setTimeDesc('');
                            toast.success('Zeiteintrag gespeichert.');
                            await refresh();
                          } catch (err: any) {
                            toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
                          } finally {
                            setTimeBusy(false);
                          }
                        })();
                      }}
                    >
                      Buchen
                    </Button>
                  </div>
                ) : null}
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
            isMobilePropertiesOpen ? 'absolute inset-y-0 right-0 z-30 shadow-xl' : 'hidden lg:block',
          )}
        >
          <div className="p-4 space-y-5">
            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Eigenschaften
              </h3>

              <PropRow label="AGENTEN-ZUWEISUNG">
                {canEdit && capabilities.canEditAssignee ? (
                  <FieldSelect
                    value={assigneeId}
                    placeholder="AGENTEN AUSWÄHLEN"
                    options={agentOptions}
                    onChange={(v) => void patchFields({ assignee_id: v || null })}
                  />
                ) : (
                  <div className="flex items-center gap-2 min-w-0 justify-end">
                    <div className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-[9px] font-bold">
                      {getInitials(assigneeName)}
                    </div>
                    <span className="text-sm text-slate-800 truncate">{assigneeName}</span>
                  </div>
                )}
              </PropRow>

              <PropRow label="PRIORITÄT">
                {canEdit && capabilities.canUpdatePriority ? (
                  <FieldSelect
                    value={String(ticket.priority || '')}
                    options={
                      priorityOptions.length
                        ? priorityOptions
                        : [
                            { value: 'low', label: 'Niedrig' },
                            { value: 'medium', label: 'Mittel' },
                            { value: 'high', label: 'Hoch' },
                            { value: 'urgent', label: 'Dringend' },
                          ]
                    }
                    onChange={(v) => void patchFields({ priority: v as any })}
                  />
                ) : (
                  <span className="text-sm text-slate-800">{safeString(ticket.priority) || '—'}</span>
                )}
              </PropRow>

              <PropRow label="FALLSTATUS">
                {canEdit && capabilities.canUpdateStatus ? (
                  <FieldSelect
                    value={String(ticket.status || '')}
                    options={
                      statusOptions.length
                        ? statusOptions
                        : [
                            { value: 'open', label: 'Offen' },
                            { value: 'in_progress', label: 'In Bearbeitung' },
                            { value: 'waiting_customer', label: 'Wartend' },
                            { value: 'resolved', label: 'Gelöst' },
                            { value: 'closed', label: 'Geschlossen' },
                          ]
                    }
                    onChange={(v) => void patchFields({ status: v as TicketStatus })}
                  />
                ) : (
                  <span className="text-sm text-slate-800">{status}</span>
                )}
              </PropRow>

              <PropRow label="KATEGORIE">
                {canEdit ? (
                  <FieldSelect
                    value={String((ticket as any).categoryId || '')}
                    placeholder="Kategorie wählen"
                    options={categoryOptions}
                    onChange={(v) => {
                      const cat = (meta?.categories || []).find((c) => String(c.id) === v);
                      void patchFields({
                        categoryId: v || null,
                        category: cat ? String(cat.name) : null,
                      });
                    }}
                  />
                ) : (
                  <span className="text-sm text-slate-800">
                    {safeString(ticket.categoryName) || '—'}
                  </span>
                )}
              </PropRow>

              <PropRow label="TICKETTYP">
                {canEdit ? (
                  <FieldSelect
                    value={String((ticket as any).ticket_type || ticket.type || '')}
                    placeholder="Typ wählen"
                    options={
                      typeOptions.length
                        ? typeOptions
                        : [
                            { value: 'incident', label: 'Vorfall (Incident)' },
                            { value: 'question', label: 'Frage' },
                            { value: 'problem', label: 'Problem' },
                            { value: 'feature_request', label: 'Feature' },
                          ]
                    }
                    onChange={(v) => void patchFields({ ticket_type: v || null, type: v || null })}
                  />
                ) : (
                  <span className="text-sm text-slate-800">
                    {String((ticket as any).ticket_type || ticket.type || '—')}
                  </span>
                )}
              </PropRow>
            </section>

            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                SLA-Hilfeeskalaation
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full h-8 text-xs"
                disabled={!canEdit}
                onClick={() => void patchFields({ escalated: true })}
              >
                Hilfe anfordern
              </Button>
            </section>

            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                Support & Konto
              </h3>
              <PropRow label="SLA-STUFE">
                {canEdit ? (
                  <FieldSelect
                    value={String((ticket as any).slaTier || (ticket as any).sla_tier || '')}
                    placeholder="Stufe wählen"
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'gold', label: 'Gold' },
                      { value: 'platinum', label: 'Platinum' },
                    ]}
                    onChange={(v) => void patchFields({ sla_tier: v || null })}
                  />
                ) : (
                  <span className="text-sm text-slate-800">
                    {String((ticket as any).slaTier || (ticket as any).sla_tier || '—')}
                  </span>
                )}
              </PropRow>
              <PropRow label="KONTOGESUNDHEIT">
                {canEdit ? (
                  <FieldSelect
                    value={String(
                      (ticket as any).accountHealth || (ticket as any).account_health || '',
                    )}
                    placeholder="Status"
                    options={[
                      { value: 'good', label: 'Gut' },
                      { value: 'at_risk', label: 'Gefährdet' },
                      { value: 'bad', label: 'Kritisch' },
                    ]}
                    onChange={(v) => void patchFields({ account_health: v || null })}
                  />
                ) : (
                  <span className="text-sm text-slate-800">
                    {String(
                      (ticket as any).accountHealth || (ticket as any).account_health || '—',
                    )}
                  </span>
                )}
              </PropRow>
            </section>

            <section className="space-y-2">
              <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                KI-Copilot
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Vorgeschlagene KI-Strategie
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {String(suggestedReply || 'Noch kein Vorschlag — KI-Sync ausführen.')}
              </p>
            </section>

            <PropRow label="Ersteller">
              <div className="flex items-center gap-2 min-w-0 justify-end">
                <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[9px] font-bold">
                  {getInitials(creatorName)}
                </div>
                <span className="text-sm text-slate-800 truncate">{creatorName}</span>
              </div>
            </PropRow>

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
