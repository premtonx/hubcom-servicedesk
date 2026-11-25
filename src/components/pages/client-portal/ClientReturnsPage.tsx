import { Navigate } from 'react-router-dom';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { ReturnsWorkbench } from '../../returns/ReturnsWorkbench';
import { useEffect, useState } from 'react';
import axios from 'axios';
import {
  evaluatePortalReturnsPageAccess,
  resolveHardwareReturnsModuleFlag,
} from '../../../lib/client-portal/hardware-returns-nav';

/**
 * DPG (and other module-enabled orgs) Rücklieferungen workbench.
 * Waits for session + /api/portal/me before redirecting so hard refresh
 * and sidebar clicks do not bounce back to /portal/dashboard.
 */
export default function ClientReturnsPage() {
  const { session, isClient, isClientAdmin, loading: sessionLoading } = useClientPortalSession();
  const [moduleEnabled, setModuleEnabled] = useState<boolean | null>(null);
  const [moduleLoading, setModuleLoading] = useState(true);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session?.organizationId) {
      setModuleEnabled(false);
      setModuleLoading(false);
      return;
    }
    let active = true;
    setModuleLoading(true);
    void axios
      .get('/api/portal/me', { withCredentials: true })
      .then((res) => {
        if (!active) return;
        setModuleEnabled(resolveHardwareReturnsModuleFlag(res.data));
      })
      .catch(() => {
        if (active) setModuleEnabled(false);
      })
      .finally(() => {
        if (active) setModuleLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.organizationId, sessionLoading]);

  const gate = evaluatePortalReturnsPageAccess({
    sessionLoading,
    moduleLoading,
    isClient,
    role: session?.role,
    moduleEnabled,
  });

  if (gate.action === 'spinner') {
    return (
      <div className="p-10 flex justify-center" aria-busy="true" aria-label="Laden">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  if (gate.action === 'redirect') {
    return <Navigate to={gate.to} replace />;
  }

  if (!session) {
    return <Navigate to="/portal/dashboard" replace />;
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto">
      <ReturnsWorkbench
        mode="portal"
        organizationId={session.organizationId}
        canEditSettings={isClientAdmin}
        canImportCsv={isClientAdmin}
      />
    </div>
  );
}
