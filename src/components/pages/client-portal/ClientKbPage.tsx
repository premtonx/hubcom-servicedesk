/**
 * Kunden-Portal Knowledge Base (`/portal/kb`).
 * Shared KnowledgeBaseWorkbench + portal adapter (/api/portal/kb* only).
 */
import { useEffect, useMemo, useState } from 'react';
import { KnowledgeBaseWorkbench } from '../../kb/KnowledgeBaseWorkbench';
import {
  PORTAL_KB_READER_CAPABILITIES,
  PORTAL_KB_WRITER_CAPABILITIES,
  type KbWorkbenchCapabilities,
} from '../../../lib/kb/kb-workbench-adapter';
import { usePortalKbAdapter } from '../../../hooks/usePortalKbAdapter';
import { useClientPortalSession } from '../../../hooks/useClientPortalSession';
import { clientPortalApi } from '../../../services/clientPortalApi';

export default function ClientKbPage() {
  const portalAdapter = usePortalKbAdapter();
  const { isOrgWide, loading } = useClientPortalSession();
  const [aiEnabled, setAiEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    void clientPortalApi
      .getMe()
      .then((me) => {
        if (!active) return;
        setAiEnabled(me.aiEnabled !== false);
      })
      .catch(() => {
        /* keep AI visible until proven disabled */
      });
    return () => {
      active = false;
    };
  }, []);

  const capabilities = useMemo((): KbWorkbenchCapabilities => {
    const base = isOrgWide
      ? PORTAL_KB_WRITER_CAPABILITIES
      : PORTAL_KB_READER_CAPABILITIES;
    if (aiEnabled) return base;
    return {
      ...base,
      aiGenerate: false,
      aiAssistantNav: false,
      aiInsights: false,
    };
  }, [aiEnabled, isOrgWide]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[40vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  return (
    <KnowledgeBaseWorkbench
      mode="portal"
      adapter={portalAdapter}
      capabilities={capabilities}
    />
  );
}
