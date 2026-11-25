import { useEffect, useState } from 'react';
import { Loader2, Package, Plug, Settings2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';

interface HardwareReturnsModuleCardProps {
  organizationId: string;
  enabled: boolean;
  config?: Record<string, unknown> | null;
  onSaved?: (next: {
    hardware_returns_enabled: boolean;
    hardware_returns_config: Record<string, unknown>;
  }) => void;
}

export function HardwareReturnsModuleCard({
  organizationId,
  enabled,
  config,
  onSaved,
}: HardwareReturnsModuleCardProps) {
  const syncCfg = (config?.m365_directory_sync as Record<string, unknown> | undefined) || {};
  const [active, setActive] = useState(Boolean(enabled));
  const [ceoName, setCeoName] = useState(String(config?.ceo_name || ''));
  const [ceoEmail, setCeoEmail] = useState(String(config?.ceo_email || ''));
  const [fallbackManager, setFallbackManager] = useState(
    String(config?.fallback_manager_email || ''),
  );
  const [mail1Days, setMail1Days] = useState(Number(config?.mail1_days_after_delivery ?? 14));
  const [dirSyncEnabled, setDirSyncEnabled] = useState(Boolean(syncCfg.enabled));
  const [entraGroupId, setEntraGroupId] = useState(String(syncCfg.entra_group_id || ''));
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    syncCfg.last_synced_at ? String(syncCfg.last_synced_at) : null,
  );
  const [lastSyncCount, setLastSyncCount] = useState(Number(syncCfg.last_sync_count || 0));
  const [lastSyncError, setLastSyncError] = useState<string | null>(
    syncCfg.last_sync_error ? String(syncCfg.last_sync_error) : null,
  );
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const nextSync = (config?.m365_directory_sync as Record<string, unknown> | undefined) || {};
    setActive(Boolean(enabled));
    setCeoName(String(config?.ceo_name || ''));
    setCeoEmail(String(config?.ceo_email || ''));
    setFallbackManager(String(config?.fallback_manager_email || ''));
    setMail1Days(Number(config?.mail1_days_after_delivery ?? 14));
    setDirSyncEnabled(Boolean(nextSync.enabled));
    setEntraGroupId(String(nextSync.entra_group_id || ''));
    setLastSyncedAt(nextSync.last_synced_at ? String(nextSync.last_synced_at) : null);
    setLastSyncCount(Number(nextSync.last_sync_count || 0));
    setLastSyncError(nextSync.last_sync_error ? String(nextSync.last_sync_error) : null);
  }, [enabled, config, organizationId]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await axios.put(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/hardware-returns`,
        {
          hardware_returns_enabled: active,
          hardware_returns_config: {
            ...(config || {}),
            ceo_name: ceoName.trim() || null,
            ceo_email: ceoEmail.trim() || null,
            fallback_manager_email: fallbackManager.trim() || null,
            mail1_days_after_delivery: mail1Days,
            auto_send_enabled: false,
            m365_directory_sync: {
              ...((config?.m365_directory_sync as Record<string, unknown>) || {}),
              enabled: dirSyncEnabled,
              entra_group_id: entraGroupId.trim() || null,
            },
          },
        },
        { withCredentials: true },
      );
      const org = res.data?.organization;
      toast.success(
        active
          ? 'Hardware-Rücklieferungen aktiviert'
          : 'Hardware-Rücklieferungen deaktiviert',
      );
      onSaved?.({
        hardware_returns_enabled: Boolean(org?.hardware_returns_enabled),
        hardware_returns_config: org?.hardware_returns_config || {},
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const runDirectorySync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(
        '/api/returns/directory-sync',
        { organizationId },
        {
          withCredentials: true,
          params: { organizationId },
        },
      );
      setLastSyncedAt(res.data?.lastSyncedAt || new Date().toISOString());
      setLastSyncCount(Number(res.data?.syncedCount || 0));
      setLastSyncError(null);
      toast.success(`${res.data?.syncedCount || 0} Mitarbeiter synchronisiert`);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Synchronisation fehlgeschlagen';
      setLastSyncError(msg);
      toast.error(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section
      className={cn(
        'rounded-2xl border bg-white p-5 space-y-4',
        active ? 'border-emerald-200 shadow-sm shadow-emerald-50' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Package className="w-4 h-4 text-emerald-600" />
            Module &amp; Erweiterungen
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            Hardware-Rücklieferungen &amp; SL-Abrechnung — nur für diese Organisation sichtbar,
            wenn aktiviert (z.&nbsp;B. DPG).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor="hw-module-toggle" className="text-xs font-semibold text-slate-600">
            {active ? 'Aktiv' : 'Aus'}
          </Label>
          <Switch
            id="hw-module-toggle"
            checked={active}
            onCheckedChange={setActive}
          />
        </div>
      </div>

      {active ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Geschäftsführung Name
            </Label>
            <Input value={ceoName} onChange={(e) => setCeoName(e.target.value)} placeholder="Name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Geschäftsführung E-Mail
            </Label>
            <Input
              type="email"
              value={ceoEmail}
              onChange={(e) => setCeoEmail(e.target.value)}
              placeholder="ceo@firma.de"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Fallback IT-Leitung / Chef E-Mail
            </Label>
            <Input
              type="email"
              value={fallbackManager}
              onChange={(e) => setFallbackManager(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              1. Mail — Tage nach Lieferung
            </Label>
            <Input
              type="number"
              min={0}
              max={365}
              value={mail1Days}
              onChange={(e) => setMail1Days(Number(e.target.value) || 0)}
            />
          </div>
        </div>
      ) : null}

      {active ? (
        <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Plug className="w-4 h-4 text-sky-700" />
                M365 Mitarbeiter-Sync (Entra ID)
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Verzeichnis für Autovervollständigung — getrennt von Portal-Login-Benutzern.
                Nutzt die M365 Tenant &amp; Send-As App-Registrierung.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="hw-dir-sync" className="text-xs font-semibold text-slate-600">
                {dirSyncEnabled ? 'An' : 'Aus'}
              </Label>
              <Switch
                id="hw-dir-sync"
                checked={dirSyncEnabled}
                onCheckedChange={setDirSyncEnabled}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
              Entra ID Gruppen-ID (optional)
            </Label>
            <Input
              value={entraGroupId}
              onChange={(e) => setEntraGroupId(e.target.value)}
              placeholder="Leer = alle aktiven Member-Benutzer"
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-[11px] text-slate-600">
              {lastSyncedAt
                ? `Zuletzt synchronisiert: ${new Date(lastSyncedAt).toLocaleString('de-DE', {
                    timeZone: 'Europe/Berlin',
                  })} (${lastSyncCount} Mitarbeiter)`
                : 'Noch nicht synchronisiert'}
            </p>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs font-bold"
              disabled={syncing || !active}
              onClick={() => void runDirectorySync()}
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-1.5" />
              )}
              Jetzt synchronisieren
            </Button>
          </div>
          {lastSyncError ? (
            <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">
              {lastSyncError}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <Settings2 className="w-3.5 h-3.5" />
          {advancedOpen ? 'Empfänger-Defaults ausblenden' : 'Empfänger-Defaults anzeigen'}
        </button>
        <Button type="button" onClick={() => void save()} disabled={saving} className="h-9 font-bold">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
          Speichern
        </Button>
      </div>

      {advancedOpen ? (
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-[11px] text-slate-600 space-y-1.5">
          <p>
            <strong>Mail 1:</strong> An Mitarbeiter
          </p>
          <p>
            <strong>Mail 2:</strong> An Mitarbeiter · CC Projektmanager
          </p>
          <p>
            <strong>Mail 3:</strong> An Mitarbeiter · CC Projektmanager, Vorgesetzter, Geschäftsführung
          </p>
          <p className="text-slate-400 pt-1">
            Verzeichnis-Sync speichert nur in <code>organization_directory_users</code> — nie in Portal-Login-Benutzern.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export default HardwareReturnsModuleCard;
