import { useEffect, useState } from 'react';
import axios from 'axios';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Home } from 'lucide-react';
import { useTranslation } from '../../../lib/context/I18nContext';
import { cn } from '../../../lib/utils';
import {
  ADMIN_HUB_TABS,
  findAdminHubSubRoute,
  resolveActiveAdminHubSection,
  tabLabel,
  type AdminHubTabId,
} from './adminHubConfig';
import type { AdminHubTelemetry } from './adminHubTelemetry';

const EMPTY_TELEMETRY: AdminHubTelemetry = {
  activeAgents: 0,
  ticketsProcessed: 0,
  assetsManaged: 0,
  vaultSecrets: 0,
  knowledgeArticles: 0,
  aiRequests: 0,
  systemHealth: 100,
  latencyMs: 0,
  activeVectors: 0,
  primaryModel: null,
  providers: [],
};

function controlPlaneLabel(health: number): string {
  if (health >= 99) return 'CONTROL PLANE : ONLINE';
  if (health >= 97) return 'CONTROL PLANE : DEGRADED';
  return 'CONTROL PLANE : OFFLINE';
}

export default function AdminHubLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [telemetry, setTelemetry] = useState<AdminHubTelemetry>(EMPTY_TELEMETRY);

  const activeSection = resolveActiveAdminHubSection(location.pathname, searchParams);
  const subRoute = findAdminHubSubRoute(location.pathname);
  const isHubIndex = /^\/admin\/?$/.test(location.pathname);

  const refreshTelemetry = () => {
    void axios
      .get('/api/admin/hub-stats')
      .then((res) => setTelemetry(res.data))
      .catch((err) => console.warn('Admin hub stats unavailable', err));
  };

  useEffect(() => {
    refreshTelemetry();
    const interval = setInterval(refreshTelemetry, 30000);
    return () => clearInterval(interval);
  }, []);

  const goToSection = (tabId: AdminHubTabId) => {
    navigate(`/admin?tab=${tabId}`);
  };

  const health = telemetry.systemHealth ?? 100;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#fafafa]">
      {/* Compact single-line Admin-Hub header */}
      <header className="shrink-0 px-4 lg:px-6 h-12 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            to="/admin?tab=uebersicht"
            className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-500 hover:text-primary hover:bg-primary/5 transition-colors"
            aria-label={t('nav.home', 'Home')}
            title={t('nav.home', 'Home')}
          >
            <Home className="w-4 h-4" />
          </Link>
          <h1 className="text-base lg:text-lg font-semibold tracking-tight text-slate-900 shrink-0">
            {t('nav.admin', 'Admin-Hub')}
          </h1>
          <span className="text-slate-300 shrink-0 select-none" aria-hidden>
            ·
          </span>
          <p className="text-xs sm:text-sm text-muted-foreground truncate min-w-0">
            {t(
              'admin.subtitle',
              'Zentrale Steuerung für Hubcom-KI, Governance und Infrastruktur.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.02)] shrink-0">
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                health >= 99 ? 'bg-emerald-400' : health >= 97 ? 'bg-amber-400' : 'bg-red-400',
              )}
            />
            <span
              className={cn(
                'relative inline-flex rounded-full h-2 w-2',
                health >= 99 ? 'bg-emerald-500' : health >= 97 ? 'bg-amber-500' : 'bg-red-500',
              )}
            />
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 font-mono whitespace-nowrap">
            {controlPlaneLabel(health)}
          </span>
        </div>
      </header>

      <div className="flex-1 min-h-0 w-full flex overflow-hidden">
        {/* Persistent left sidebar — never unmounts across Admin-Hub sub-routes */}
        <aside
          className="shrink-0 w-56 sm:w-60 lg:w-64 border-r border-slate-200/80 bg-white/80 backdrop-blur-sm flex flex-col min-h-0 overflow-y-auto"
          aria-label={t('nav.admin', 'Admin Hub')}
        >
          <div className="px-3 pt-4 pb-2">
            <p className="px-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
              {t('admin.hubNav', 'Sections')}
            </p>
          </div>
          <nav className="flex flex-col gap-0.5 p-2" aria-label={t('admin.hubNav', 'Sections')}>
            {ADMIN_HUB_TABS.map((tab) => {
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => goToSection(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex-none shrink-0 justify-start text-left whitespace-normal',
                    'h-auto min-h-10 px-3 py-2.5 rounded-xl text-[12px] tracking-wide transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-bold shadow-none'
                      : 'bg-transparent text-slate-500 font-semibold hover:text-slate-900 hover:bg-slate-50',
                  )}
                >
                  {t(tab.labelKey, tab.label)}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right content panel only — swaps via <Outlet /> */}
        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {subRoute && !isHubIndex ? (
            <div className="shrink-0 px-6 lg:px-8 pt-4 pb-1">
              <nav className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => goToSection(subRoute.parentTab)}
                  className="hover:text-primary transition-colors font-semibold text-slate-600 truncate"
                >
                  ← {tabLabel(subRoute.parentTab)}
                </button>
                <span className="text-slate-300 shrink-0">/</span>
                <span className="text-slate-900 font-bold truncate">{subRoute.label}</span>
              </nav>
            </div>
          ) : null}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col">
            <Outlet context={{ telemetry, refreshTelemetry }} />
          </div>
        </div>
      </div>
    </div>
  );
}
