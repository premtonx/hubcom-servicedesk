import { ReturnsWorkbench } from '../../returns/ReturnsWorkbench';

interface CompanyReturnsTabProps {
  organizationId: string | null | undefined;
}

export default function CompanyReturnsTab({ organizationId }: CompanyReturnsTabProps) {
  if (!organizationId) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">
        Keine Organisation verknüpft — Hardware-Rücklieferungen nicht verfügbar.
      </div>
    );
  }
  return (
    <ReturnsWorkbench
      mode="staff"
      organizationId={organizationId}
      canEditSettings
      canImportCsv
    />
  );
}
