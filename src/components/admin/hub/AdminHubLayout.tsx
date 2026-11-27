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
import {
  EMPTY_TELEMETRY,
  overallStateLabelDe,
  type AdminHubSubsystemState,
  type AdminHubTelemetry,
} from './adminHubTelemetry';

function controlPlaneBadge(state: AdminHubSubsystemState): {
  label: string;
  ping: string;
  dot: string;
} {
  switch (state) {
    case 'ok':
      return {
        label: `CONTROL PLANE : ${overallStateLabelDe('ok').toUpperCase()}`,
        ping: 'bg-emerald-400',
        dot: 'bg-emerald-500',
      };
    case 'degraded':
    case 'not_configured':
      return {
        label: `CONTROL PLANE : ${overallStateLabelDe('degraded').toUpperCase()}`,
        ping: 'bg-amber-400',
        dot: 'bg-amber-500',
      };
    case 'error':
      return {
        label: `CONTROL PLANE : ${overallStateLabelDe('error').toUpperCase()}`,
        ping: 'bg-red-400',
        dot: 'bg-red-500',
      };
    default:
      return {
        label: `CONTROL PLANE : ${overallStateLabelDe('unknown').toUpperCase()}`,
        ping: 'bg-slate-400',
        dot: 'bg-slate-500',
      };
  }
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
    // Kunden is a first-class workspace — open the directory directly.
    if (tabId === 'kunden') {
      navigate('/admin/customers');
      return;
    }
    // Mail & Schnittstellen opens the secondary-nav workspace on E-Mail-Kanäle.
    if (tabId === 'integrations') {
      navigate('/admin/mail?section=email-channels&tab=overview');
      return;
    }
    navigate(`/admin?tab=${tabId}`);
  };

  const plane = controlPlaneBadge(telemetry.overallState ?? 'unknown');

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
        <div
          className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-3 py-1 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.02)] shrink-0"
          title={t(
            'admin.hubHeader.planeHint',
            'Gesamtstatus aus dem schwächsten Subsystem (siehe Übersicht)',
          )}
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                plane.ping,
              )}
            />
            <span className={cn('relative inline-flex rounded-full h-2 w-2', plane.dot)} />
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 font-mono whitespace-nowrap">
            {plane.label}
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
              {t('admin.hubNav', 'Bereiche')}
            </p>
          </div>
          <nav className="flex flex-col gap-0.5 p-2" aria-label={t('admin.hubNav', 'Bereiche')}>
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
          {/* Kunden / Mail workspace have their own chrome — skip hub breadcrumb. */}
          {subRoute &&
          !isHubIndex &&
          subRoute.parentTab !== 'kunden' &&
          !location.pathname.startsWith('/admin/mail') ? (
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
          <div
            className={
              location.pathname.startsWith('/admin/mail') ||
              location.pathname.startsWith('/admin/customers')
                ? 'flex-1 min-h-0 min-w-0 overflow-hidden flex flex-col'
                : 'flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col'
            }
          >
            <Outlet context={{ telemetry, refreshTelemetry }} />
          </div>
        </div>
      </div>
    </div>
  );
}
