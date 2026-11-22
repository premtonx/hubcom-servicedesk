import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Plus, Ticket } from 'lucide-react';
import { HubcomLogo } from '../ui/HubcomLogo';
import { brandConfig } from '../../lib/brandConfig';
import { Button } from '../ui/button';
import { logout } from '../../lib/hooks';
import { usePermissions } from '../../hooks/usePermissions';
import { cn } from '../../lib/utils';

export function PortalLayout() {
  const navigate = useNavigate();
  const { userProfile } = usePermissions();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F5F7FA]">
      <header
        className="border-b border-slate-200/80 sticky top-0 z-40"
        style={{ background: `linear-gradient(135deg, ${brandConfig.colors.navyDeep} 0%, ${brandConfig.colors.navy} 55%, ${brandConfig.colors.accent} 160%)` }}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <NavLink to="/portal" className="flex items-center gap-3 min-w-0">
            <HubcomLogo size="xs" showText={false} />
            <div className="min-w-0 hidden xs:block sm:block">
              <p className="text-sm font-bold text-white truncate">{brandConfig.companyName}</p>
              <p className="text-[10px] text-white/70 font-semibold uppercase tracking-wider">
                Kundenportal
              </p>
            </div>
          </NavLink>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:block text-right mr-1">
              <p className="text-xs font-semibold text-white/95 truncate max-w-[180px]">
                {userProfile?.name || 'Kunde'}
              </p>
              <p className="text-[10px] text-white/70 truncate max-w-[180px]">
                {userProfile?.customerCompany || userProfile?.email || ''}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5 bg-white text-[#0B1F3A] hover:bg-white/90 font-bold"
              onClick={() => navigate('/portal/new')}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Neues Ticket</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 text-white/90 hover:text-white hover:bg-white/10 gap-1.5"
              onClick={() => void handleLogout()}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Abmelden</span>
            </Button>
          </div>
        </div>
        <nav className="max-w-5xl mx-auto px-4 sm:px-6 pb-3 flex gap-2">
          <NavLink
            to="/portal"
            end
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition',
                isActive
                  ? 'bg-white text-[#0B1F3A]'
                  : 'text-white/80 hover:bg-white/10 hover:text-white',
              )
            }
          >
            <Ticket className="w-3.5 h-3.5" />
            Meine Tickets
          </NavLink>
        </nav>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 text-center text-[11px] text-slate-500">
          {brandConfig.copyrightLine} · Kundenportal
        </div>
      </footer>
    </div>
  );
}

export default PortalLayout;
