import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ReturnEditorPage } from '../returns/ReturnEditorPage';

/**
 * Staff full-page create/edit for Rücklieferungen.
 * Routes:
 *  - /returns/new?organizationId=…
 *  - /returns/:id/edit?organizationId=…
 *  - legacy /tickets/kunden/:orgId/returns/new|/:returnId
 */
export default function StaffReturnEditorPage() {
  const { orgId, returnId: returnIdParam, id } = useParams();
  const [search] = useSearchParams();

  const organizationId = String(
    orgId || search.get('organizationId') || '',
  ).trim();
  const rawId = returnIdParam || id || null;
  const returnId = rawId && rawId !== 'new' ? String(rawId).trim() : null;

  if (!organizationId) {
    return <Navigate to="/returns" replace />;
  }

  const overviewPath = returnId
    ? `/returns/${encodeURIComponent(returnId)}?organizationId=${encodeURIComponent(organizationId)}`
    : '/returns';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ReturnEditorPage
        mode="staff"
        organizationId={organizationId}
        returnId={returnId}
        listPath="/returns"
        overviewPath={overviewPath}
      />
    </div>
  );
}
