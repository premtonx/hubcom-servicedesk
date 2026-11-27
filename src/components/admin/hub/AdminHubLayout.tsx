import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Home,
  Lock,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '../../../lib/context/I18nContext';
import { cn } from '../../../lib/utils';
import { usePermissions } from '../../../hooks/usePermissions';
import { useStaffSession } from '../../../hooks/useStaffSession';
import {
  ADMIN_HUB_CORE_ONLY_TABS,
  buildAdminHubNavBereiche,
  findActiveAdminHubNavChild,
  findAdminHubSubRoute,
  isAdminHubNavChildActive,
  resolveActiveAdminHubSection,
  tabLabel,
  type AdminHubNavBereich,
  type AdminHubNavChild,
  type AdminHubTabId,
} from './adminHubConfig';
import {
  EMPTY_TELEMETRY,
  overallStateLabelDe,
  type AdminHubSubsystemState,
  type AdminHubTelemetry,
} from './adminHubTelemetry';

const BEREICH_ICONS: Record<AdminHubTabId, LucideIcon> = {
  uebersicht: Home,
  kunden: Building2,
  staff: Users,
  'ai-engine': Sparkles,
  rag: Database,
  governance: Shield,
  integrations: Mail,
  system: Lock,
};

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

function navigateToPath(
  navigate: ReturnType<typeof useNavigate>,
  path: string,
  scrollTargetId?: string,
) {
  navigate(path);
  if (scrollTargetId) {
    queueMicrotask(() => {
      document.getElementById(scrollTargetId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }
}

export default function AdminHubLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [telemetry, setTelemetry] = useState<AdminHubTelemetry>(EMPTY_TELEMETRY);
  const { canManageHubcomCore } = useStaffSession();
  const { hasPermission } = usePermissions();

  const activeSection = resolveActiveAdminHubSection(location.pathname, searchParams);
  const subRoute = findAdminHubSubRoute(location.pathname);
  const isHubIndex = /^\/admin\/?$/.test(location.pathname);
  const search = location.search || '';
  const isKundenWorkspace = activeSection === 'kunden';

  const navTree = useMemo(() => {
    const all = buildAdminHubNavBereiche();
    return all
      .filter((b) => canManageHubcomCore || !ADMIN_HUB_CORE_ONLY_TABS.includes(b.id))
      .map((b) => {
        if (b.kind !== 'group') return b;
        const children = b.children.filter((c) => hasPermission(c.module || 'rbac', 'view'));
        return { ...b, children };
      })
      .filter((b) => b.kind === 'leaf' || b.children.length > 0) as AdminHubNavBereich[];
  }, [canManageHubcomCore, hasPermission]);

  const [expandedId, setExpandedId] = useState<AdminHubTabId | null>(activeSection);
  /** Slim icon rail while Kunden workspace is active (user can reopen anytime). */
  const [railCollapsed, setRailCollapsed] = useState(isKundenWorkspace);

  // Deep links / route changes auto-expand the parent Bereich.
  useEffect(() => {
    setExpandedId(activeSection);
  }, [activeSection]);

  // Auto-collapse BEREICHE when Kunden is active; restore when leaving.
  useEffect(() => {
    setRailCollapsed(isKundenWorkspace);
  }, [isKundenWorkspace]);

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

  const goToBereich = (bereich: AdminHubNavBereich) => {
    if (bereich.kind === 'leaf') {
      setExpandedId(bereich.id);
      navigateToPath(navigate, bereich.path);
      return;
    }
    setExpandedId(bereich.id);
    const first = bereich.children[0];
    if (first) {
      navigateToPath(navigate, first.path, first.scrollTargetId);
    }
  };

  const goToChild = (child: AdminHubNavChild, parentId: AdminHubTabId) => {
    setExpandedId(parentId);
    navigateToPath(navigate, child.path, child.scrollTargetId);
  };

  const plane = controlPlaneBadge(telemetry.overallState ?? 'unknown');

  const activeChild =
    navTree
      .filter((b): b is Extract<AdminHubNavBereich, { kind: 'group' }> => b.kind === 'group')
      .map((b) => findActiveAdminHubNavChild(b, location.pathname, search))
      .find(Boolean) ?? null;

  const breadcrumbBereichLabel = tabLabel(activeSection);
  const breadcrumbChildLabel = activeChild?.label || subRoute?.label || null;
  const showBreadcrumb =
    !isHubIndex && activeSection !== 'uebersicht' && Boolean(breadcrumbChildLabel);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#fafafa]">
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
        <aside
          className={cn(
            'shrink-0 border-r border-slate-200/80 bg-white/80 backdrop-blur-sm flex flex-col min-h-0 overflow-y-auto transition-[width] duration-200 ease-out',
            railCollapsed ? 'w-14' : 'w-[260px]',
          )}
          aria-label={t('nav.admin', 'Admin Hub')}
          data-rail-collapsed={railCollapsed ? 'true' : 'false'}
        >
          <div
            className={cn(
              'pt-3 pb-2 flex items-center gap-1',
              railCollapsed ? 'px-1.5 flex-col' : 'px-3 justify-between',
            )}
          >
            {!railCollapsed ? (
              <p className="px-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                {t('admin.hubNav', 'Bereiche')}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setRailCollapsed((v) => !v)}
              className={cn(
                'inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors',
                railCollapsed ? 'w-10 h-10' : 'w-8 h-8',
              )}
              aria-expanded={!railCollapsed}
              aria-label={
                railCollapsed
                  ? t('admin.hubNavExpand', 'Bereiche einblenden')
                  : t('admin.hubNavCollapse', 'Bereiche einklappen')
              }
              title={
                railCollapsed
                  ? t('admin.hubNavExpand', 'Bereiche einblenden')
                  : t('admin.hubNavCollapse', 'Bereiche einklappen')
              }
            >
              {railCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>
          <nav
            className={cn(
              'flex flex-col gap-0.5 pb-6',
              railCollapsed ? 'p-1.5' : 'p-2',
            )}
            aria-label={t('admin.hubNav', 'Bereiche')}
          >
            {navTree.map((bereich) => {
              const isActiveBereich = activeSection === bereich.id;
              const isExpanded = expandedId === bereich.id && !railCollapsed;
              const BereichIcon = BEREICH_ICONS[bereich.id] || Lock;

              if (railCollapsed) {
                return (
                  <button
                    key={bereich.id}
                    type="button"
                    onClick={() => {
                      setRailCollapsed(false);
                      goToBereich(bereich);
                    }}
                    aria-current={isActiveBereich ? 'page' : undefined}
                    title={t(bereich.labelKey, bereich.label)}
                    className={cn(
                      'w-10 h-10 mx-auto inline-flex items-center justify-center rounded-xl transition-colors',
                      isActiveBereich
                        ? 'bg-primary/10 text-primary'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
                    )}
                  >
                    <BereichIcon className="w-4 h-4" />
                  </button>
                );
              }

              if (bereich.kind === 'leaf') {
                return (
                  <button
                    key={bereich.id}
                    type="button"
                    onClick={() => goToBereich(bereich)}
                    aria-current={isActiveBereich ? 'page' : undefined}
                    className={cn(
                      'w-full flex items-center gap-2 text-left h-auto min-h-10 px-3 py-2.5 rounded-xl text-[12px] tracking-wide transition-colors',
                      isActiveBereich
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'bg-transparent text-slate-500 font-semibold hover:text-slate-900 hover:bg-slate-50',
                    )}
                  >
                    <BereichIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{t(bereich.labelKey, bereich.label)}</span>
                  </button>
                );
              }

              return (
                <div key={bereich.id} className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={() => goToBereich(bereich)}
                    aria-expanded={isExpanded}
                    className={cn(
                      'w-full flex items-center gap-2 text-left h-auto min-h-10 px-3 py-2.5 rounded-xl text-[12px] tracking-wide transition-colors',
                      isActiveBereich
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'bg-transparent text-slate-500 font-semibold hover:text-slate-900 hover:bg-slate-50',
                    )}
                  >
                    <BereichIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    <span className="truncate flex-1 min-w-0">
                      {t(bereich.labelKey, bereich.label)}
                    </span>
                    <ChevronDown
                      className={cn(
                        'w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-200',
                        isExpanded && 'rotate-180 text-primary',
                      )}
                      aria-hidden
                    />
                  </button>
                  <div
                    className={cn(
                      'grid transition-[grid-template-rows] duration-200 ease-out',
                      isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                    )}
                  >
                    <div className="overflow-hidden min-h-0">
                      <ul className="flex flex-col gap-0.5 pl-2 pb-1 pt-0.5">
                        {bereich.children.map((child) => {
                          const childActive = isAdminHubNavChildActive(
                            child.path,
                            location.pathname,
                            search,
                            child.navMatchQueryKeys,
                          );
                          const Icon = child.icon || Lock;
                          return (
                            <li key={child.id}>
                              <button
                                type="button"
                                onClick={() => goToChild(child, bereich.id)}
                                aria-current={childActive ? 'page' : undefined}
                                className={cn(
                                  'w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-2 text-[11px] transition-colors',
                                  childActive
                                    ? 'bg-slate-900 text-white font-bold shadow-sm'
                                    : 'text-slate-600 font-semibold hover:bg-slate-50 hover:text-slate-900',
                                )}
                              >
                                <Icon
                                  className={cn(
                                    'w-3.5 h-3.5 shrink-0',
                                    childActive ? 'text-white/90' : 'text-slate-400',
                                  )}
                                />
                                <span className="truncate">{child.label}</span>
                                {childActive ? (
                                  <ChevronRight className="w-3 h-3 ml-auto opacity-60" />
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
          {showBreadcrumb && breadcrumbChildLabel ? (
            <div className="shrink-0 px-6 lg:px-8 pt-3 pb-1">
              <nav
                className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0"
                aria-label="Breadcrumb"
              >
                <Link
                  to="/admin?tab=uebersicht"
                  className="hover:text-primary transition-colors font-semibold text-slate-500 shrink-0"
                >
                  Admin
                </Link>
                <span className="text-slate-300 shrink-0">›</span>
                <button
                  type="button"
                  onClick={() => {
                    const b = navTree.find((x) => x.id === activeSection);
                    if (b) goToBereich(b);
                  }}
                  className="hover:text-primary transition-colors font-semibold text-slate-600 truncate"
                >
                  {breadcrumbBereichLabel}
                </button>
                <span className="text-slate-300 shrink-0">›</span>
                <span className="text-slate-900 font-bold truncate">{breadcrumbChildLabel}</span>
              </nav>
            </div>
          ) : null}
          <div
            className={
              location.pathname.startsWith('/admin/mail') ||
              location.pathname.startsWith('/admin/customers') ||
              location.pathname.startsWith('/admin/organizations')
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
