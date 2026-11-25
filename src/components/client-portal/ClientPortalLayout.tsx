import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Ticket,
  PlusCircle,
  Users,
  Mail,
  LogOut,
  Building2,
  LayoutDashboard,
  Palette,
  BookOpen,
  Shield,
  Lock,
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

const NAV_ALL = [
  { to: '/portal/dashboard', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/portal/tickets', label: 'Tickets', icon: Ticket, end: true },
  { to: '/portal/tickets/new', label: 'Neues Ticket erstellen', icon: PlusCircle, end: true },
  { to: '/portal/kb', label: 'Wissensdatenbank', icon: BookOpen, end: false },
  { to: '/portal/exchange', label: 'Sicherer Austausch', icon: Shield, end: false },
] as const;

const NAV_ORG_WIDE = [
  { to: '/portal/vault', label: 'Tresor', icon: Lock, end: false },
] as const;

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
  resolved_portal_title?: string;
}

export default function ClientPortalLayout() {
  const { session, isClientAdmin, isOrgWide, loading } = useClientPortalSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const isTicketsWorkbench =
    location.pathname === '/portal/tickets' ||
    /^\/portal\/tickets\/[^/]+$/.test(location.pathname);

  useEffect(() => {
    if (!session?.organizationId) {
      setOrg(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const res = await axios.get('/api/portal/organization', { withCredentials: true });
        if (active) setOrg(res.data?.organization || null);
      } catch {
        if (active) setOrg(null);
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

  const navItems = [
    ...NAV_ALL,
    ...(isOrgWide ? NAV_ORG_WIDE : []),
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
          isTicketsWorkbench
            ? 'flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col'
            : 'flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden'
        }
      >
        <Outlet context={{ organization: org, setOrganization: setOrg }} />
      </main>
    </div>
  );
}
