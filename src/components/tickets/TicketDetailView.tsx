import { useEffect, useState, type Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';
import {
  BookOpen, ChevronDown, ChevronLeft, GitMerge, MessageSquare, Plus,
  MoreHorizontal, RefreshCw, Reply, SlidersHorizontal, Sparkles, StickyNote, Ticket, Ban, X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getInitials, safeString } from '../../lib/utils';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ScrollArea } from '../ui/scroll-area';
import { AiSummaryCard } from '../ticket-details/AiSummaryCard';
import { ConversationTimeline } from '../ticket-details/ConversationTimeline';
import { EmailComposer } from '../ticket-details/EmailComposer';
import { TicketKindFieldsCard } from '../ticket-details/TicketKindFieldsCard';
import { SmartContextPanel } from '../ticket-details/SmartContextPanel';
import { CustomerTabContent } from '../ticket-details/CustomerTabContent';
import { TimelineTabContent } from '../ticket-details/TimelineTabContent';
import { AiInsightsTabContent } from '../ticket-details/AiInsightsTabContent';
import { AssetsTabContent } from '../ticket-details/AssetsTabContent';
import { RelatedTicketsTabContent } from '../ticket-details/RelatedTicketsTabContent';
import { TasksTabContent } from '../ticket-details/TasksTabContent';
import { TimeTrackingTabContent } from '../ticket-details/TimeTrackingTabContent';
import { SwarmOutageBanner } from '../tickets/SwarmOutageBanner';
import { TicketDetailsSpamAction } from '../pages/TicketDetailsPage';
import { DynamicSentimentGlyph } from '../ticket-details/DynamicSentimentGlyph';
import { useTranslation } from '../../lib/context/I18nContext';
import { formatTicketCode } from '../../lib/ticketMerge';
import type { Ticket as TicketType, Message, Contact, Company, TicketChecklistItem } from '../../types';
import type { CustomField } from '../../services/schemaService';
import type { AIAdapter } from '../../lib/ai/provider-adapter';
import type { LegalValidationResult } from '../../services/legalService';
import type { AiComposerMeta } from '../ticket-details/EmailComposer';
import type { SuggestedLink } from '../../services/neuralLinkService';
import { sanitizeTimelineHtml } from '../../lib/sanitize-html';
import { useTicketStatuses } from '../../hooks/useTicketStatuses';
import { useTicketPriorities } from '../../hooks/useTicketPriorities';
import {
  resolvePriorityConfig,
  resolveStatusConfig,
  softTintStyles,
} from '../../lib/ticket-config/display';
import type { TicketStatusConfig, TicketPriorityConfig } from '../../lib/ticket-config/types';
import type { TicketDetailWorkbenchCapabilities } from '../../lib/tickets/ticket-detail-workbench-adapter';

export type PortalTicketTaskApi = {
  toggle: (ticketId: string, taskId: string) => Promise<TicketChecklistItem[]>;
  add: (ticketId: string, text: string) => Promise<TicketChecklistItem[]>;
  update: (ticketId: string, taskId: string, text: string) => Promise<TicketChecklistItem[]>;
  remove: (ticketId: string, taskId: string) => Promise<TicketChecklistItem[]>;
};

export interface TicketDetailViewProps {
  /** When true, skip staff-only chrome and use portal-safe child APIs. */
  portalMode?: boolean;
  portalCapabilities?: TicketDetailWorkbenchCapabilities;
  /** Injected taxonomy (portal meta) — skips staff /api/ticket-config hooks. */
  statusConfigs?: TicketStatusConfig[];
  priorityConfigs?: TicketPriorityConfig[];
  taskApi?: PortalTicketTaskApi;
  portalTimeEntries?: Array<Record<string, unknown>>;
  portalAssets?: Array<Record<string, unknown>>;
  onAddPortalTimeEntry?: (payload: {
    hours: number;
    description?: string;
    date?: string;
    kuerzel?: string;
    sonderzahlung?: boolean;
  }) => Promise<unknown>;
  selectedTicket: TicketType;
  ticketContact: Contact | null;
  ticketCompany: Company | null;
  contactSchema: CustomField[];
  messages: Message[];
  allTickets: TicketType[];
  activeDetailTab: string;
  setActiveDetailTab: (tab: string) => void;
  isAiReady: boolean;
  isAiDrafting: boolean;
  isTranslating: boolean;
  translatedTicket: { subject: string; description: string } | null;
  aiSummary: string;
  aiSources: { paragraph: string; articleTitle: string; articleId?: string }[];
  suggestedNeuralLinks: SuggestedLink[];
  isFindingNeuralLinks: boolean;
  linkInput: string;
  setLinkInput: (v: string) => void;
  isComposerExpanded: boolean;
  setIsComposerExpanded: (v: boolean) => void;
  replyText: string;
  setReplyText: (v: string | ((prev: string) => string)) => void;
  newAgentComment: string;
  setNewAgentComment: (v: string) => void;
  areNotesExpanded: boolean;
  setAreNotesExpanded: (v: boolean) => void;
  user: { uid?: string; displayName?: string | null; email?: string | null } | null;
  ticketService: {
    updateTicket: (id: string, data: Partial<TicketType>) => Promise<{ success: boolean; ticket?: TicketType }> | void;
    addAgentComment: (id: string, comment: { content: string; agentId?: string; agentName?: string }) => Promise<void> | void;
    getTicket: (id: string) => Promise<TicketType | null>;
  };
  setAllTickets: Dispatch<SetStateAction<TicketType[]>>;
  setSelectedTicketId: (id: string | null) => void;
  updateSummary: (force?: boolean) => Promise<void> | void;
  handleChecklistUpdated: (checklist: TicketChecklistItem[]) => void;
  handleInlineUpdate: (id: string, data: Partial<TicketType>) => void;
  findNeuralLinks: () => void;
  linkTicket: (ticketId: string) => void;
  unlinkTicket: (ticketId: string) => void;
  generateAiReply: () => void;
  handleSendReply: (meta?: {
    fromAddress?: string;
    fromChannelId?: string;
    cc?: string[];
  }) => void;
  acceptGhostDraft: () => void;
  ghostDraft: string | null;
  isGhostDrafting: boolean;
  legalViolation: LegalValidationResult | null;
  setLegalViolation: (v: LegalValidationResult | null) => void;
  isValidatingLegal: boolean;
  aiDraftMeta: AiComposerMeta | null;
  ai: AIAdapter;
  translationMood: string;
  closeFullTicketView: () => void;
  isMobilePropertiesOpen: boolean;
  setIsMobilePropertiesOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  onConvertToKB?: () => void;
  isKbDrafting?: boolean;
  onOpenMerge?: () => void;
}

export function TicketDetailView(props: TicketDetailViewProps) {
  const { t } = useTranslation();
  const {
    portalMode = false,
    portalCapabilities,
    statusConfigs: statusConfigsProp,
    priorityConfigs: priorityConfigsProp,
    taskApi,
    portalTimeEntries,
    portalAssets,
    onAddPortalTimeEntry,
    selectedTicket,
    ticketContact,
    ticketCompany,
    contactSchema,
    messages,
    allTickets,
    activeDetailTab,
    setActiveDetailTab,
    isAiReady,
    isAiDrafting,
    isTranslating,
    translatedTicket,
    aiSummary,
    aiSources,
    suggestedNeuralLinks,
    isFindingNeuralLinks,
    linkInput,
    setLinkInput,
    isComposerExpanded,
    setIsComposerExpanded,
    replyText,
    setReplyText,
    newAgentComment,
    setNewAgentComment,
    areNotesExpanded,
    setAreNotesExpanded,
    user,
    ticketService,
    setAllTickets,
    setSelectedTicketId,
    updateSummary,
    handleChecklistUpdated,
    handleInlineUpdate,
    findNeuralLinks,
    linkTicket,
    unlinkTicket,
    generateAiReply,
    handleSendReply,
    acceptGhostDraft,
    ghostDraft,
    isGhostDrafting,
    legalViolation,
    setLegalViolation,
    isValidatingLegal,
    aiDraftMeta,
    ai,
    translationMood,
    closeFullTicketView,
    isMobilePropertiesOpen,
    setIsMobilePropertiesOpen,
    onConvertToKB,
    isKbDrafting,
    onOpenMerge,
  } = props;

  const useInjectedTaxonomy = Boolean(statusConfigsProp && priorityConfigsProp) || portalMode;
  const hookedStatuses = useTicketStatuses({ enabled: !useInjectedTaxonomy });
  const hookedPriorities = useTicketPriorities({ enabled: !useInjectedTaxonomy });
  const ticketStatuses = statusConfigsProp ?? hookedStatuses.statuses;
  const ticketPriorities = priorityConfigsProp ?? hookedPriorities.priorities;

  const [showAiSummary, setShowAiSummary] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const allowInternalNotes = portalMode
    ? portalCapabilities?.internalNotes !== false
    : true;
  const allowAiSync = portalMode ? portalCapabilities?.aiSync !== false : true;
  const allowSpam = portalMode ? false : true;
  const allowSwarm = portalMode ? false : true;

  useEffect(() => {
    setShowAiSummary(false);
    setViewsOpen(false);
    setIsComposerExpanded(false);
  }, [selectedTicket?.id, setIsComposerExpanded]);

  useEffect(() => {
    const onOpenView = (ev: Event) => {
      const tab = String((ev as CustomEvent).detail?.tab || '').trim();
      if (!tab) return;
      setActiveDetailTab(tab);
      setViewsOpen(false);
    };
    window.addEventListener('hubcom-ticket-open-view', onOpenView);
    return () => window.removeEventListener('hubcom-ticket-open-view', onOpenView);
  }, [setActiveDetailTab]);

  const DETAIL_VIEWS = [
    { id: 'conversation', labelKey: 'overview', label: 'Übersicht' },
    { id: 'customer', labelKey: 'customer', label: 'Kunde' },
    { id: 'timeline', labelKey: 'timeline', label: 'Verlauf' },
    { id: 'ai_insights', labelKey: 'aiInsights', label: 'KI-Erkenntnisse' },
    { id: 'assets', labelKey: 'assets', label: 'Assets' },
    { id: 'related_tickets', labelKey: 'neuralLinks', label: 'Neuronale Verknüpfungen' },
    { id: 'tasks', labelKey: 'tasks', label: 'Aufgaben' },
    { id: 'time', labelKey: 'time', label: 'Zeiterfassung' },
  ] as const;

  const activeViewMeta =
    DETAIL_VIEWS.find((v) => v.id === activeDetailTab) || DETAIL_VIEWS[0];

  const openReplyComposer = () => {
    setActiveDetailTab('conversation');
    setIsComposerExpanded(true);
    setTimeout(() => {
      const replyComposer = document.getElementById('email-reply-composer');
      if (replyComposer) {
        replyComposer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const editable = replyComposer.querySelector(
          '[contenteditable="true"], textarea, .ql-editor',
        ) as HTMLElement | null;
        editable?.focus();
      }
    }, 80);
  };

  // Defensive guard: never crash the ticket workspace when the selected
  // ticket is temporarily unavailable (e.g. removed from the master list
  // after an assignment in a filtered view). Render an empty state instead.
  if (!selectedTicket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white dark:bg-slate-900 min-h-0">
        <Ticket className="w-10 h-10 text-muted-foreground opacity-40" />
        <h2 className="text-xl font-bold mt-4 text-foreground">
          {t('tickets.detail.notFound', 'Ticket nicht gefunden')}
        </h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          {t('tickets.detail.notFoundDesc', 'Das Ticket ist nicht mehr in der aktuellen Ansicht. Bitte zurück zur Liste und ein anderes Ticket wählen.')}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-6"
          onClick={closeFullTicketView}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          {t('tickets.detail.backToList', 'Back to tickets')}
        </Button>
      </div>
    );
  }

  const canMerge = Boolean(onOpenMerge) && selectedTicket.status !== 'merged';
  const ticketRef = formatTicketCode(selectedTicket);

  const openInternalNoteComposer = () => {
    setActiveDetailTab('conversation');
    setAreNotesExpanded(true);
    setTimeout(() => {
      const noteEl = document.getElementById('quick-internal-note-input');
      if (noteEl) {
        noteEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        noteEl.focus();
      }
    }, 80);
  };

  const actionBtnClass =
    'box-border inline-flex h-8 min-h-8 max-h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium leading-none shrink-0 transition-colors';
  const actionBtnPrimary = `${actionBtnClass} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-70 shadow-none`;
  const actionBtnOutline = `${actionBtnClass} border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 shadow-none`;
  const actionBtnIcon = `${actionBtnOutline} w-8 px-0`;

  return (
    <>
                    <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden bg-slate-50">
                      {/* 1. Compact header: title + actions; badges live in the subtitle row */}
                    <div className="flex flex-col gap-1.5 w-full min-w-0 px-4 md:px-6 pt-3 md:pt-4 pb-3 border-b border-slate-100 dark:border-slate-850 bg-white dark:bg-slate-900 shrink-0">
                      {allowSwarm ? <SwarmOutageBanner ticketId={selectedTicket.id} /> : null}

                      <div className="flex w-full min-w-0 items-start justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={closeFullTicketView}
                            aria-label={t('tickets.detail.backToList', 'Back to tickets')}
                            title={t('tickets.detail.backToList', 'Back to tickets')}
                            className="flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 cursor-pointer transition-colors select-none shrink-0 mt-0.5"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="font-mono text-xs font-bold tabular-nums text-slate-700 bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5 shrink-0">
                                {ticketRef}
                              </span>
                              {(() => {
                                const statusDisplay = resolveStatusConfig(
                                  selectedTicket.status,
                                  ticketStatuses,
                                );
                                const statusTint = softTintStyles(statusDisplay.color);
                                return (
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
                                );
                              })()}
                              {(() => {
                                const priorityDisplay = resolvePriorityConfig(
                                  selectedTicket.priority,
                                  ticketPriorities,
                                );
                                const priorityTint = softTintStyles(priorityDisplay.color);
                                return (
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
                                );
                              })()}
                              {!portalMode || portalCapabilities?.sentimentGlyph !== false ? (
                                <DynamicSentimentGlyph sentiment={selectedTicket.sentiment} />
                              ) : null}
                            </div>
                            <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-snug dark:text-slate-50 min-w-0 break-words mt-1">
                              {safeString(selectedTicket.subject)}
                            </h2>
                            <div className="flex items-center gap-2 mt-1.5 min-w-0 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[12px] font-semibold text-slate-800">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                  {t('tickets.detail.companyLabel', 'Unternehmen')}
                                </span>
                                {safeString(selectedTicket.company) ||
                                  t('tickets.detail.noCompany', 'Kein Unternehmen')}
                              </span>
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[12px] font-medium text-slate-700">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                                  {t('tickets.detail.contactLabel', 'Kontakt')}
                                </span>
                                {safeString(selectedTicket.customerName) ||
                                  t(
                                    'tickets.customerTab.noContactAssigned',
                                    'Keine Kontaktperson zugewiesen',
                                  )}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 h-8">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setViewsOpen((o) => !o)}
                              className={actionBtnOutline}
                              aria-expanded={viewsOpen}
                            >
                              <span>
                                {t('tickets.detail.views', 'Ansichten')}
                                {activeDetailTab !== 'conversation'
                                  ? `: ${t(`tickets.tabs.${activeViewMeta.labelKey}`, activeViewMeta.label)}`
                                  : ''}
                              </span>
                              <ChevronDown className={cn('w-3.5 h-3.5 shrink-0 transition-transform', viewsOpen && 'rotate-180')} />
                            </button>
                            {viewsOpen ? (
                              <div className="absolute right-0 top-full mt-1 z-40 min-w-[220px] rounded-xl border border-slate-200 bg-white shadow-lg p-1">
                                {DETAIL_VIEWS.map((tab) => (
                                  <button
                                    key={tab.id}
                                    type="button"
                                    className={cn(
                                      'w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
                                      activeDetailTab === tab.id
                                        ? 'bg-slate-900 text-white'
                                        : 'text-slate-700 hover:bg-slate-50',
                                    )}
                                    onClick={() => {
                                      setActiveDetailTab(tab.id);
                                      setViewsOpen(false);
                                    }}
                                  >
                                    {t(`tickets.tabs.${tab.labelKey}`, tab.label)}
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {allowAiSync ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDetailTab('conversation');
                              setShowAiSummary((v) => !v);
                            }}
                            className={showAiSummary ? actionBtnPrimary : actionBtnOutline}
                          >
                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('tickets.detail.aiSummaryToggle', 'KI-Zusammenfassung')}</span>
                          </button>
                          ) : null}
                          {onConvertToKB && (
                            <button
                              type="button"
                              onClick={onConvertToKB}
                              disabled={isKbDrafting}
                              className={actionBtnOutline}
                            >
                              {isKbDrafting
                                ? <RefreshCw className="w-3.5 h-3.5 shrink-0 text-indigo-500 animate-spin" />
                                : <BookOpen className="w-3.5 h-3.5 shrink-0 text-indigo-500" />}
                              <span>{isKbDrafting
                                ? t('tickets.detail.extracting', 'Extracting...')
                                : t('tickets.detail.convertToKbShort', 'In KB')}</span>
                            </button>
                          )}
                          {allowInternalNotes ? (
                          <button
                            type="button"
                            onClick={openInternalNoteComposer}
                            className={actionBtnOutline}
                          >
                            <StickyNote className="w-3.5 h-3.5 shrink-0" />
                            <span>{t('tickets.noteBtnShort', 'Notiz')}</span>
                          </button>
                          ) : null}
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  type="button"
                                  className={actionBtnIcon}
                                  aria-label={t('tickets.detail.more', 'More')}
                                />
                              }
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1">
                              {canMerge && (
                                <DropdownMenuItem
                                  className="rounded-lg text-xs font-semibold py-2 cursor-pointer"
                                  onClick={onOpenMerge}
                                >
                                  <GitMerge className="w-3.5 h-3.5 text-indigo-600" />
                                  {t('tickets.merge.button', 'Zusammenführen')}
                                </DropdownMenuItem>
                              )}
                              {allowSpam && selectedTicket.status !== 'spam' && (
                                <DropdownMenuItem
                                  className="rounded-lg text-xs font-semibold py-2 cursor-pointer text-rose-700"
                                  onClick={() => document.getElementById('ticket-header-spam-trigger')?.click()}
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  {t('tickets.spam.button', 'Als Spam markieren')}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="rounded-lg text-xs font-semibold py-2 cursor-pointer lg:hidden"
                                onClick={() => setIsMobilePropertiesOpen((prev) => !prev)}
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                                {isMobilePropertiesOpen
                                  ? t('tickets.detail.closeProps', 'Close properties')
                                  : t('tickets.detail.properties', 'Properties')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          {allowSpam ? (
                          <TicketDetailsSpamAction
                            hideTrigger
                            ticket={selectedTicket}
                            contactEmail={ticketContact?.email}
                            onMarked={() => {
                              setAllTickets((prev) =>
                                prev.map((ticket) =>
                                  ticket.id === selectedTicket.id
                                    ? { ...ticket, status: 'spam' as const }
                                    : ticket,
                                ),
                              );
                              setSelectedTicketId(null);
                            }}
                          />
                          ) : null}
                        </div>
                      </div>
                    </div>
    
                  {/* Thread Content */}
                  <ScrollArea className="flex-1 min-h-0 px-6 py-4">
                      <div className="w-full space-y-4 pb-12">
                        
                        {activeDetailTab === 'conversation' && (
                          <div className="space-y-4">
                            {showAiSummary ? (
                              <AiSummaryCard 
                                ticket={selectedTicket}
                                aiSummary={aiSummary}
                                isAiReady={isAiReady}
                                onRefreshSummary={() => updateSummary(true)}
                                isAiDrafting={isAiDrafting}
                                onChecklistUpdated={handleChecklistUpdated}
                                onAdoptProposedSolution={(text) => {
                                  setReplyText(text);
                                  openReplyComposer();
                                }}
                                portalMode={portalMode}
                                taskApi={taskApi}
                              />
                            ) : null}
    
                            {/* Collapsible Interne Notizen (single source — no composer note tab) */}
                            {allowInternalNotes ? (
                            <div className="bg-amber-50/15 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/20 rounded-2xl overflow-hidden shadow-sm transition-all hover:bg-amber-50/25 dark:hover:bg-amber-950/15">
                              <button 
                                onClick={() => setAreNotesExpanded(!areNotesExpanded)}
                                className="w-full flex items-center justify-between p-3.5 focus:outline-none"
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center border border-amber-200 dark:border-amber-900 text-amber-805 dark:text-amber-200 shrink-0 shadow-sm">
                                    <MessageSquare className="w-4 h-4" />
                                  </div>
                                  <div className="text-left">
                                    <h3 className="text-xs font-bold text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                                      <span>{t('tickets.notes.internalNotes', 'Interne Notizen')}</span>
                                      <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 border-none text-[8.5px] font-black tracking-tight px-1.5 h-4.5 rounded-full shadow-sm">
                                        {(selectedTicket.agentComments || []).length}
                                      </Badge>
                                    </h3>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-bold text-amber-900 hover:bg-amber-50"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAreNotesExpanded(true);
                                      setTimeout(() => {
                                        document.getElementById('quick-internal-note-input')?.focus();
                                      }, 50);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setAreNotesExpanded(true);
                                        setTimeout(() => {
                                          document.getElementById('quick-internal-note-input')?.focus();
                                        }, 50);
                                      }
                                    }}
                                  >
                                    <Plus className="w-3 h-3" />
                                    {t('tickets.notes.addNote', 'Notiz hinzufügen')}
                                  </span>
                                  <ChevronDown className={cn(
                                    "w-4 h-4 text-amber-700/80 dark:text-amber-400 transition-transform duration-200", 
                                    areNotesExpanded && "rotate-180"
                                  )} />
                                </div>
                              </button>
    
                              {areNotesExpanded && (
                                <div className="px-4 pb-4 pt-1 space-y-4 border-t border-amber-200/30 dark:border-amber-900/30">
                                  {/* Notes list */}
                                  {(selectedTicket.agentComments || []).length === 0 ? (
                                    <p className="text-[11px] text-amber-800/60 dark:text-amber-400/70 italic py-2 text-center">{t('tickets.notes.noNotesYet', 'No internal agent notes logged yet.')}</p>
                                  ) : (
                                    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                                      {(selectedTicket.agentComments || []).map((comment: any) => (
                                        <div 
                                          key={comment.id} 
                                          className="p-3 bg-amber-50/90 dark:bg-slate-900 border border-amber-200/50 dark:border-slate-800 rounded-xl shadow-sm text-slate-900 dark:text-slate-100 flex items-start gap-3"
                                        >
                                          <div className="w-6.5 h-6.5 rounded-full bg-amber-100/80 dark:bg-slate-800 border border-amber-200 dark:border-slate-700 text-amber-800/80 dark:text-slate-200 flex items-center justify-center shrink-0 text-[10px] font-black uppercase">
                                            {comment.agentName ? getInitials(comment.agentName) : 'AG'}
                                          </div>
                                          <div className="flex-1 min-w-0 space-y-0.5">
                                            <div className="flex items-center justify-between">
                                              <span className="font-bold text-[11px] text-amber-950 dark:text-amber-100">{safeString(comment.agentName)}</span>
                                              <span className="text-[9px] text-amber-800/60 dark:text-slate-400 font-medium">
                                                {comment.createdAt ? new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                                              </span>
                                            </div>
                                            <div
                                              className="text-[11px] text-amber-950 dark:text-slate-200 leading-relaxed prose prose-sm max-w-none break-words"
                                              dangerouslySetInnerHTML={{
                                                __html: sanitizeTimelineHtml(String(comment.content || '')),
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
    
                                  {/* Inline + Notiz hinzufügen composer */}
                                  <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200/40 dark:border-slate-800 rounded-xl flex gap-2 items-center">
                                    <input 
                                      id="quick-internal-note-input"
                                      type="text" 
                                      placeholder={t('tickets.notes.typeNotePlaceholder', 'Type an internal note to notify workforce, share state...')} 
                                      className="flex-1 bg-transparent border-none text-[11px] text-slate-850 dark:text-slate-200 focus:outline-none focus:ring-0 placeholder:text-slate-400"
                                      value={newAgentComment}
                                      onChange={(e) => setNewAgentComment(e.target.value)}
                                      onKeyDown={async (e) => {
                                        if (e.key === 'Enter' && newAgentComment.trim()) {
                                          if (!user) return;
                                          try {
                                            await ticketService.addAgentComment(selectedTicket.id, {
                                              content: newAgentComment.trim(),
                                              agentId: user.uid,
                                              agentName: user.displayName || user.email || 'Agent'
                                            });
                                            setNewAgentComment("");
                                            const updatedTicket = await ticketService.getTicket(selectedTicket.id);
                                            if (updatedTicket) {
                                              setAllTickets(prev => prev.map(t => t.id === selectedTicket.id ? updatedTicket : t));
                                            }
                                  toast.success(t('tickets.notes.noteLogged', 'Internal note logged.'));
                                } catch (err) {
                                  toast.error(t('tickets.notes.noteFailed', 'Failed to log internal note.'));
                                }
                                        }
                                      }}
                                    />
                                    <Button 
                                      size="sm" 
                                      className="bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-850 text-amber-900 border-none font-bold text-[10px] h-7 px-3 rounded-lg shadow-sm font-sans"
                                      onClick={async () => {
                                        if (!newAgentComment.trim() || !user) return;
                                        try {
                                          await ticketService.addAgentComment(selectedTicket.id, {
                                            content: newAgentComment.trim(),
                                            agentId: user.uid,
                                            agentName: user.displayName || user.email || 'Agent'
                                          });
                                          setNewAgentComment("");
                                          const updatedTicket = await ticketService.getTicket(selectedTicket.id);
                                          if (updatedTicket) {
                                            setAllTickets(prev => prev.map(t => t.id === selectedTicket.id ? updatedTicket : t));
                                          }
                                          toast.success(t('tickets.notes.noteLogged', 'Internal note logged.'));
                                        } catch (err) {
                                          toast.error(t('tickets.notes.noteFailed', 'Failed to log internal note.'));
                                        }
                                      }}
                                    >
                                      {t('tickets.notes.postNoteBtn', 'Post Note')}
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                            ) : null}
    
                            <ConversationTimeline 
                              ticket={selectedTicket}
                              messages={messages}
                              agentComments={selectedTicket.agentComments || []}
                              onReplyClick={openReplyComposer}
                              onQuoteClick={(text) => {
                                setReplyText(prev => prev ? `${prev}<blockquote>${text}</blockquote><br/>` : `<blockquote>${text}</blockquote><br/>`);
                                openReplyComposer();
                              }}
                              onInternalNoteAction={() => {
                                setAreNotesExpanded(true);
                                setTimeout(() => {
                                  document.getElementById('quick-internal-note-input')?.focus();
                                }, 80);
                              }}
                              onAddAgentComment={async (text) => {
                                if (!user) return;
                                try {
                                  await ticketService.addAgentComment(selectedTicket.id, {
                                    content: text,
                                    agentId: user.uid,
                                    agentName: user.displayName || user.email || 'Agent'
                                  });
                                  const updatedTicket = await ticketService.getTicket(selectedTicket.id);
                                  if (updatedTicket) {
                                    setAllTickets(prev => prev.map(t => t.id === selectedTicket.id ? updatedTicket : t));
                                  }
                                  toast.success(t('tickets.notes.noteLogged', 'Internal note logged.'));
                                } catch (e) {
                                  toast.error(t('tickets.notes.noteFailed', 'Failed to log internal note.'));
                                }
                              }}
                              isTranslating={isTranslating}
                              translatedTicket={translatedTicket}
                            />
    
                            {/* On-demand Öffentliche Antwort — collapsed until Antworten */}
                            <div className="relative" id="email-reply-composer">
                              {!isComposerExpanded ? (
                                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                  <Button
                                    type="button"
                                    className="h-9 gap-1.5 font-bold"
                                    onClick={openReplyComposer}
                                  >
                                    <Reply className="w-3.5 h-3.5" />
                                    {t('tickets.composer.reply', 'Antworten')}
                                  </Button>
                                  <span className="text-[11px] text-slate-500 font-medium">
                                    {t(
                                      'tickets.composer.replyHint',
                                      'Öffentliche Antwort erst bei Bedarf öffnen — Thread bleibt kompakt.',
                                    )}
                                  </span>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between px-1">
                                    <span className="text-xs font-bold text-slate-700">
                                      {t('tickets.composer.publicReply', 'Öffentliche Antwort')}
                                    </span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 gap-1 text-xs"
                                      onClick={() => {
                                        setIsComposerExpanded(false);
                                        setReplyText('');
                                        setLegalViolation(null);
                                      }}
                                    >
                                      <X className="w-3.5 h-3.5" />
                                      {t('tickets.composer.discardClose', 'Schließen / Verwerfen')}
                                    </Button>
                                  </div>
                                  <EmailComposer 
                                    ticket={selectedTicket}
                                    value={replyText}
                                    onChange={setReplyText}
                                    isDrafting={isAiDrafting || isGhostDrafting}
                                    ghostDraft={ghostDraft}
                                    onAcceptGhostDraft={acceptGhostDraft}
                                    onSend={handleSendReply}
                                    onDiscard={() => {
                                      setReplyText('');
                                      setLegalViolation(null);
                                      setIsComposerExpanded(false);
                                    }}
                                    isAiReady={isAiReady}
                                    isAiDrafting={isAiDrafting}
                                    onDraftWithAI={generateAiReply}
                                    onImproveWriting={async () => {
                                      if (!isAiReady || !replyText) return;
                                      try {
                                        const polished = await ai.improveTone(replyText, 'Professional');
                                        setReplyText(polished);
                                        toast.success(t('tickets.detail.tonePolishApplied', 'Ton-Abgleich mit KI angewendet.'));
                                      } catch (e) {
                                        toast.error(t('tickets.detail.tonePolishFailed', 'Verbesserung des Schreibstils fehlgeschlagen.'));
                                      }
                                    }}
                                    onTranslate={async () => {
                                      if (!isAiReady || !replyText) return;
                                      try {
                                        const translated = await ai.translate(replyText, 'German', translationMood);
                                        setReplyText(translated);
                                        toast.success(t('tickets.detail.translatedToClientLang', 'Entwurf in die Kundensprache übersetzt.'));
                                      } catch (e) {
                                        toast.error(t('tickets.detail.translationAssistFailed', 'Übersetzungshilfe fehlgeschlagen.'));
                                      }
                                    }}
                                    onSummarize={updateSummary}
                                    legalViolation={legalViolation}
                                    isValidatingLegal={isValidatingLegal}
                                    aiDraftMeta={aiDraftMeta}
                                    autoDispatchThreshold={95}
                                    isAutoDispatched={selectedTicket?.aiAutoDispatched === true}
                                    portalMode={portalMode}
                                  />
                                </div>
                              )}
                              </div>
    
                            {/* 5. Bento Grid horizontal context cards at the end */}
                            <TicketKindFieldsCard
                              ticket={selectedTicket}
                              onUpdate={(data) => handleInlineUpdate(selectedTicket.id, data)}
                            />
                            <SmartContextPanel 
                              ticket={selectedTicket}
                              contact={ticketContact}
                              company={ticketCompany}
                              allTickets={allTickets}
                              className={cn('lg:hidden', isMobilePropertiesOpen && 'hidden')}
                            />
                          </div>
                        )}
    
                        {activeDetailTab === 'customer' && (
                          <CustomerTabContent 
                            ticket={selectedTicket}
                            contact={ticketContact}
                            company={ticketCompany}
                            contactSchema={contactSchema}
                            allTickets={allTickets}
                            onUpdateTicket={(data) =>
                              handleInlineUpdate(selectedTicket.id, data)
                            }
                            portalMode={portalMode}
                          />
                        )}
    
                        {activeDetailTab === 'timeline' && (
                          <TimelineTabContent 
                            ticket={selectedTicket}
                            messages={messages}
                            agentComments={selectedTicket.agentComments || []}
                          />
                        )}
    
                        {activeDetailTab === 'ai_insights' && (
                          <AiInsightsTabContent 
                            ticket={selectedTicket}
                            aiSummary={aiSummary}
                            aiSources={aiSources}
                            isAiReady={isAiReady}
                          />
                        )}
    
                        {activeDetailTab === 'assets' && (
                          <AssetsTabContent
                            ticket={selectedTicket}
                            portalMode={portalMode}
                            portalAssets={portalAssets}
                          />
                        )}
    
                        {activeDetailTab === 'related_tickets' && (
                          <RelatedTicketsTabContent 
                            ticket={selectedTicket}
                            suggestedNeuralLinks={suggestedNeuralLinks}
                            isFindingNeuralLinks={isFindingNeuralLinks}
                            onFindNeuralLinks={findNeuralLinks}
                            onLinkTicket={linkTicket}
                            onUnlinkTicket={unlinkTicket}
                            linkInput={linkInput}
                            onChangeLinkInput={setLinkInput}
                          />
                        )}
    
                        {activeDetailTab === 'tasks' && (
                          <TasksTabContent
                            ticket={selectedTicket}
                            onChecklistUpdated={handleChecklistUpdated}
                            portalMode={portalMode}
                            taskApi={taskApi}
                          />
                        )}

                        {activeDetailTab === 'time' && (
                          <TimeTrackingTabContent
                            ticket={selectedTicket}
                            portalMode={portalMode}
                            portalTimeEntries={portalTimeEntries}
                            onAddPortalTimeEntry={onAddPortalTimeEntry}
                          />
                        )}
    
                      </div>
                  </ScrollArea>
                </div> {/* End of message column */}
                {/* Mobile drawer backdrop (tap to dismiss); never shown on desktop. */}
                {isMobilePropertiesOpen && (
                  <div
                    onClick={() => setIsMobilePropertiesOpen(false)}
                    className="lg:hidden absolute inset-0 z-20 bg-black/40 backdrop-blur-[1px]"
                    aria-hidden="true"
                  />
                )}
    </>
  );
}
