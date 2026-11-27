import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../lib/context/I18nContext';
import { getInitials, safeString } from '../../lib/utils';
import { 
  ShieldCheck, 
  AlertCircle, 
  UserRound, 
  Mail,
  Copy,
  Paperclip,
  FileText,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Ticket as TicketType, Message, AgentComment } from '../../types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

interface ConversationTimelineProps {
  ticket: TicketType;
  messages: Message[];
  agentComments: AgentComment[];
  onReplyClick: () => void;
  onQuoteClick: (text: string) => void;
  onInternalNoteAction: () => void;
  onAddAgentComment: (text: string) => void;
  isTranslating: boolean;
  translatedTicket: { subject: string; description: string } | null;
  /** Scroll + brief highlight after a successful outbound reply. */
  highlightMessageId?: string | null;
}

import { sanitizeTimelineHtml } from '../../lib/sanitize-html';

const SIGNATURE_SPLIT_RE =
  /(<div[^>]*class=["'][^"']*(?:gmail_signature|Signature|moz-signature)[^"']*["'][^>]*>[\s\S]*$)|(<br\s*\/?>\s*(?:--|—|&mdash;)\s*(?:<br\s*\/?>|$))/i;

function splitMessageAndSignature(html: string): { body: string; signature: string | null } {
  const raw = String(html || '');
  if (!raw.trim()) return { body: raw, signature: null };
  const match = SIGNATURE_SPLIT_RE.exec(raw);
  if (!match || match.index == null || match.index < 40) {
    return { body: raw, signature: null };
  }
  return {
    body: raw.slice(0, match.index).trim(),
    signature: raw.slice(match.index).trim(),
  };
}

function MessageHtmlBody({
  html,
  translating,
}: {
  html: string;
  translating?: boolean;
}) {
  const { t } = useTranslation();
  const [showSig, setShowSig] = useState(false);
  const { body, signature } = useMemo(() => splitMessageAndSignature(html), [html]);
  if (translating) {
    return (
      <p className="italic text-muted-foreground animate-pulse">Translating message content...</p>
    );
  }
  return (
    <div className="space-y-2">
      <div
        className="select-text cursor-text max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitizeTimelineHtml(body) }}
      />
      {signature ? (
        <div>
          {!showSig ? (
            <button
              type="button"
              className="text-[11px] font-semibold text-slate-400 hover:text-slate-600"
              onClick={() => setShowSig(true)}
            >
              {t('tickets.conversation.showSignature', '… Signatur anzeigen')}
            </button>
          ) : (
            <div
              className="select-text cursor-text max-w-none text-muted-foreground border-t border-slate-100 pt-2"
              dangerouslySetInnerHTML={{ __html: sanitizeTimelineHtml(signature) }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationTimeline({
  ticket,
  messages,
  agentComments,
  onReplyClick,
  onQuoteClick,
  onInternalNoteAction,
  onAddAgentComment,
  isTranslating,
  translatedTicket,
  highlightMessageId = null,
}: ConversationTimelineProps) {
  const { t } = useTranslation();
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!highlightMessageId) return;
    const el = highlightRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightMessageId]);

  // We compile all chronological timeline items, beginning with the opening post.
  const timelineItems = useMemo(() => {
    // 1. Initial ticket description post as the first Customer post
    const items: Array<{
      id: string;
      senderName: string;
      senderType: 'customer' | 'bot' | 'agent' | 'ai';
      createdAt: any;
      content: string;
      html_content?: string;
      channel: string;
      deliveryStatus?: Message['deliveryStatus'];
      attachments?: Message['attachments'];
      fromAddress?: string | null;
      toAddress?: string | null;
      cc?: string[] | null;
    }> = [
      {
        id: 'opening-post',
        senderName: safeString(ticket.customerName, 'Kunde'),
        senderType: 'customer',
        createdAt: ticket.createdAt,
        content: translatedTicket?.description || ticket.description,
        html_content: ticket.html_content,
        channel: 'via E-Mail',
        attachments: undefined,
        fromAddress: ticket.customerEmail || ticket.from_email || null,
        toAddress: ticket.mailbox || (ticket as any).supportEmail || null,
        cc: null,
      }
    ];

    // 2. Append all historical thread messages
    messages.forEach(msg => {
      // Determine senderType classification based on name or system classifications
      let isBot = msg.senderType === 'ai';
      const senderName = safeString(msg.senderName);
      if (senderName && (senderName.toLowerCase().includes('geist') || senderName.toLowerCase().includes('shield') || senderName.toLowerCase().includes('dropzone') || senderName.toLowerCase().includes('bot'))) {
        isBot = true;
      }

      const isAgentMsg = !isBot && msg.senderType !== 'customer';
      const viaEmail =
        msg.deliveryStatus === 'delivered' ||
        msg.deliveryStatus === 'saved_locally' ||
        Boolean(msg.fromAddress || msg.mailFrom || msg.toAddress);

      items.push({
        id: msg.id,
        senderName:
          senderName ||
          (msg.senderType === 'customer'
            ? t('tickets.conversation.customer', 'Kunde')
            : t('tickets.conversation.agent', 'Agent')),
        senderType: isBot ? 'bot' : (msg.senderType === 'customer' ? 'customer' : 'agent'),
        createdAt: msg.createdAt,
        content: msg.content,
        html_content: msg.html_content,
        channel: isBot
          ? 'via System'
          : isAgentMsg
            ? viaEmail
              ? 'via E-Mail'
              : 'via Web'
            : 'via E-Mail',
        deliveryStatus: msg.deliveryStatus,
        attachments: msg.attachments,
        fromAddress: msg.fromAddress || msg.mailFrom || null,
        toAddress: msg.toAddress || null,
        cc: Array.isArray(msg.cc) ? msg.cc : null,
      });
    });

    return items;
  }, [ticket, messages, translatedTicket, t]);

  return (
    <div id="conversation-timeline-redesign" className="space-y-6">
      {/* Date Header Indicator */}
      <div className="flex items-center gap-3 my-4">
        <span className="text-xs font-black text-slate-400 dark:text-slate-500 tracking-wider">TODAY</span>
        <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
      </div>

      {/* Modern Connected chronological timeline list */}
      <div className="relative pl-8 border-l border-slate-200 dark:border-slate-800 ml-4 space-y-7">
        {timelineItems.map((item, idx) => {
          const isCustomer = item.senderType === 'customer';
          const isBot = item.senderType === 'bot';
          const isAgent = item.senderType === 'agent';

          // Render distinct left circle icons following the exact mockup patterns
          let timelineIcon = <Mail className="w-4 h-4 text-blue-600" />;
          let iconBg = "bg-blue-50 border-blue-100";
          
          if (isBot) {
            timelineIcon = <ShieldCheck className="w-4 h-4 text-emerald-600" />;
            iconBg = "bg-emerald-50 border-emerald-100";
          } else if (isAgent) {
            timelineIcon = <UserRound className="w-4 h-4 text-blue-600" />;
            iconBg = "bg-blue-50 border-blue-100";
          }

          // Format timestamp nicely
          let timeDisplay = "10:24 AM";
          if (item.createdAt) {
            const dateObj = item.createdAt.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
            timeDisplay = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }

          // Initials calculation for avatar — senderName may be a non-string
          // value persisted by the generic DB layer, so never call string
          // methods on it directly.
          const initials = typeof item.senderName === 'string' && item.senderName.trim()
            ? getInitials(item.senderName)
            : isCustomer ? 'C' : isBot ? 'GE' : 'A';

          const isHighlighted = Boolean(highlightMessageId && item.id === highlightMessageId);
          const roleLabel = isBot
            ? 'Bot'
            : isCustomer
              ? t('tickets.conversation.customer', 'Kunde')
              : t('tickets.conversation.replyBadge', 'Antwort');

          return (
            <div 
              key={item.id}
              ref={isHighlighted ? highlightRef : undefined}
              className="relative group"
              onMouseEnter={() => setHoveredMessageId(item.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              {/* Left absolute timeline bullet icon */}
              <div className={cn(
                "absolute -left-[42px] top-4 w-7 h-7 rounded-full border-2 border-white dark:border-background flex items-center justify-center shadow-sm z-10",
                iconBg
              )}>
                {timelineIcon}
              </div>

              {/* Message Card frame */}
              <div className={cn(
                "bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/80 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-slate-200 dark:hover:border-slate-700 transition-all duration-200 flex gap-4",
                isAgent && "border-indigo-100/90 bg-indigo-50/20 dark:bg-indigo-950/20",
                isHighlighted && "ticket-message-highlight border-emerald-300",
              )}>
                {/* Internal Avatar inside card */}
                <Avatar className={cn(
                  "w-9 h-9 border shadow-sm shrink-0 mt-0.5",
                  isBot
                    ? "bg-emerald-50 border-emerald-100 text-emerald-800"
                    : isAgent
                      ? "bg-indigo-50 border-indigo-100 text-indigo-800"
                      : "bg-blue-50 border-blue-100 text-blue-800"
                )}>
                  <AvatarFallback className="font-extrabold text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>

                {/* Core contents column */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Card Header row: Sender name, role, timestamp, channel */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-foreground">
                        {item.senderName}
                      </span>
                      {/* Role Badge following mockup */}
                      <Badge className={cn(
                        "text-[9px] font-black uppercase px-2 py-0.5 rounded-full border-none pointer-events-none tracking-wider",
                        isCustomer
                          ? "bg-blue-100 text-blue-800"
                          : isBot
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-indigo-100 text-indigo-800"
                      )}>
                        {roleLabel}
                      </Badge>
                      <span className="text-[11px] text-slate-400 font-semibold font-mono">
                        {timeDisplay}
                      </span>
                      {item.deliveryStatus === 'saved_locally' ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold uppercase tracking-wide border-amber-200 bg-amber-50 text-amber-800 gap-1 px-1.5 py-0"
                          title={t(
                            'tickets.conversation.savedLocallyHint',
                            'Antwort wurde in der Datenbank gespeichert. Ausgehende E-Mail war nicht verfügbar.',
                          )}
                        >
                          <AlertCircle className="w-3 h-3" />
                          {t('tickets.conversation.savedLocally', 'Nur lokal gespeichert')}
                        </Badge>
                      ) : null}
                      <span className="text-[11px] text-slate-400 font-medium">
                        — {item.channel}
                      </span>
                    </div>
                  </div>

                  {(item.fromAddress || item.toAddress || (item.cc && item.cc.length > 0)) ? (
                    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-2.5 py-1.5 space-y-0.5 text-[11px] text-slate-600">
                      {item.fromAddress ? (
                        <div>
                          <span className="font-bold text-slate-500">Von:</span>{' '}
                          <span className="font-mono">{item.fromAddress}</span>
                        </div>
                      ) : null}
                      {item.toAddress ? (
                        <div>
                          <span className="font-bold text-slate-500">An:</span>{' '}
                          <span className="font-mono">{item.toAddress}</span>
                        </div>
                      ) : null}
                      {item.cc && item.cc.length > 0 ? (
                        <div>
                          <span className="font-bold text-slate-500">CC:</span>{' '}
                          <span className="font-mono">{item.cc.join(', ')}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="font-sans text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed break-words [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_a]:underline [&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-200 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:font-sans [&_pre]:text-sm [&_pre]:whitespace-pre-wrap [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:m-0">
                    <MessageHtmlBody
                      html={item.html_content || item.content || ''}
                      translating={isTranslating && item.id === 'opening-post'}
                    />
                  </div>

                  {item.attachments && item.attachments.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                        <Paperclip className="w-3 h-3" />
                        {t('tickets.conversation.attachments', 'Attachments')}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {item.attachments.map((att, attIdx) => (
                          <div
                            key={`${item.id}-att-${attIdx}`}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700"
                          >
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[180px]">{att.filename}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {att.size ? `${Math.max(1, Math.round(att.size / 1024))} KB` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* MIT SafeLink badge check for Bot events */}
                  {isBot && (
                    <div className="mt-2.5">
                      <span className="bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6] font-bold px-2 py-1 rounded-full text-[9px] inline-flex items-center gap-1.5 shadow-sm">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>MIT SafeLink geprüft</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Hover actions menu inside timeline card */}
              {hoveredMessageId === item.id && (
                <div className="absolute right-4 top-4 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-xl shadow-lg p-1 flex items-center gap-1 z-10 animate-fade-in select-none">
                  <Button variant="ghost" size="sm" className="h-7 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded-lg text-xs font-semibold px-2" onClick={onReplyClick}>
                    {t('tickets.conversation.reply', 'Reply')}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg text-xs font-semibold px-2" onClick={() => onQuoteClick(item.content)}>
                    {t('tickets.conversation.quote', 'Quote')}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg text-sm font-semibold px-2 flex items-center gap-1" onClick={() => {
                    navigator.clipboard.writeText(item.content);
                    toast.success(t('tickets.conversation.messageCopied', 'Message copied!'));
                  }}>
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t('tickets.conversation.copy', 'Copy')}</span>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
