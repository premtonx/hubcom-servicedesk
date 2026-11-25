import { Navigate, useParams } from 'react-router-dom';
import { ReturnEditorPage } from '../returns/ReturnEditorPage';

/**
 * Staff full-page create/edit for Rücklieferungen.
 * Routes: /tickets/kunden/:orgId/returns/new · /tickets/kunden/:orgId/returns/:returnId
 */
export default function StaffReturnEditorPage() {
  const { orgId, returnId: returnIdParam } = useParams();
  const organizationId = String(orgId || '').trim();
  const returnId =
    returnIdParam && returnIdParam !== 'new' ? String(returnIdParam).trim() : null;

  if (!organizationId) {
    return <Navigate to="/tickets" replace />;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ReturnEditorPage
        mode="staff"
        organizationId={organizationId}
        returnId={returnId}
        listPath={`/tickets?organizationId=${encodeURIComponent(organizationId)}&panel=returns`}
      />
    </div>
  );
}
