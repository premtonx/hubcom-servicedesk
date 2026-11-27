import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { cn } from '../../../lib/utils';
import {
  emailChannelApi,
  type EmailChannelConfig,
} from '../../../services/emailChannelApi';
import {
  buildEmailChannelActivities,
  channelStatusLabelDe,
  computeEmailChannelsKpis,
  connectionTypeLabelDe,
  formatRelativeTimeDe,
} from '../../../lib/admin/email-channels-overview-metrics';
import type { MailSubTabId } from '../../../lib/admin/mail-integrations-nav';
import EmailChannelsPage from '../../pages/EmailChannelsPage';

interface AdminMailEmailChannelsPaneProps {
  tab: MailSubTabId;
  channelId?: string | null;
  onNavigateTab: (tab: MailSubTabId, channelId?: string | null) => void;
}

export function AdminMailEmailChannelsPane({
  tab,
  channelId,
  onNavigateTab,
}: AdminMailEmailChannelsPaneProps) {
  const [channels, setChannels] = useState<EmailChannelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await emailChannelApi.list();
      setChannels(list);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Kanäle konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep header status pill in sync
  useEffect(() => {
    const el = document.getElementById('mail-status-email-channels');
    if (!el) return;
    const active = channels.some((c) => c.enabled !== false && c.status !== 'disabled');
    el.className = cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold',
      active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
    );
    el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${
      active ? 'bg-emerald-500' : 'bg-slate-400'
    }"></span>${active ? 'Aktiv' : 'Inaktiv'}`;
  }, [channels]);

  const kpis = useMemo(() => computeEmailChannelsKpis(channels), [channels]);
  const activities = useMemo(() => buildEmailChannelActivities(channels, 10), [channels]);

  const handleTest = async (id: string) => {
    setBusyId(id);
    try {
      const result = await emailChannelApi.test(id);
      if (result.ok) toast.success(result.message || 'Verbindung erfolgreich.');
      else toast.error(result.message || 'Test fehlgeschlagen.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Test fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggle = async (ch: EmailChannelConfig) => {
    setBusyId(ch.id);
    try {
      await emailChannelApi.update(ch.id, { enabled: ch.enabled === false });
      toast.success(ch.enabled === false ? 'Kanal aktiviert.' : 'Kanal deaktiviert.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Status konnte nicht geändert werden.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (ch: EmailChannelConfig) => {
    if (!confirm(`Kanal „${ch.displayName || ch.name || ch.email}“ wirklich löschen?`)) return;
    setBusyId(ch.id);
    try {
      await emailChannelApi.remove(ch.id);
      toast.success('Kanal gelöscht.');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Löschen fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  if (tab !== 'overview') {
    return (
      <EmailChannelsPage
        embedded
        viewMode={tab}
        focusChannelId={channelId || null}
        onChannelsChanged={load}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Kanäle werden geladen…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Aktive Kanäle"
          value={String(kpis.activeChannels)}
          hint={
            kpis.recentlyAdded > 0
              ? `+${kpis.recentlyAdded} neu (7 Tg.)`
              : `${kpis.totalChannels} gesamt`
          }
          hintTone={kpis.recentlyAdded > 0 ? 'emerald' : 'slate'}
        />
        <KpiCard
          label="Verarbeitete E-Mails"
          value={kpis.processedEmails == null ? '—' : String(kpis.processedEmails)}
          hint={
            kpis.processedEmails == null
              ? 'Noch keine Verarbeitungsmetrik'
              : 'Aus Mail-Protokoll'
          }
        />
        <KpiCard
          label="Erfolgsrate"
          value={
            kpis.successRatePercent == null ? '—' : `${kpis.successRatePercent} %`
          }
          hint={
            kpis.successRatePercent == null
              ? 'Noch keine Verbindungstests'
              : 'Anteil erfolgreicher Tests'
          }
        />
        <KpiCard
          label="Ø Antwortzeit"
          value={kpis.avgResponseTimeLabel || '—'}
          hint={
            kpis.avgResponseTimeLabel ? 'Durchschnittliche Verarbeitung' : 'Noch keine Daten'
          }
        />
      </div>

      {/* Split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Kanäle</h2>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-xl text-xs font-bold gap-1"
              onClick={() => {
                onNavigateTab('configuration', null);
                queueMicrotask(() =>
                  window.dispatchEvent(new CustomEvent('hubcom-mail-open-create-channel')),
                );
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Neuen Kanal hinzufügen
            </Button>
          </div>

          {channels.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-500">
                Noch kein E-Mail-Kanal konfiguriert.
              </p>
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-xl text-xs font-bold gap-1"
                onClick={() => {
                  onNavigateTab('configuration', null);
                  queueMicrotask(() =>
                    window.dispatchEvent(new CustomEvent('hubcom-mail-open-create-channel')),
                  );
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Neuen Kanal hinzufügen
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {channels.map((ch) => {
                const st = channelStatusLabelDe(ch);
                return (
                  <li
                    key={ch.id}
                    className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center text-[10px] font-black shrink-0 uppercase">
                      {connectionTypeLabelDe(ch.connectionType).slice(0, 3)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {ch.displayName || ch.name || ch.email}
                        </p>
                        <Badge
                          className={cn(
                            'text-[9px] font-extrabold border-none uppercase',
                            st.active
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          {st.label}
                        </Badge>
                        {ch.isPrimary ? (
                          <Badge className="text-[9px] font-extrabold bg-indigo-50 text-indigo-700 border-none">
                            Standard
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                        {ch.email}
                        <span className="text-slate-300 mx-1.5">·</span>
                        {connectionTypeLabelDe(ch.connectionType)}
                        {ch.createdAt ? (
                          <>
                            <span className="text-slate-300 mx-1.5">·</span>
                            seit {formatRelativeTimeDe(String(ch.createdAt))}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl text-[11px] font-bold"
                        onClick={() => onNavigateTab('configuration', ch.id)}
                      >
                        Bearbeiten
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={busyId === ch.id}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                          aria-label="Kanalaktionen"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem
                            onClick={() => {
                              onNavigateTab('test', ch.id);
                              void handleTest(ch.id);
                            }}
                          >
                            Testen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void handleToggle(ch)}>
                            {ch.enabled === false ? 'Aktivieren' : 'Deaktivieren'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-rose-600"
                            onClick={() => void handleDelete(ch)}
                          >
                            Löschen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Letzte Aktivitäten</h2>
            <button
              type="button"
              className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
              onClick={() => onNavigateTab('logs')}
            >
              Alle anzeigen →
            </button>
          </div>
          {activities.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 font-semibold">
              Noch keine Aktivitäten.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {activities.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-2.5">
                  {a.kind === 'test_ok' || a.kind === 'poll' || a.kind === 'created' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">{a.channelName}</p>
                    <p className="text-[11px] text-slate-500 font-medium leading-snug mt-0.5">
                      {a.label}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                    {formatRelativeTimeDe(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Advanced accordion */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50/80 cursor-pointer"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <div>
            <p className="text-sm font-black text-slate-900">Erweiterte Einstellungen</p>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              Weitere Optionen für E-Mail-Kanäle und Verarbeitung
            </p>
          </div>
          {advancedOpen ? (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>
        {advancedOpen ? (
          <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2 text-xs text-slate-600 font-medium">
            <p>
              Polling-Intervalle, Standard-Absender und Signaturen werden pro Kanal unter{' '}
              <button
                type="button"
                className="text-primary font-bold hover:underline cursor-pointer"
                onClick={() => onNavigateTab('configuration')}
              >
                Konfiguration
              </button>{' '}
              bzw.{' '}
              <button
                type="button"
                className="text-primary font-bold hover:underline cursor-pointer"
                onClick={() => onNavigateTab('settings')}
              >
                Einstellungen
              </button>{' '}
              verwaltet.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-xl text-xs font-bold"
              onClick={() => onNavigateTab('settings')}
            >
              Erweiterte Kanal-Einstellungen öffnen
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  hintTone = 'slate',
}: {
  label: string;
  value: string;
  hint: string;
  hintTone?: 'slate' | 'emerald';
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-1.5 tracking-tight">{value}</p>
      <p
        className={cn(
          'text-[11px] font-semibold mt-1',
          hintTone === 'emerald' ? 'text-emerald-600' : 'text-slate-500',
        )}
      >
        {hint}
      </p>
    </div>
  );
}
