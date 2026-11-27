import { useOutletContext, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  buildAdminHubNavBereiche,
  firstNavChildPath,
  resolveAdminHubTab,
  type AdminHubTabId,
} from '../../components/admin/hub/adminHubConfig';
import { AdminHubOverviewTab } from '../../components/admin/hub/AdminHubOverviewTab';
import { AdminHubAiEngineTab } from '../../components/admin/hub/AdminHubAiEngineTab';
import { AdminHubRagTab } from '../../components/admin/hub/AdminHubRagTab';
import { AdminHubSystemTab } from '../../components/admin/hub/AdminHubSystemTab';
import type { AdminHubTelemetry } from '../../components/admin/hub/adminHubTelemetry';

type AdminHubOutletContext = {
  telemetry: AdminHubTelemetry;
  refreshTelemetry: () => void;
};

/** Tabs that only existed as card-grid overviews — bounce to first submenu item. */
const REDIRECT_ONLY_TABS: ReadonlyArray<AdminHubTabId> = [
  'kunden',
  'governance',
  'integrations',
];

export default function AdminHubPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveAdminHubTab(searchParams.get('tab'));
  const { telemetry, refreshTelemetry } = useOutletContext<AdminHubOutletContext>();

  const redirectTarget = useMemo(() => {
    if (!REDIRECT_ONLY_TABS.includes(activeTab)) return null;
    const bereich = buildAdminHubNavBereiche().find((b) => b.id === activeTab);
    if (!bereich) return null;
    return firstNavChildPath(bereich);
  }, [activeTab]);

  useEffect(() => {
    if (redirectTarget) {
      navigate(redirectTarget, { replace: true });
      return;
    }
    const raw = searchParams.get('tab');
    if (raw === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchParams, setSearchParams, navigate, redirectTarget]);

  if (redirectTarget) {
    return null;
  }

  return (
    <div className="p-6 lg:p-8 pb-20 max-w-6xl w-full">
      {activeTab === ('uebersicht' satisfies AdminHubTabId) ? (
        <AdminHubOverviewTab telemetry={telemetry} onTelemetryRefresh={refreshTelemetry} />
      ) : null}
      {activeTab === ('ai-engine' satisfies AdminHubTabId) ? (
        <AdminHubAiEngineTab telemetry={telemetry} />
      ) : null}
      {activeTab === ('rag' satisfies AdminHubTabId) ? <AdminHubRagTab /> : null}
      {activeTab === ('system' satisfies AdminHubTabId) ? (
        <AdminHubSystemTab telemetry={telemetry} onTelemetryRefresh={refreshTelemetry} />
      ) : null}
    </div>
  );
}
