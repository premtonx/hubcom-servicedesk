import type { ReactNode } from 'react';
import { Database, HardDrive, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../../lib/context/I18nContext';
import { AdminHubDemoDataCard } from './AdminHubDemoDataCard';
import { overallStateLabelDe, type AdminHubTelemetry } from './adminHubTelemetry';

interface AdminHubSystemTabProps {
  telemetry: AdminHubTelemetry;
  onTelemetryRefresh?: () => void;
}

export function AdminHubSystemTab({ telemetry, onTelemetryRefresh }: AdminHubSystemTabProps) {
  const { t } = useTranslation();
  const inventory =
    telemetry.assetsManaged ??
    (telemetry.ticketsTotal ?? 0) + (telemetry.vaultSecrets ?? 0) + (telemetry.knowledgeArticles ?? 0);

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SystemTile
          icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />}
          label={t('admin.hubSys.health', 'Steuerungsebene')}
          value={overallStateLabelDe(telemetry.overallState ?? 'unknown')}
          hint={t(
            'admin.hubSys.healthHint',
            'Gesamtstatus aus Live-Subsystemen (siehe Übersicht) — kein SLA-Prozent',
          )}
        />
        <SystemTile
          icon={<HardDrive className="w-4 h-4 text-slate-500" />}
          label={t('admin.hubSys.assets', 'Verwaltete Datensätze')}
          value={inventory.toLocaleString('de-DE')}
          hint={t('admin.hubSys.assetsHint', 'Tickets, Tresor-Einträge und KB-Artikel')}
        />
        <SystemTile
          icon={<Database className="w-4 h-4 text-cyan-600" />}
          label={t('admin.hubSys.backup', 'Import & Wiederherstellung')}
          value={t('admin.hubSys.backupValue', 'CSV / JSON')}
          hint={t(
            'admin.hubSys.backupHint',
            'Kein Live-Backup-Status — Datenimport für Migrationen nutzen',
          )}
        />
      </div>

      <AdminHubDemoDataCard onChanged={onTelemetryRefresh} />
    </div>
  );
}

function SystemTile({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-white border border-slate-200/80 rounded-[2rem] p-6 shadow-sm">
      <div className="flex items-center gap-2 text-slate-400 mb-3">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-2xl font-black text-slate-900">{value}</div>
      <p className="text-sm text-slate-500 mt-2">{hint}</p>
    </div>
  );
}
