import { useEffect } from 'react';
import type { MailSectionId, MailSubTabId } from '../../../lib/admin/mail-integrations-nav';
import NotificationEnginePage from '../../pages/NotificationEnginePage';
import IntegrationsPage from '../../pages/IntegrationsPage';
import PolyglotBridgeAdminPage from '../../pages/PolyglotBridgeAdminPage';
import { AdminHubMcpPanel } from '../hub/AdminHubMcpPanel';

interface AdminMailGenericSectionPaneProps {
  section: Exclude<MailSectionId, 'email-channels'>;
  tab: MailSubTabId;
}

/**
 * Wrap existing Mail & Schnittstellen pages in the shared sub-tab shell.
 * Overview shows the full page; other tabs scroll/focus configuration regions when present.
 */
export function AdminMailGenericSectionPane({
  section,
  tab,
}: AdminMailGenericSectionPaneProps) {
  useEffect(() => {
    const el = document.getElementById(`mail-status-${section}`);
    if (!el) return;
    // Generic sections: mark Aktiv once the panel mounted (config exists in module-config).
    el.className =
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold bg-emerald-50 text-emerald-700';
    el.innerHTML =
      '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Aktiv';
  }, [section]);

  useEffect(() => {
    if (tab === 'overview' || tab === 'configuration') return;
    // Soft-focus: scroll to top of embedded content for settings/test/logs.
    const root = document.getElementById('mail-generic-section-root');
    root?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [tab]);

  return (
    <div id="mail-generic-section-root" className="space-y-3">
      {tab !== 'overview' ? (
        <p className="text-[11px] text-slate-500 font-semibold rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
          {tab === 'configuration'
            ? 'Konfiguration — bestehende Formulare und Secrets bleiben unverändert.'
            : tab === 'settings'
              ? 'Einstellungen — Modul- und Workspace-Optionen dieser Schnittstelle.'
              : tab === 'test'
                ? 'Testen — Verbindungs- und Probe-Aktionen der jeweiligen Integration.'
                : 'Logs — Protokoll- und Statusinformationen der jeweiligen Integration.'}
        </p>
      ) : null}

      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden p-1 sm:p-2">
        {section === 'notifications' ? <NotificationEnginePage /> : null}
        {section === 'integrations-hub' ? <IntegrationsPage /> : null}
        {section === 'api-mcp' ? (
          <div className="p-3 sm:p-4">
            <AdminHubMcpPanel />
          </div>
        ) : null}
        {section === 'polyglot' ? <PolyglotBridgeAdminPage /> : null}
      </div>
    </div>
  );
}
