import { useEffect, useState, type FormEvent } from 'react';
import { Clock, CloudUpload, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { timeEntryService } from '../../services/timeEntryService';
import type {
  TimeMonthlySyncDay,
  TimeTrackingSettings,
  TimeSyncInterval,
} from '../../lib/time-tracking/types';
import { DEFAULT_TIME_TRACKING_SETTINGS } from '../../lib/time-tracking/types';
import { useTranslation } from '../../lib/context/I18nContext';

export default function TimeTrackingAdminPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TimeTrackingSettings>(DEFAULT_TIME_TRACKING_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [monthlyRunning, setMonthlyRunning] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await timeEntryService.getSettings();
        setSettings(loaded);
      } catch (err: any) {
        toast.error(err?.message || 'Einstellungen konnten nicht geladen werden.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await timeEntryService.saveSettings(settings);
      setSettings(saved);
      toast.success('Zeiterfassungs-Einstellungen gespeichert.');
    } catch (err: any) {
      toast.error(err?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const onSyncGraph = async () => {
    setSyncing(true);
    try {
      const result = await timeEntryService.syncGraph(true);
      toast.success(result.message || 'Graph-Sync abgeschlossen.');
      const refreshed = await timeEntryService.getSettings();
      setSettings(refreshed);
    } catch (err: any) {
      toast.error(err?.message || 'Graph-Sync fehlgeschlagen.');
    } finally {
      setSyncing(false);
    }
  };

  const onRunMonthly = async () => {
    setMonthlyRunning(true);
    try {
      const result = await timeEntryService.runMonthlySync();
      if (result.error) toast.error(result.error);
      else toast.success(`Monats-Sync: ${result.exported ?? 0} Einträge exportiert.`);
      const refreshed = await timeEntryService.getSettings();
      setSettings(refreshed);
    } catch (err: any) {
      toast.error(err?.message || 'Monats-Sync fehlgeschlagen.');
    } finally {
      setMonthlyRunning(false);
    }
  };

  const onRunJob = async () => {
    try {
      const result = await timeEntryService.runExportJob(true);
      toast.success(
        result.filePath
          ? `Export erzeugt: ${result.filePath}`
          : 'Export-Job ausgeführt.',
      );
    } catch (err: any) {
      toast.error(err?.message || 'Export-Job fehlgeschlagen.');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-20">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#fafafa]">
      <div className="p-8 max-w-4xl mx-auto space-y-8 pb-20">
<div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E8F1F8] flex items-center justify-center">
            <Clock className="w-5 h-5 text-[#1B6CA8]" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#0B1F3A] tracking-tight">
              {t('timeTracking.adminTitle', 'Zeiterfassung & Stundensätze')}
            </h1>
            <p className="text-sm text-slate-500">
              {t(
                'timeTracking.adminDesc',
                'Standard- und Sonderzahlungssätze sowie Microsoft Graph Excel-Synchronisation.',
              )}
            </p>
          </div>
        </div>

        <form onSubmit={onSave} className="space-y-6">
          <Card className="rounded-[2rem] shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle>Stundensätze (EUR)</CardTitle>
              <CardDescription>
                Diese Sätze gelten beim Erfassen neuer Zeiten und beim Umschalten der Sonderzahlung.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Standard-Stundensatz (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={settings.standardHourlyRate}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      standardHourlyRate: Number(e.target.value) || 0,
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sonderzahlung-Stundensatz (€)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={settings.specialHourlyRate}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      specialHourlyRate: Number(e.target.value) || 0,
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] shadow-sm border-slate-200">
            <CardHeader>
              <CardTitle>Hintergrund-Job</CardTitle>
              <CardDescription>
                Erzeugt regelmäßig eine Gesamt-Excel-Datei und synct optional nach Microsoft Graph.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Intervall</Label>
                <select
                  className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
                  value={settings.syncInterval}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      syncInterval: e.target.value as TimeSyncInterval,
                    }))
                  }
                >
                  <option value="hourly">Stündlich</option>
                  <option value="daily">Täglich (ca. 02:00 UTC)</option>
                  <option value="monthly">Monatlich (siehe SharePoint Auto-Sync)</option>
                  <option value="disabled">Deaktiviert</option>
                </select>
              </div>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => void onRunJob()}>
                Export-Job jetzt ausführen
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>SharePoint Excel Auto-Sync</CardTitle>
                  <CardDescription>
                    Automatische monatliche Synchronisation unsynchronisierter Einträge
                    (Europe/Berlin) — einmal pro Ausführungstag.
                  </CardDescription>
                </div>
                <Switch
                  checked={settings.monthlySharePointSync.enabled}
                  onCheckedChange={(enabled) =>
                    setSettings((s) => ({
                      ...s,
                      monthlySharePointSync: { ...s.monthlySharePointSync, enabled },
                    }))
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-semibold text-slate-700">
                Automatische monatliche SharePoint-Synchronisation{' '}
                <span
                  className={
                    settings.monthlySharePointSync.enabled
                      ? 'text-emerald-600'
                      : 'text-slate-400'
                  }
                >
                  ({settings.monthlySharePointSync.enabled ? 'aktiv' : 'aus'})
                </span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Ausführungstag im Monat</Label>
                  <select
                    className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm"
                    value={String(settings.monthlySharePointSync.dayOfMonth)}
                    onChange={(e) => {
                      const v = e.target.value;
                      const dayOfMonth: TimeMonthlySyncDay =
                        v === 'last' ? 'last' : (Number(v) as TimeMonthlySyncDay);
                      setSettings((s) => ({
                        ...s,
                        monthlySharePointSync: { ...s.monthlySharePointSync, dayOfMonth },
                      }));
                    }}
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}.
                      </option>
                    ))}
                    <option value="last">Letzter Tag des Monats</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Uhrzeit (Europe/Berlin)</Label>
                  <Input
                    type="time"
                    value={settings.monthlySharePointSync.timeBerlin}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        monthlySharePointSync: {
                          ...s.monthlySharePointSync,
                          timeBerlin: e.target.value || '23:00',
                        },
                      }))
                    }
                    className="rounded-xl"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 space-y-1">
                <p className="font-bold text-slate-800">Letzter Lauf</p>
                <p>
                  {settings.monthlySharePointSync.lastRunAt
                    ? new Date(settings.monthlySharePointSync.lastRunAt).toLocaleString('de-DE', {
                        timeZone: 'Europe/Berlin',
                      })
                    : 'Noch kein Lauf'}
                  {typeof settings.monthlySharePointSync.lastRunExported === 'number'
                    ? ` · ${settings.monthlySharePointSync.lastRunExported} Einträge`
                    : ''}
                </p>
                {settings.monthlySharePointSync.lastRunError ? (
                  <p className="text-rose-600 font-semibold">
                    Fehler: {settings.monthlySharePointSync.lastRunError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={monthlyRunning || !settings.graph.enabled}
                onClick={() => void onRunMonthly()}
              >
                {monthlyRunning ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4 mr-2" />
                )}
                Jetzt synchronisieren
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] shadow-sm border-slate-200">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Microsoft Graph Excel-Synchronisation</CardTitle>
                  <CardDescription>
                    OAuth2 Client Credentials · Upsert über Spalte „Entry-ID“. Site / Drive /
                    Workbook & Worksheet / Table.
                  </CardDescription>
                </div>
                <Switch
                  checked={settings.graph.enabled}
                  onCheckedChange={(enabled) =>
                    setSettings((s) => ({ ...s, graph: { ...s.graph, enabled } }))
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Tenant ID</Label>
                <Input
                  value={settings.graph.tenantId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, graph: { ...s.graph, tenantId: e.target.value } }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input
                  value={settings.graph.clientId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, graph: { ...s.graph, clientId: e.target.value } }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>
                  Client Secret
                  {settings.graph.hasClientSecret ? ' (hinterlegt — leer lassen zum Behalten)' : ''}
                </Label>
                <Input
                  type="password"
                  value={settings.graph.clientSecret}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      graph: { ...s.graph, clientSecret: e.target.value },
                    }))
                  }
                  placeholder={settings.graph.hasClientSecret ? '••••••••' : ''}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SharePoint Site-ID</Label>
                <Input
                  value={settings.graph.siteId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, graph: { ...s.graph, siteId: e.target.value } }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Drive-ID</Label>
                <Input
                  value={settings.graph.driveId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, graph: { ...s.graph, driveId: e.target.value } }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Datei-Pfad oder Workbook-ID</Label>
                <Input
                  value={settings.graph.workbookPathOrId}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      graph: { ...s.graph, workbookPathOrId: e.target.value },
                    }))
                  }
                  placeholder="z. B. Shared Documents/Zeiterfassung.xlsx"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tabellenblatt-Name</Label>
                <Input
                  value={settings.graph.worksheetName}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      graph: { ...s.graph, worksheetName: e.target.value },
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Excel-Tabellenname</Label>
                <Input
                  value={settings.graph.tableName}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      graph: { ...s.graph, tableName: e.target.value },
                    }))
                  }
                  className="rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  disabled={syncing || !settings.graph.enabled}
                  onClick={() => void onSyncGraph()}
                >
                  {syncing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4 mr-2" />
                  )}
                  Jetzt mit Microsoft Graph synchronisieren
                </Button>
              </div>
            </CardContent>
          </Card>

          <Button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[#0B1F3A] hover:bg-[#061525] text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Einstellungen speichern
          </Button>
        </form>
      </div>
    </div>
  );
}
