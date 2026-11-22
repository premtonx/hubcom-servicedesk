import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Loader2,
  Paperclip,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { sanitizeTimelineHtml } from '../../lib/sanitize-html';
import {
  fileToPortalAttachment,
  portalService,
  type PortalAttachment,
  type PortalMessage,
  type PortalTicket,
} from '../../services/portalService';
import {
  portalPriorityLabel,
  portalStatusLabel,
} from '../../lib/portal/status';
import {
  formatPortalDate,
  portalPriorityBadgeClass,
  portalStatusBadgeClass,
  ticketNumberLabel,
} from './portalUi';
import { cn } from '../../lib/utils';

const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

export function PortalTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await portalService.getTicket(id);
      setTicket(data.ticket);
      setMessages(data.messages || []);
    } catch (err: any) {
      toast.error(err?.message || 'Ticket nicht gefunden');
      navigate('/portal', { replace: true });
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) {
        toast.error(`Maximal ${MAX_FILES} Dateien.`);
        break;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`„${file.name}“ ist größer als 5 MB.`);
        continue;
      }
      next.push(file);
    }
    setFiles(next);
  };

  const handleReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !reply.trim()) {
      toast.error('Bitte eine Nachricht eingeben.');
      return;
    }
    setSending(true);
    try {
      let attachments: PortalAttachment[] = [];
      if (files.length > 0) {
        attachments = await Promise.all(files.map(fileToPortalAttachment));
      }
      const result = await portalService.reply(id, {
        content: reply.trim(),
        attachments,
      });
      setMessages((prev) => [...prev, result.message]);
      setTicket(result.ticket);
      setReply('');
      setFiles([]);
      toast.success(
        String(result.status).toLowerCase() === 'open' &&
          ticket &&
          String(ticket.status).toLowerCase() === 'waiting_customer'
          ? 'Antwort gesendet. Status ist wieder „Offen“.'
          : 'Antwort gesendet.',
      );
    } catch (err: any) {
      toast.error(err?.message || 'Antwort fehlgeschlagen');
    } finally {
      setSending(false);
    }
  };

  if (loading || !ticket) {
    return (
      <div className="p-16 flex items-center justify-center gap-2 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Ticket wird geladen…
      </div>
    );
  }

  const openingAttachments = ticket.attachments || [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/portal"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#1B6CA8]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Zurück zur Übersicht
        </Link>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-bold text-slate-400">
              {ticketNumberLabel(ticket)}
            </span>
            <span className={portalStatusBadgeClass(ticket.status)}>
              {portalStatusLabel(ticket.status)}
            </span>
            <span className={portalPriorityBadgeClass(ticket.priority)}>
              {portalPriorityLabel(ticket.priority)}
            </span>
            {ticket.categoryName ? (
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-0.5">
                {ticket.categoryName}
              </span>
            ) : null}
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            {ticket.subject}
          </h1>
          <p className="text-xs text-slate-500">
            Erstellt am {formatPortalDate(ticket.createdAt)}
            {ticket.updatedAt ? ` · Aktualisiert ${formatPortalDate(ticket.updatedAt)}` : ''}
          </p>
        </div>
      </div>

      {/* Conversation */}
      <div className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400">
          Nachrichtenverlauf
        </h2>

        {/* Opening description */}
        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-sky-50 border border-sky-100 flex items-center justify-center">
              <UserRound className="w-4 h-4 text-sky-700" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {ticket.customerName || 'Sie'}
              </p>
              <p className="text-[11px] text-slate-400">
                Erstmeldung · {formatPortalDate(ticket.createdAt)}
              </p>
            </div>
          </div>
          <div
            className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: sanitizeTimelineHtml(ticket.html_content || ticket.description || ''),
            }}
          />
          {openingAttachments.length > 0 ? (
            <AttachmentList attachments={openingAttachments} />
          ) : null}
        </article>

        {messages.map((msg) => {
          const isCustomer = msg.senderType === 'customer';
          // Skip duplicate of opening if same content was stored as first message with attachments
          if (
            isCustomer &&
            openingAttachments.length > 0 &&
            msg.content === ticket.description &&
            msg.attachments?.length
          ) {
            return null;
          }
          return (
            <article
              key={msg.id}
              className={cn(
                'rounded-2xl border p-4 shadow-sm space-y-3',
                isCustomer
                  ? 'border-slate-200 bg-white'
                  : 'border-sky-100 bg-sky-50/40',
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full border flex items-center justify-center',
                    isCustomer
                      ? 'bg-sky-50 border-sky-100'
                      : 'bg-[#0B1F3A] border-[#0B1F3A]',
                  )}
                >
                  <UserRound
                    className={cn('w-4 h-4', isCustomer ? 'text-sky-700' : 'text-white')}
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {isCustomer ? msg.senderName || 'Sie' : msg.senderName || 'Support'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {isCustomer ? 'Ihre Nachricht' : 'Antwort vom Support'} ·{' '}
                    {formatPortalDate(msg.createdAt)}
                  </p>
                </div>
              </div>
              <div
                className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: sanitizeTimelineHtml(msg.html_content || msg.content || ''),
                }}
              />
              {msg.attachments?.length ? <AttachmentList attachments={msg.attachments} /> : null}
            </article>
          );
        })}
      </div>

      {/* Reply form */}
      <form
        onSubmit={handleReply}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3"
      >
        <h2 className="text-sm font-bold text-slate-900">Antworten</h2>
        {String(ticket.status).toLowerCase() === 'waiting_customer' ? (
          <p className="text-xs text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            Der Support wartet auf Ihre Rückmeldung. Mit dem Absenden wird der Status wieder auf
            „Offen“ gesetzt.
          </p>
        ) : null}
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Ihre Nachricht an den Support…"
          className="min-h-[120px] rounded-xl"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 cursor-pointer hover:bg-slate-50">
            <Paperclip className="w-3.5 h-3.5" />
            Datei anhängen
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          {files.map((file, idx) => (
            <span
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1 rounded-md bg-slate-50 border border-slate-200 px-2 py-1 text-[11px] font-medium"
            >
              {file.name}
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                aria-label="entfernen"
              >
                <X className="w-3 h-3 text-slate-400" />
              </button>
            </span>
          ))}
          <Button type="submit" disabled={sending} className="ml-auto gap-1.5 font-bold">
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Absenden
          </Button>
        </div>
      </form>
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: PortalAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {attachments.map((att, idx) => {
        const href =
          att.contentBase64 && !att.omitted
            ? `data:${att.contentType};base64,${att.contentBase64}`
            : undefined;
        const inner = (
          <>
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate max-w-[200px]">{att.filename}</span>
            {att.omitted ? (
              <span className="text-[10px] text-amber-600">nicht verfügbar</span>
            ) : null}
          </>
        );
        return href ? (
          <a
            key={`${att.filename}-${idx}`}
            href={href}
            download={att.filename}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-[#1B6CA8]"
          >
            {inner}
          </a>
        ) : (
          <span
            key={`${att.filename}-${idx}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}

export default PortalTicketDetailPage;
