import { Navigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import {
  evaluatePortalReturnsPageAccess,
  resolveHardwareReturnsModuleFlag,
} from '../../../lib/client-portal/hardware-returns-nav';
import { ReturnEditorPage } from '../../returns/ReturnEditorPage';

/**
 * Portal full-page create/edit for Rücklieferungen.
 * Routes: /portal/returns/new · /portal/returns/:id
 */
export default function ClientReturnEditorPage() {
  const { id } = useParams();
  const { session, isClient, loading: sessionLoading } = useClientPortalSession();
  const [moduleEnabled, setModuleEnabled] = useState<boolean | null>(null);
  const [moduleLoading, setModuleLoading] = useState(true);

  const returnId = id && id !== 'new' ? id : null;

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
    <ReturnEditorPage
      mode="portal"
      organizationId={session.organizationId}
      returnId={returnId}
      listPath="/portal/returns"
    />
  );
}
