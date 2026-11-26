import { useEffect, useState } from 'react';
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
  enabledModules?: {
    hardwareReturns?: boolean;
    secureExchange?: boolean;
    vault?: boolean;
  };
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
    return () => {
      active = false;
    };
  }, [session?.organizationId]);

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

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#f7f8fa] text-slate-900">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
        <div className="px-5 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5 min-w-0">
            {org?.logo_url ? (
              <img
                src={org.logo_url}
                alt=""
                className="w-9 h-9 rounded-xl object-contain border border-slate-100 bg-white shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-[11px] font-black shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
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
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              <span className="leading-snug">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4 space-y-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-slate-500" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{session.name || session.email}</p>
              <p className="text-[11px] text-slate-500 truncate">{session.role.replace('CLIENT_', '')}</p>
            </div>
          </div>
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
          <p className="text-[10px] text-center text-slate-400 font-medium tracking-wide">
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
          }}
        />
      </main>
    </div>
  );
}
