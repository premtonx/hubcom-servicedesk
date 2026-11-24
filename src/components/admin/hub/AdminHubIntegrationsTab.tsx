import { AdminHubSectionGrid } from './AdminHubSectionGrid';
import { categoriesForTab } from './adminHubConfig';
import { AdminHubMcpPanel } from './AdminHubMcpPanel';

/**
 * Mail & Schnittstellen — integration section cards + on-page API & MCP panel.
 * Shortcut tiles that duplicated those destinations were removed.
 */
export function AdminHubIntegrationsTab() {
  return (
    <div className="space-y-8">
      <AdminHubSectionGrid categories={categoriesForTab('integrations')} />
      <AdminHubMcpPanel />
    </div>
  );
}
