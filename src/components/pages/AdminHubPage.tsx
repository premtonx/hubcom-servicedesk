import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { resolveAdminHubTab, type AdminHubTabId } from '../../components/admin/hub/adminHubConfig';
import { AdminHubOverviewTab } from '../../components/admin/hub/AdminHubOverviewTab';
import { AdminHubAiEngineTab } from '../../components/admin/hub/AdminHubAiEngineTab';
import { AdminHubRagTab } from '../../components/admin/hub/AdminHubRagTab';
import { AdminHubGovernanceTab } from '../../components/admin/hub/AdminHubGovernanceTab';
import { AdminHubIntegrationsTab } from '../../components/admin/hub/AdminHubIntegrationsTab';
import { AdminHubSystemTab } from '../../components/admin/hub/AdminHubSystemTab';
import type { AdminHubTelemetry } from '../../components/admin/hub/adminHubTelemetry';

type AdminHubOutletContext = {
  telemetry: AdminHubTelemetry;
  refreshTelemetry: () => void;
};

export default function AdminHubPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveAdminHubTab(searchParams.get('tab'));
  const { telemetry, refreshTelemetry } = useOutletContext<AdminHubOutletContext>();

  useEffect(() => {
    if (activeTab === 'kunden') {
      navigate('/admin/customers', { replace: true });
      return;
    }
    const raw = searchParams.get('tab');
    if (raw === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchParams, setSearchParams, navigate]);

  return (
    <div className="p-6 lg:p-8 pb-20 max-w-6xl w-full">
      {activeTab === ('uebersicht' satisfies AdminHubTabId) ? (
        <AdminHubOverviewTab telemetry={telemetry} onTelemetryRefresh={refreshTelemetry} />
      ) : null}
      {activeTab === ('ai-engine' satisfies AdminHubTabId) ? (
        <AdminHubAiEngineTab telemetry={telemetry} />
      ) : null}
      {activeTab === ('rag' satisfies AdminHubTabId) ? <AdminHubRagTab /> : null}
      {activeTab === ('governance' satisfies AdminHubTabId) ? <AdminHubGovernanceTab /> : null}
      {activeTab === ('integrations' satisfies AdminHubTabId) ? <AdminHubIntegrationsTab /> : null}
      {activeTab === ('system' satisfies AdminHubTabId) ? (
        <AdminHubSystemTab telemetry={telemetry} onTelemetryRefresh={refreshTelemetry} />
      ) : null}
    </div>
  );
}
