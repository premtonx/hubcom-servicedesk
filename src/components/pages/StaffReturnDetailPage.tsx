import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ReturnDetailOverviewPage } from '../returns/ReturnDetailOverviewPage';

/**
 * Staff read-only overview for a single Rücklieferung.
 * Route: /returns/:id?organizationId=…
 */
export default function StaffReturnDetailPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const returnId = id && id !== 'new' && id !== 'edit' ? String(id).trim() : '';
  const organizationId = String(search.get('organizationId') || '').trim();

  if (!returnId) {
    return <Navigate to="/returns" replace />;
  }
  if (!organizationId) {
    return <Navigate to="/returns" replace />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ReturnDetailOverviewPage
        mode="staff"
        organizationId={organizationId}
        returnId={returnId}
        listPath="/returns"
        editPath={`/returns/${encodeURIComponent(returnId)}/edit?organizationId=${encodeURIComponent(organizationId)}`}
      />
    </div>
  );
}
