/**
 * Staff Knowledge Base route (`/kb`).
 * Presentation lives in KnowledgeBaseWorkbench; all network I/O via useStaffKbAdapter.
 */
import { KnowledgeBaseWorkbench } from '../kb/KnowledgeBaseWorkbench';
import { STAFF_KB_CAPABILITIES } from '../../lib/kb/kb-workbench-adapter';
import { useStaffKbAdapter } from '../../hooks/useStaffKbAdapter';

export default function KBPage() {
  const staffAdapter = useStaffKbAdapter();
  return (
    <KnowledgeBaseWorkbench
      mode="staff"
      adapter={staffAdapter}
      capabilities={STAFF_KB_CAPABILITIES}
    />
  );
}
