/**
 * Kunden-Portal Knowledge Base (`/portal/kb`).
 * Shared KnowledgeBaseWorkbench + portal adapter (/api/portal/kb* only).
 */
import { KnowledgeBaseWorkbench } from '../../kb/KnowledgeBaseWorkbench';
import {
  PORTAL_KB_READER_CAPABILITIES,
  PORTAL_KB_WRITER_CAPABILITIES,
} from '../../../lib/kb/kb-workbench-adapter';
import { usePortalKbAdapter } from '../../../hooks/usePortalKbAdapter';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';

export default function ClientKbPage() {
  const portalAdapter = usePortalKbAdapter();
  const { isOrgWide, loading } = useClientPortalSession();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  const capabilities = isOrgWide
    ? PORTAL_KB_WRITER_CAPABILITIES
    : PORTAL_KB_READER_CAPABILITIES;

  return (
    <KnowledgeBaseWorkbench
      mode="portal"
      adapter={portalAdapter}
      capabilities={capabilities}
    />
  );
}
