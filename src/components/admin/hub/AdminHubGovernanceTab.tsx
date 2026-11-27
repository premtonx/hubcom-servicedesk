import { Navigate } from 'react-router-dom';
import { buildAdminHubNavBereiche, firstNavChildPath } from './adminHubConfig';

/**
 * PII & Compliance — no card-grid overview; bounce to the first submenu item.
 */
export function AdminHubGovernanceTab() {
  const bereich = buildAdminHubNavBereiche().find((b) => b.id === 'governance');
  const target = bereich ? firstNavChildPath(bereich) : '/admin/sovereignty';
  return <Navigate to={target || '/admin/sovereignty'} replace />;
}
