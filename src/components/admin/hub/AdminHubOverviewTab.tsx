import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Info,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '../../../lib/context/I18nContext';
import { cn } from '../../../lib/utils';
import {
  overallStateLabelDe,
  type AdminHubActionItem,
  type AdminHubSubsystemState,
  type AdminHubSubsystemStatus,
  type AdminHubTelemetry,
} from './adminHubTelemetry';

interface AdminHubOverviewTabProps {
  telemetry: AdminHubTelemetry;
  onTelemetryRefresh?: () => void;
}

function formatCheckedAt(iso: string | undefined, locale = 'de-DE'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '—';
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function stateMeta(state: AdminHubSubsystemState): {
  label: string;
  Icon: typeof CheckCircle2;
  className: string;
  badgeClass: string;
} {
  switch (state) {
    case 'ok':
      return {
        label: 'OK',
        Icon: CheckCircle2,
        className: 'text-emerald-700',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'degraded':
      return {
        label: 'Eingeschränkt',
        Icon: AlertTriangle,
        className: 'text-amber-800',
        badgeClass: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    case 'error':
      return {
        label: 'Fehler',
        Icon: XCircle,
        className: 'text-red-700',
        badgeClass: 'bg-red-50 text-red-800 border-red-200',
      };
    case 'not_configured':
      return {
        label: 'Nicht konfiguriert',
        Icon: Info,
        className: 'text-slate-700',
        badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
      };
    default:
      return {
        label: 'Unbekannt',
        Icon: CircleHelp,
        className: 'text-slate-600',
        badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
      };
  }
}

export function AdminHubOverviewTab({ telemetry, onTelemetryRefresh }: AdminHubOverviewTabProps) {
  const { t } = useTranslation();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const subsystems = telemetry.subsystems ?? [];
  const actionItems = telemetry.actionItems ?? [];
  const overall = telemetry.overallState ?? 'unknown';
  const overallMeta = stateMeta(overall);
  const OverallIcon = overallMeta.Icon;
  const loading = subsystems.length === 0 && !telemetry.loadError;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
            {t('admin.hubOverview.title', 'Übersicht')}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t(
              'admin.hubOverview.subtitle',
              'Aktueller Betriebszustand und offene Aufgaben — ohne erfundene Verfügbarkeitswerte.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>
            {t('admin.hubOverview.lastCheck', 'Stand')}:{' '}
            <time dateTime={telemetry.checkedAt}>{formatCheckedAt(telemetry.checkedAt)}</time>
          </span>
          {onTelemetryRefresh ? (
            <button
              type="button"
              onClick={() => onTelemetryRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden />
              {t('admin.hubOverview.refresh', 'Aktualisieren')}
            </button>
          ) : null}
        </div>
      </div>

      {telemetry.loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {t('admin.hubOverview.loadError', 'Status konnte nicht geladen werden')}: {telemetry.loadError}
        </div>
      ) : null}

      {/* Systemstatus */}
      <section
        aria-labelledby="admin-hub-systemstatus-heading"
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 min-w-0">
            <h3
              id="admin-hub-systemstatus-heading"
              className="text-base font-semibold text-slate-900"
            >
              {t('admin.hubOverview.systemStatus', 'Systemstatus')}
            </h3>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold',
                overallMeta.badgeClass,
              )}
            >
              <OverallIcon className={cn('w-3.5 h-3.5', overallMeta.className)} aria-hidden />
              {overallStateLabelDe(overall)}
            </span>
          </div>
          <p className="text-sm text-slate-600">
            {t(
              'admin.hubOverview.systemStatusHint',
              'Gesamtstatus = schwächstes Subsystem. Backups erscheinen hier nicht — es gibt keine Live-Backup-API.',
            )}
          </p>
        </div>

        {loading ? (
          <p className="px-4 py-8 sm:px-5 text-sm text-slate-600" role="status">
            {t('admin.hubOverview.loading', 'Status wird geladen …')}
          </p>
        ) : subsystems.length === 0 ? (
          <p className="px-4 py-8 sm:px-5 text-sm text-slate-600" role="status">
            {t('admin.hubOverview.noSubsystems', 'Keine Subsystem-Daten verfügbar.')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {subsystems.map((sub) => (
              <SubsystemRow key={sub.id} subsystem={sub} />
            ))}
          </ul>
        )}
      </section>

      {/* Handlungsbedarf */}
      <section
        aria-labelledby="admin-hub-actions-heading"
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          <h3 id="admin-hub-actions-heading" className="text-base font-semibold text-slate-900">
            {t('admin.hubOverview.actionNeeded', 'Handlungsbedarf')}
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            {t(
              'admin.hubOverview.actionNeededHint',
              'Nur echte Störungen, Konfigurationslücken und Indexfehler aus aktuellen Systemdaten.',
            )}
          </p>
        </div>
        {actionItems.length === 0 ? (
          <div
            className="flex items-start gap-3 px-4 py-6 sm:px-5 text-sm text-slate-700"
            role="status"
          >
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-slate-900">
                {t('admin.hubOverview.noActions', 'Kein Handlungsbedarf')}
              </p>
              <p className="mt-0.5 text-slate-600">
                {t(
                  'admin.hubOverview.noActionsDetail',
                  'Alle geprüften Subsysteme melden derzeit keinen offenen Handlungsbedarf.',
                )}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {actionItems.map((item) => (
              <ActionRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      {/* Secondary operational metrics */}
      <section aria-labelledby="admin-hub-metrics-heading" className="space-y-3">
        <div>
          <h3 id="admin-hub-metrics-heading" className="text-base font-semibold text-slate-900">
            {t('admin.hubOverview.metrics', 'Betriebskennzahlen')}
          </h3>
          <p className="text-sm text-slate-600">
            {t(
              'admin.hubOverview.metricsHint',
              'Bestands- und Nutzungswerte aus der Datenbank — kein SLA und keine synthetische Latenz.',
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MetricTile
            label={t('admin.hubOverview.metricAgents', 'Aktive Benutzer')}
            value={telemetry.activeAgents.toLocaleString('de-DE')}
            hint={t('admin.hubOverview.metricAgentsHint', 'Benutzer mit aktivem Status')}
          />
          <MetricTile
            label={t('admin.hubOverview.metricTickets', 'Tickets gesamt')}
            value={(telemetry.ticketsTotal ?? telemetry.ticketsProcessed ?? 0).toLocaleString('de-DE')}
            hint={t('admin.hubOverview.metricTicketsHint', 'Anzahl Datensätze in tickets')}
          />
          <MetricTile
            label={t('admin.hubOverview.metricKb', 'KB-Artikel')}
            value={telemetry.knowledgeArticles.toLocaleString('de-DE')}
            hint={t('admin.hubOverview.metricKbHint', 'Artikel in der Wissensdatenbank')}
          />
          <MetricTile
            label={t('admin.hubOverview.metricVectors', 'Index-Chunks')}
            value={telemetry.activeVectors.toLocaleString('de-DE')}
            hint={t('admin.hubOverview.metricVectorsHint', 'Einträge in KnowledgeEmbedding')}
          />
        </div>
      </section>

      {/* Collapsible details */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((o) => !o)}
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {t('admin.hubOverview.details', 'Details')}
            </h3>
            <p className="text-sm text-slate-600">
              {t(
                'admin.hubOverview.detailsHint',
                'Weitere Zähler, Anbieterliste und Hinweise zu nicht verfügbaren Metriken.',
              )}
            </p>
          </div>
          {detailsOpen ? (
            <ChevronDown className="w-5 h-5 text-slate-500 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-500 shrink-0" aria-hidden />
          )}
        </button>
        {detailsOpen ? (
          <div id={detailsId} className="border-t border-slate-100 px-4 py-4 sm:px-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MetricTile
                label={t('admin.hubOverview.metricVault', 'Vault-Einträge')}
                value={telemetry.vaultSecrets.toLocaleString('de-DE')}
                hint={t('admin.hubOverview.metricVaultHint', 'Verschlüsselte Tresorspeicher')}
              />
              <MetricTile
                label={t('admin.hubOverview.metricAiReq', 'KI-Anfragen (Log)')}
                value={telemetry.aiRequests.toLocaleString('de-DE')}
                hint={t(
                  'admin.hubOverview.metricAiReqHint',
                  'Zeilen in ai_usage_log (Workspace default)',
                )}
              />
              <MetricTile
                label={t('admin.hubOverview.metricAvgLatency', 'Ø KI-Latenz')}
                value={
                  telemetry.avgAiLatencyMs != null
                    ? `${telemetry.avgAiLatencyMs.toLocaleString('de-DE')} ms`
                    : '—'
                }
                hint={t(
                  'admin.hubOverview.metricAvgLatencyHint',
                  'Mittelwert latency_ms aus ai_usage_log; „—“ wenn keine Samples',
                )}
              />
              <MetricTile
                label={t('admin.hubOverview.metricPrimaryModel', 'Primärmodell')}
                value={telemetry.primaryModel ?? '—'}
                hint={t('admin.hubOverview.metricPrimaryModelHint', 'Aus Orchestrator-Konfiguration')}
              />
            </div>

            {telemetry.providers.length > 0 ? (
              <div>
                <h4 className="text-sm font-semibold text-slate-900 mb-2">
                  {t('admin.hubOverview.providers', 'KI-Anbieter (Live-Probe)')}
                </h4>
                <ul className="space-y-2">
                  {telemetry.providers.map((p) => {
                    const st =
                      p.status === 'online'
                        ? 'ok'
                        : p.status === 'degraded' || p.status === 'missing_key'
                          ? 'degraded'
                          : 'error';
                    const meta = stateMeta(st);
                    const Icon = meta.Icon;
                    return (
                      <li
                        key={p.provider}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm"
                      >
                        <span className="font-medium text-slate-800">{p.label}</span>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold',
                            meta.badgeClass,
                          )}
                        >
                          <Icon className={cn('w-3.5 h-3.5', meta.className)} aria-hidden />
                          {p.status === 'online'
                            ? 'Online'
                            : p.status === 'missing_key'
                              ? 'Kein Schlüssel'
                              : p.status === 'degraded'
                                ? 'Eingeschränkt'
                                : 'Offline'}
                          {p.latencyMs != null && p.status === 'online'
                            ? ` · ${p.latencyMs} ms`
                            : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900 mb-1">
                {t('admin.hubOverview.unavailableTitle', 'Nicht verfügbare Metriken')}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  {t(
                    'admin.hubOverview.unavailableSla',
                    'SLA-Uptime / 30-Tage-Verfügbarkeit — keine Messreihe im Backend.',
                  )}
                </li>
                <li>
                  {t(
                    'admin.hubOverview.unavailableP99',
                    'P99-Redaction-Latenz — wird nicht erfasst (nur Ø latency_ms in ai_usage_log).',
                  )}
                </li>
                <li>
                  {t(
                    'admin.hubOverview.unavailableBackup',
                    'Backup-Status — keine Live-Backup-Health-API; siehe Infrastruktur & Backups / Datenimport.',
                  )}
                </li>
                <li>
                  {t(
                    'admin.hubOverview.unavailableProcessed',
                    '„Verarbeitete Tickets“ als Durchsatz — nur Gesamtbestand (tickets) vorhanden.',
                  )}
                </li>
              </ul>
              <p className="mt-2">
                <Link
                  to="/admin?tab=system"
                  className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                >
                  {t('admin.hubOverview.gotoSystem', 'Zur Infrastruktur & Backups')}
                </Link>
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SubsystemRow({ subsystem }: { subsystem: AdminHubSubsystemStatus }) {
  const meta = stateMeta(subsystem.state);
  const Icon = meta.Icon;
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{subsystem.label}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold',
              meta.badgeClass,
            )}
          >
            <Icon className={cn('w-3.5 h-3.5', meta.className)} aria-hidden />
            {meta.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{subsystem.detail}</p>
        <p className="mt-1 text-xs text-slate-500">
          Letzte Prüfung: <time dateTime={subsystem.checkedAt}>{formatCheckedAt(subsystem.checkedAt)}</time>
        </p>
      </div>
      <Link
        to={subsystem.href}
        className="inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Öffnen
        <ExternalLink className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </li>
  );
}

function ActionRow({ item }: { item: AdminHubActionItem }) {
  const isError = item.severity === 'error';
  return (
    <li className="flex flex-col gap-2 px-4 py-3.5 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        {isError ? (
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" aria-hidden />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            <span className="sr-only">{isError ? 'Fehler: ' : 'Warnung: '}</span>
            {item.title}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
        </div>
      </div>
      <Link
        to={item.href}
        className="inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Beheben
        <ChevronRight className="w-3.5 h-3.5" aria-hidden />
      </Link>
    </li>
  );
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500 leading-snug">{hint}</p>
    </div>
  );
}
