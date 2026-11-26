import { Check, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  defaultConfiguredReminderStages,
  getStageEvent,
  isStageSent,
  reminderStageLabel,
  type ConfiguredReminderStage,
  type ReminderStageEvent,
} from '../../lib/client-portal/hardware-returns-stages';

export type ReminderHwLike = {
  returned?: boolean;
  mail1_sent_at?: string | null;
  mail2_sent_at?: string | null;
  mail3_sent_at?: string | null;
  mail1_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  mail2_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  mail3_sent_recipients?: { to?: string[]; cc?: string[] } | null;
  reminder_stages?: ReminderStageEvent[];
  reminder_count?: number;
};

/** Stages to show: configured defaults ∪ any already-sent higher stages. */
export function visibleReminderStages(
  configured: ConfiguredReminderStage[] | null | undefined,
  hw: ReminderHwLike,
): number[] {
  const plan =
    configured && configured.length > 0
      ? configured
      : defaultConfiguredReminderStages();
  const configuredCount = plan.length;
  const sentMax = Math.max(
    Number(hw.reminder_count) || 0,
    ...(hw.reminder_stages || [])
      .filter((s) => s.sentAt)
      .map((s) => s.stage),
    hw.mail1_sent_at ? 1 : 0,
    hw.mail2_sent_at ? 2 : 0,
    hw.mail3_sent_at ? 3 : 0,
  );
  const maxShown = Math.max(configuredCount, sentMax);
  return Array.from({ length: maxShown }, (_, i) => i + 1);
}

/** Next on-demand stage for the + button. */
export function nextManualReminderStage(
  configured: ConfiguredReminderStage[] | null | undefined,
  hw: ReminderHwLike,
): number {
  const plan =
    configured && configured.length > 0
      ? configured
      : defaultConfiguredReminderStages();
  const configuredCount = plan.length;
  const highestSent = Math.max(
    Number(hw.reminder_count) || 0,
    ...(hw.reminder_stages || [])
      .filter((s) => s.sentAt)
      .map((s) => s.stage),
    hw.mail1_sent_at ? 1 : 0,
    hw.mail2_sent_at ? 2 : 0,
    hw.mail3_sent_at ? 3 : 0,
  );
  return Math.max(configuredCount, highestSent) + 1;
}

function stageSentAt(hw: ReminderHwLike, stage: number): string | null {
  const ev = getStageEvent(hw.reminder_stages || [], stage);
  if (ev?.sentAt) return ev.sentAt;
  if (stage === 1) return hw.mail1_sent_at || null;
  if (stage === 2) return hw.mail2_sent_at || null;
  if (stage === 3) return hw.mail3_sent_at || null;
  return null;
}

function stageRecipients(
  hw: ReminderHwLike,
  stage: number,
): { to: string[]; cc: string[] } {
  const ev = getStageEvent(hw.reminder_stages || [], stage);
  if (ev) return { to: ev.recipientsTo || [], cc: ev.recipientsCc || [] };
  if (stage === 1) {
    return {
      to: hw.mail1_sent_recipients?.to || [],
      cc: hw.mail1_sent_recipients?.cc || [],
    };
  }
  if (stage === 2) {
    return {
      to: hw.mail2_sent_recipients?.to || [],
      cc: hw.mail2_sent_recipients?.cc || [],
    };
  }
  if (stage === 3) {
    return {
      to: hw.mail3_sent_recipients?.to || [],
      cc: hw.mail3_sent_recipients?.cc || [],
    };
  }
  return { to: [], cc: [] };
}

/**
 * Dynamic Erinnerungsverlauf stepper: 1 — 2 — 3 — 4 — [+]
 * Click a stage to open send/preview; + opens next on-demand stage.
 */
export function ReturnsReminderStepper({
  hw,
  configuredStages,
  nextDueStage,
  onOpenSend,
  compact,
  showPlus = true,
}: {
  hw: ReminderHwLike;
  configuredStages?: ConfiguredReminderStage[] | null;
  nextDueStage?: number | null;
  onOpenSend: (stage: number) => void;
  compact?: boolean;
  showPlus?: boolean;
}) {
  const stages = visibleReminderStages(configuredStages, hw);
  const nextPlus = nextManualReminderStage(configuredStages, hw);
  const returned = Boolean(hw.returned);

  return (
    <div
      className={cn(
        'flex items-center gap-0',
        compact ? 'min-w-0' : 'min-w-[200px]',
      )}
      title="Erinnerungsverlauf"
    >
      {stages.map((stage, idx) => {
        const sentAt = stageSentAt(hw, stage);
        const recipients = stageRecipients(hw, stage);
        const done = Boolean(sentAt);
        const prevDone =
          idx === 0 ? false : Boolean(stageSentAt(hw, stages[idx - 1]!));
        const isNext = !done && nextDueStage === stage && !returned;
        const tip = sentAt
          ? `${reminderStageLabel(stage)}\n${new Date(sentAt).toLocaleString('de-DE')}\nAn: ${recipients.to.join(', ') || '—'}\nCC: ${recipients.cc.join(', ') || '—'}`
          : isNext
            ? `${reminderStageLabel(stage)} — nächste fällige Stufe`
            : `${reminderStageLabel(stage)} — klicken zum Senden`;
        return (
          <div key={stage} className="flex items-center">
            {idx > 0 ? (
              <div
                className={cn(
                  'h-[1.5px] w-2',
                  prevDone ? 'bg-emerald-300' : 'bg-slate-200',
                )}
              />
            ) : null}
            <button
              type="button"
              title={tip}
              disabled={returned}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSend(stage);
              }}
              className={cn(
                'relative flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[11px] font-bold transition',
                done
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isNext
                    ? 'bg-amber-50 text-amber-800 border-amber-300 ring-1 ring-amber-100'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400',
                returned && 'opacity-60 cursor-not-allowed',
              )}
            >
              {done ? <Check className="w-2.5 h-2.5 shrink-0" /> : null}
              <span>{stage}.</span>
            </button>
          </div>
        );
      })}
      {showPlus && !returned ? (
        <div className="flex items-center">
          <div className="h-[1.5px] w-2 bg-slate-200" />
          <button
            type="button"
            title={`${reminderStageLabel(nextPlus)} hinzufügen`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSend(nextPlus);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-500 hover:border-sky-400 hover:text-sky-700 hover:bg-sky-50 transition"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** True when at least stage 4 (or higher) has been sent. */
export function hasEscalatedReminder(hw: ReminderHwLike): boolean {
  if ((Number(hw.reminder_count) || 0) >= 4) return true;
  if ((hw.reminder_stages || []).some((s) => s.stage >= 4 && s.sentAt)) return true;
  return false;
}

export function hwIsStageSent(hw: ReminderHwLike, stage: number): boolean {
  return isStageSent(
    {
      reminder_stages: hw.reminder_stages || [],
      mail1_sent_at: hw.mail1_sent_at || null,
      mail2_sent_at: hw.mail2_sent_at || null,
      mail3_sent_at: hw.mail3_sent_at || null,
    },
    stage,
  );
}
