import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Ticket,
  Users,
  Mail,
  LogOut,
  Building2,
  LayoutDashboard,
  Palette,
  BookOpen,
  Shield,
  Lock,
  Package,
  Moon,
  Sun,
} from 'lucide-react';
import axios from 'axios';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { logout } from '../../lib/hooks';
import { useClientPortalSession } from '../../hooks/useClientPortalSession';
import {
  organizationInitials,
  resolvePortalTitle,
} from '../../lib/client-portal/org-branding';
import { resolveHardwareReturnsModuleFlag } from '../../lib/client-portal/hardware-returns-nav';
import {
  portalSidebarShowsSecureExchange,
  portalSidebarShowsVault,
  resolveSecureExchangeModuleFlag,
  resolveVaultModuleFlag,
} from '../../lib/client-portal/portal-modules-nav';
import {
  DEFAULT_PORTAL_THEME,
  portalThemeCssVars,
  portalThemeFromOrganization,
  portalThemeStorageKey,
  type PortalThemeMode,
  type PortalThemeSettings,
} from '../../lib/client-portal/portal-theme';

/** Create lives inside /portal/tickets + dashboard — not as a sidebar nav item. */
const NAV_CORE = [
  { to: '/portal/dashboard', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/portal/tickets', label: 'Tickets', icon: Ticket, end: true },
] as const;

const NAV_KB = {
  to: '/portal/kb',
  label: 'Wissensdatenbank',
  icon: BookOpen,
  end: false,
} as const;

const NAV_EXCHANGE = {
  to: '/portal/exchange',
  label: 'Sicherer Austausch',
  icon: Shield,
  end: false,
} as const;

const NAV_RETURNS = {
  to: '/portal/returns',
  label: 'Rücklieferungen',
  icon: Package,
  end: false,
} as const;

const NAV_VAULT = {
  to: '/portal/vault',
  label: 'Tresor',
  icon: Lock,
  end: false,
} as const;

const NAV_ADMIN_ONLY = [
  { to: '/portal/members', label: 'Mitarbeiter & Rollen', icon: Users, end: false },
  { to: '/portal/email', label: 'E-Mail & M365 Integration', icon: Mail, end: false },
  { to: '/portal/branding', label: 'Portal-Branding', icon: Palette, end: false },
] as const;

interface OrgBranding {
  id: string;
  name: string;
  logo_url: string | null;
  portal_title: string | null;
  favicon_url?: string | null;
  resolved_portal_title?: string;
  hardware_returns_enabled?: boolean;
  secure_exchange_enabled?: boolean;
  vault_enabled?: boolean;
  portal_theme?: PortalThemeSettings;
  primaryColor?: string;
  secondaryColor?: string;
  sidebarColor?: string | null;
  themeMode?: PortalThemeMode;
  allowUserThemeToggle?: boolean;
  settings?: Record<string, unknown>;
  enabledModules?: {
    hardwareReturns?: boolean;
    secureExchange?: boolean;
    vault?: boolean;
  };
}

function resolveOrgTheme(org: OrgBranding | null): PortalThemeSettings {
  if (!org) return DEFAULT_PORTAL_THEME;
  if (org.portal_theme) return org.portal_theme;
  if (org.primaryColor || org.themeMode) {
    return {
      primaryColor: org.primaryColor || DEFAULT_PORTAL_THEME.primaryColor,
      secondaryColor: org.secondaryColor || DEFAULT_PORTAL_THEME.secondaryColor,
      sidebarColor: org.sidebarColor ?? null,
      themeMode: org.themeMode || DEFAULT_PORTAL_THEME.themeMode,
      allowUserThemeToggle: org.allowUserThemeToggle !== false,
    };
  }
  return portalThemeFromOrganization({ settings: org.settings || {} });
}

function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return prefersDark;
}

export default function ClientPortalLayout() {
  const { session, isClientAdmin, isOrgWide, loading } = useClientPortalSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [org, setOrg] = useState<OrgBranding | null>(null);
  /** null = still resolving /api/portal/me module flags */
  const [hardwareReturnsEnabled, setHardwareReturnsEnabled] = useState<boolean | null>(null);
  const [secureExchangeEnabled, setSecureExchangeEnabled] = useState<boolean | null>(null);
  const [vaultEnabled, setVaultEnabled] = useState<boolean | null>(null);
  const [userThemeOverride, setUserThemeOverride] = useState<'light' | 'dark' | null>(null);
  const prefersDark = usePrefersDark();
  // Ticket list + ticket detail need a non-scrolling shell; /portal/tickets/new must scroll.
  const isTicketCreate = location.pathname === '/portal/tickets/new';
  const isTicketDetail =
    !isTicketCreate && /^\/portal\/tickets\/[^/]+$/.test(location.pathname);
  const isTicketsWorkbench = location.pathname === '/portal/tickets' || isTicketDetail;
  const isReturnsList = location.pathname === '/portal/returns';
  const isReturnsDetailOrEditor =
    location.pathname === '/portal/returns/new' ||
    /^\/portal\/returns\/[^/]+(\/edit)?$/.test(location.pathname);
  /** List keeps internal scroll; detail/edit must scroll the page itself. */
  const isReturnsWorkbench = isReturnsList || isReturnsDetailOrEditor;
  const returnsNeedsPageScroll = isReturnsDetailOrEditor;

  useEffect(() => {
    if (!session?.organizationId) {
      setOrg(null);
      setHardwareReturnsEnabled(false);
      setSecureExchangeEnabled(false);
      setVaultEnabled(false);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const [orgRes, meRes] = await Promise.all([
          axios.get('/api/portal/organization', { withCredentials: true }),
          axios.get('/api/portal/me', { withCredentials: true }),
        ]);
        if (!active) return;
        const nextOrg = orgRes.data?.organization || null;
        setOrg(nextOrg);
        setHardwareReturnsEnabled(resolveHardwareReturnsModuleFlag(meRes.data));
        setSecureExchangeEnabled(resolveSecureExchangeModuleFlag(meRes.data));
        setVaultEnabled(resolveVaultModuleFlag(meRes.data));
      } catch {
        if (!active) return;
        setOrg(null);
        setHardwareReturnsEnabled(false);
        setSecureExchangeEnabled(false);
        setVaultEnabled(false);
      }
    })();

    const onBrandingChanged = () => {
      void axios
        .get('/api/portal/organization', { withCredentials: true })
        .then((res) => {
          if (active) setOrg(res.data?.organization || null);
        })
        .catch(() => {});
    };
    window.addEventListener('hubcom-portal-branding-changed', onBrandingChanged);
    return () => {
      active = false;
      window.removeEventListener('hubcom-portal-branding-changed', onBrandingChanged);
    };
  }, [session?.organizationId]);

  useEffect(() => {
    if (!session?.organizationId || typeof window === 'undefined') {
      setUserThemeOverride(null);
      return;
    }
    try {
      const raw = localStorage.getItem(portalThemeStorageKey(session.organizationId));
      if (raw === 'light' || raw === 'dark') setUserThemeOverride(raw);
      else setUserThemeOverride(null);
    } catch {
      setUserThemeOverride(null);
    }
  }, [session?.organizationId]);

  const theme = useMemo(() => resolveOrgTheme(org), [org]);

  const resolvedDark = useMemo(() => {
    if (theme.allowUserThemeToggle && userThemeOverride) {
      return userThemeOverride === 'dark';
    }
    if (theme.themeMode === 'dark') return true;
    if (theme.themeMode === 'system') return prefersDark;
    return false;
  }, [theme.allowUserThemeToggle, theme.themeMode, userThemeOverride, prefersDark]);

  const themeVars = useMemo(
    () => portalThemeCssVars(theme, resolvedDark),
    [theme, resolvedDark],
  );

  if (loading || !session) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#f7f8fa]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800" />
      </div>
    );
  }

  // Keep nav stable while module flag loads; show returns for org-wide roles once confirmed.
  const showReturns = isOrgWide && hardwareReturnsEnabled === true;
  // While flags are still loading (null), keep legacy always-on visibility to avoid flicker;
  // once resolved to false (e.g. DPG) hide immediately.
  const showVaultNav =
    vaultEnabled === null
      ? isOrgWide
      : portalSidebarShowsVault({ isOrgWide, moduleEnabled: vaultEnabled });
  const showExchangeNav =
    secureExchangeEnabled === null
      ? true
      : portalSidebarShowsSecureExchange(secureExchangeEnabled);

  const navItems = [
    ...NAV_CORE,
    ...(showReturns ? [NAV_RETURNS] : []),
    NAV_KB,
    ...(showExchangeNav ? [NAV_EXCHANGE] : []),
    ...(showVaultNav ? [NAV_VAULT] : []),
    ...(isClientAdmin ? NAV_ADMIN_ONLY : []),
  ];

  const orgName = org?.name || 'Kunde';
  const portalTitle =
    org?.resolved_portal_title || resolvePortalTitle(orgName, org?.portal_title);
  const initials = organizationInitials(orgName);

  const persistUserTheme = (next: 'light' | 'dark') => {
    setUserThemeOverride(next);
    if (!session.organizationId) return;
    try {
      localStorage.setItem(portalThemeStorageKey(session.organizationId), next);
    } catch {
      /* ignore quota */
    }
  };

  return (
    <div
      className={cn(
        'portal-shell h-screen w-screen flex overflow-hidden text-slate-900',
        resolvedDark && 'dark',
      )}
      data-portal-theme={resolvedDark ? 'dark' : 'light'}
      style={
        {
          ...themeVars,
          background: 'var(--portal-page-bg, #f7f8fa)',
          color: 'var(--portal-page-fg, #0f172a)',
        } as CSSProperties
      }
    >
      <aside
        className="w-64 shrink-0 border-r flex flex-col min-h-0"
        style={{
          background: 'var(--portal-sidebar-bg)',
          color: 'var(--portal-sidebar-fg)',
          borderColor: 'color-mix(in srgb, var(--portal-sidebar-fg) 12%, transparent)',
        }}
      >
        <div
          className="px-5 pt-6 pb-4 border-b"
          style={{
            borderColor: 'color-mix(in srgb, var(--portal-sidebar-fg) 12%, transparent)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {org?.logo_url ? (
              <img
                src={org.logo_url}
                alt=""
                className="w-9 h-9 rounded-xl object-contain border shrink-0"
                style={{
                  background: resolvedDark ? '#0B1120' : '#FFFFFF',
                  borderColor: 'color-mix(in srgb, var(--portal-sidebar-fg) 12%, transparent)',
                }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0"
                style={{
                  background: 'var(--portal-primary)',
                  color: 'var(--portal-primary-foreground)',
                }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p
                className="text-[10px] font-extrabold uppercase tracking-widest"
                style={{ opacity: 0.55 }}
              >
                Kunden-Portal
              </p>
              <p className="text-sm font-black truncate">{portalTitle}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'portal-nav-link flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive ? 'portal-nav-link-active' : 'opacity-80 hover:opacity-100',
                )
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span className="leading-snug">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div
          className="border-t p-4 space-y-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--portal-sidebar-fg) 12%, transparent)',
          }}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'color-mix(in srgb, var(--portal-sidebar-fg) 10%, transparent)',
              }}
            >
              <Building2 className="w-4 h-4" style={{ opacity: 0.7 }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{session.name || session.email}</p>
              <p className="text-[11px] truncate" style={{ opacity: 0.65 }}>
                {session.role.replace('CLIENT_', '')}
              </p>
            </div>
          </div>
          {theme.allowUserThemeToggle ? (
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={() => persistUserTheme(resolvedDark ? 'light' : 'dark')}
            >
              {resolvedDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {resolvedDark ? 'Hell' : 'Dunkel'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Abmelden
          </Button>
          <p className="text-[10px] text-center font-medium tracking-wide" style={{ opacity: 0.45 }}>
            Powered by Hubcom
          </p>
        </div>
      </aside>

      <main
        className={
          isTicketsWorkbench || (isReturnsList && !returnsNeedsPageScroll)
            ? 'flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col'
            : 'flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden flex flex-col'
        }
      >
        <Outlet
          context={{
            organization: org,
            setOrganization: setOrg,
            hardwareReturnsEnabled: hardwareReturnsEnabled === true,
            secureExchangeEnabled: secureExchangeEnabled !== false,
            vaultEnabled: vaultEnabled !== false,
            portalTheme: theme,
            portalDark: resolvedDark,
          }}
        />
      </main>
    </div>
  );
}
