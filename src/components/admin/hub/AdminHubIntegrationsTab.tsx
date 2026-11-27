import { Navigate } from 'react-router-dom';

/**
 * Mail & Schnittstellen hub tab — opens the contextual secondary-nav workspace
 * on E-Mail-Kanäle (Übersicht) instead of the legacy 5-card grid.
 */
export function AdminHubIntegrationsTab() {
  return (
    <Navigate to="/admin/mail?section=email-channels&tab=overview" replace />
  );
}
