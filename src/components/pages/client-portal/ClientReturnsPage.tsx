import { Navigate } from 'react-router-dom';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { ReturnsWorkbench } from '../../returns/ReturnsWorkbench';
import { useEffect, useState } from 'react';
import axios from 'axios';

export default function ClientReturnsPage() {
  const { session, isOrgWide, isClientAdmin } = useClientPortalSession();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void axios
      .get('/api/portal/me', { withCredentials: true })
      .then((res) => {
        if (!active) return;
        setEnabled(Boolean(res.data?.enabledModules?.hardwareReturns));
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, [session?.organizationId]);

  if (!session || !isOrgWide) {
    return <Navigate to="/portal/dashboard" replace />;
  }
  if (enabled === false) {
    return <Navigate to="/portal/dashboard" replace />;
  }
  if (enabled === null) {
    return (
      <div className="p-10 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
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
