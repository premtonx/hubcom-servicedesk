/**
 * Angriffsschutz & Sperrliste — German security monitor under PII & Compliance.
 * Uses /api/admin/security/* only (never /api/db).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  createManualBan,
  fetchSecurityAuditLogs,
  fetchSecurityBans,
  fetchSecurityOverview,
  unbanSecurityTarget,
  type SecurityAuditLog,
  type SecurityBan,
  type SecurityOverview,
} from '../../services/securityAdminApi';
import { useStaffSession } from '../../hooks/useStaffSession';

const EVENT_LABELS: Record<string, string> = {
  failed_login: 'Fehlgeschlagene Logins',
  login_lockout: 'Login-Sperren',
  honeypot_probe: 'Honeypot-Angriffe',
  cross_tenant_probe_ban: 'Unbefugte Mandanten-Zugriffe',
  role_change: 'Rollenänderungen',
  m365_sso_approval: 'M365-SSO-Freigaben',
  manual_ban: 'Manuelle Sperren',
  manual_unban: 'Sperren aufgehoben',
  csrf_blocked: 'CSRF-Blockaden',
  rate_limited: 'Rate-Limits',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warnung',
  critical: 'Kritisch',
};

function formatRemaining(until: string | null): string {
  if (!until) return 'Permanent';
  const ms = Date.parse(until) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Abgelaufen';
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} Min.`;
  const hours = Math.ceil(mins / 60);
  if (hours < 48) return `${hours} Std.`;
  return `${Math.ceil(hours / 24)} Tage`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  } catch {
    return iso;
  }
}

export default function SecurityMonitorPage() {
  const { canManageHubcomCore, loading: sessionLoading } = useStaffSession();
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [bans, setBans] = useState<SecurityBan[]>([]);
  const [logs, setLogs] = useState<SecurityAuditLog[]>([]);
  const [severity, setSeverity] = useState<string>('');
  const [eventType, setEventType] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualType, setManualType] = useState<'ip' | 'account'>('ip');
  const [manualTarget, setManualTarget] = useState('');
  const [manualReason, setManualReason] = useState('Manuelle Sperre');
  const [manualHours, setManualHours] = useState('24');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ov, bn, lg] = await Promise.all([
        fetchSecurityOverview(),
        fetchSecurityBans(),
        fetchSecurityAuditLogs({
          severity: severity || undefined,
          event_type: eventType || undefined,
        }),
      ]);
      setOverview(ov.overview);
      setBans(bn.bans || []);
      setLogs(lg.logs || []);
    } catch (e: any) {
      setError(e?.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }, [severity, eventType]);

  useEffect(() => {
    if (!canManageHubcomCore) return;
    void load();
  }, [canManageHubcomCore, load]);

  const criticalHint = useMemo(() => {
    if (!overview) return null;
    return `${overview.critical_events_24h} kritische Ereignisse (24 Std.)`;
  }, [overview]);

  if (sessionLoading) {
    return <div className="p-8 text-slate-500">Sitzung wird geladen…</div>;
  }

  if (!canManageHubcomCore) {
    return (
      <div className="p-8">
        <p className="text-slate-700">
          Keine Berechtigung für den Sicherheitsmonitor. Nur Hubcom-Admins.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Angriffsschutz &amp; Sperrliste
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Aktive Sperren, Honeypot-Fallen und kritische Sicherheitsereignisse — nur
            für Hubcom-Administratoren. Audit-Protokoll ist schreibgeschützt
            (append-only).
          </p>
          {criticalHint ? (
            <p className="mt-2 text-xs font-semibold text-rose-700">{criticalHint}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" />
          Aktualisieren
        </button>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {overview ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Aktive Sperren" value={overview.active_bans} icon={Ban} />
          <StatCard
            label="Kritisch (24 Std.)"
            value={overview.critical_events_24h}
            icon={AlertTriangle}
          />
          <StatCard
            label="Honeypot (24 Std.)"
            value={overview.honeypot_24h}
            icon={ShieldAlert}
          />
          <StatCard
            label="Fehl-Logins (24 Std.)"
            value={overview.failed_logins_24h}
            icon={ShieldAlert}
          />
          <StatCard
            label="Mandanten-Sonden (24 Std.)"
            value={overview.cross_tenant_24h}
            icon={ShieldCheck}
          />
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Aktive Sperren</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Ziel</th>
                <th className="px-4 py-3">Grund</th>
                <th className="px-4 py-3">Restlaufzeit</th>
                <th className="px-4 py-3">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {loading && bans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    Wird geladen…
                  </td>
                </tr>
              ) : null}
              {!loading && bans.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    Keine aktiven Sperren.
                  </td>
                </tr>
              ) : null}
              {bans.map((ban) => (
                <tr key={ban.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {ban.ban_type === 'ip' ? 'IP' : 'Konto'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {ban.target_value}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ban.reason}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatRemaining(ban.banned_until)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={busyId === ban.id}
                      onClick={async () => {
                        setBusyId(ban.id);
                        try {
                          await unbanSecurityTarget(ban.id);
                          await load();
                        } catch (e: any) {
                          setError(e?.message || 'Aufheben fehlgeschlagen');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Sperre aufheben
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold text-slate-900">Manuelle Sperre</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-600">
            Typ
            <select
              className="mt-1 block rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={manualType}
              onChange={(e) => setManualType(e.target.value as 'ip' | 'account')}
            >
              <option value="ip">IP</option>
              <option value="account">Konto (E-Mail / User-ID)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Ziel
            <input
              className="mt-1 block w-56 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={manualTarget}
              onChange={(e) => setManualTarget(e.target.value)}
              placeholder={manualType === 'ip' ? '203.0.113.10' : 'user@firma.de'}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Grund
            <input
              className="mt-1 block w-48 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Dauer (Stunden, leer = permanent)
            <input
              className="mt-1 block w-28 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={manualHours}
              onChange={(e) => setManualHours(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800"
            onClick={async () => {
              if (!manualTarget.trim()) return;
              setBusyId('manual');
              try {
                const hoursRaw = manualHours.trim();
                await createManualBan({
                  ban_type: manualType,
                  target_value: manualTarget.trim(),
                  reason: manualReason.trim() || 'manual',
                  duration_hours: hoursRaw ? Number(hoursRaw) : null,
                });
                setManualTarget('');
                await load();
              } catch (e: any) {
                setError(e?.message || 'Sperre fehlgeschlagen');
              } finally {
                setBusyId(null);
              }
            }}
          >
            Sperren
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            Kritische Sicherheitsereignisse
          </h2>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">Alle Schweregrade</option>
              <option value="critical">Kritisch</option>
              <option value="warning">Warnung</option>
              <option value="info">Info</option>
            </select>
            <select
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              <option value="">Alle Ereignistypen</option>
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Zeit</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Schwere</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Pfad</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-slate-500">
                    Keine Ereignisse für den aktuellen Filter.
                  </td>
                </tr>
              ) : null}
              {logs.map((log) => (
                <tr key={log.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {formatWhen(log.created_at)}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">
                    {EVENT_LABELS[log.event_type] || log.event_type}
                  </td>
                  <td className="px-4 py-3">
                    <SeverityPill severity={log.severity} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {log.ip_address || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {log.path || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Ban;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const cls =
    severity === 'critical'
      ? 'bg-rose-100 text-rose-800'
      : severity === 'warning'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-100 text-slate-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}>
      {SEVERITY_LABELS[severity] || severity}
    </span>
  );
}
