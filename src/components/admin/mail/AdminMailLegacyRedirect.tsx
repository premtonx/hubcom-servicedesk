import { Navigate, useLocation } from 'react-router-dom';
import { legacyAdminPathToMailWorkspace } from '../../../lib/admin/mail-integrations-nav';

/** Redirect legacy Mail & Schnittstellen paths into /admin/mail?section=&tab=. */
export default function AdminMailLegacyRedirect() {
  const location = useLocation();
  const target =
    legacyAdminPathToMailWorkspace(location.pathname) ||
    '/admin/mail?section=email-channels&tab=overview';
  return <Navigate to={target} replace />;
}
