import { AdminHubSectionGrid } from './AdminHubSectionGrid';
import { categoriesForTab } from './adminHubConfig';

/**
 * PII & Compliance tab — governance section cards only.
 * Detailed PII settings and audit tools live on their nested Admin-Hub routes.
 */
export function AdminHubGovernanceTab() {
  return (
    <div className="space-y-6">
      <AdminHubSectionGrid categories={categoriesForTab('governance')} />
    </div>
  );
}
