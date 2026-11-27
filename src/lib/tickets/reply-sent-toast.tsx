/**
 * Interactive German toast after a successful public ticket reply.
 * Emerald check, 6s auto-dismiss (sonner pauses on hover), × close,
 * optional staff actions: Auf „Wartend“ setzen / Lösen.
 */
import { CheckCircle2, X } from 'lucide-react';
import { toast } from 'sonner';

export type ReplySentToastRecipient = {
  name?: string | null;
  email?: string | null;
};

export type ReplySentToastOptions = {
  /** When false / missing and no email, subtitle = Im Ticket-Verlauf veröffentlicht */
  delivered?: boolean;
  recipient?: ReplySentToastRecipient | null;
  /** Staff-only 1-click actions */
  showStaffActions?: boolean;
  currentStatus?: string | null;
  onSetWaiting?: () => void | Promise<void>;
  onResolve?: () => void | Promise<void>;
};

function recipientSubtitle(recipient?: ReplySentToastRecipient | null, delivered?: boolean): string {
  const email = String(recipient?.email || '').trim();
  const name = String(recipient?.name || '').trim();
  if (delivered === false || !email) {
    return 'Im Ticket-Verlauf veröffentlicht';
  }
  if (name && name.toLowerCase() !== email.toLowerCase()) {
    return `Per E-Mail an ${name} (${email}) gesendet`;
  }
  return `Per E-Mail an ${email} gesendet`;
}

function statusKey(status: string | null | undefined): string {
  return String(status || '').trim().toLowerCase();
}

export function showReplySentToast(options: ReplySentToastOptions = {}): string | number {
  const status = statusKey(options.currentStatus);
  const canSetWaiting =
    Boolean(options.showStaffActions && options.onSetWaiting) &&
    (status === 'open' || status === 'in_progress' || status === 'pending');
  const canResolve =
    Boolean(options.showStaffActions && options.onResolve) &&
    status !== 'resolved' &&
    status !== 'closed' &&
    status !== 'deleted' &&
    status !== 'trash' &&
    status !== 'spam' &&
    status !== 'merged';

  return toast.custom(
    (id) => (
      <div
        className="relative pointer-events-auto w-[min(100vw-2rem,22rem)] rounded-xl border border-emerald-200/80 bg-white p-3.5 shadow-lg shadow-emerald-900/5 ring-1 ring-black/5"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="pr-6">
              <p className="text-sm font-bold text-slate-900">Antwort erfolgreich gesendet</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                {recipientSubtitle(options.recipient, options.delivered)}
              </p>
            </div>
            {(canSetWaiting || canResolve) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {canSetWaiting ? (
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white"
                    onClick={async () => {
                      toast.dismiss(id);
                      try {
                        await options.onSetWaiting?.();
                        toast.success('Status auf „Wartend“ gesetzt.');
                      } catch (err: any) {
                        toast.error(
                          err?.message || 'Status konnte nicht aktualisiert werden.',
                        );
                      }
                    }}
                  >
                    Auf „Wartend“ setzen
                  </button>
                ) : null}
                {canResolve ? (
                  <button
                    type="button"
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100/80"
                    onClick={async () => {
                      toast.dismiss(id);
                      try {
                        await options.onResolve?.();
                        toast.success('Ticket als gelöst markiert.');
                      } catch (err: any) {
                        toast.error(
                          err?.message || 'Ticket konnte nicht gelöst werden.',
                        );
                      }
                    }}
                  >
                    Lösen
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            className="absolute right-2.5 top-2.5 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Schließen"
            onClick={() => toast.dismiss(id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    ),
    {
      duration: 6000,
      className: 'relative !bg-transparent !border-0 !shadow-none !p-0',
    },
  );
}
