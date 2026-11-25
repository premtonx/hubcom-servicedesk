import type { ReactNode } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Hourglass,
  List,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Star,
  User,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Button } from '../../ui/button';

export type PortalQueueViewId =
  | 'company_all'
  | 'mine'
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'resolved';

interface PortalTicketsSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isOrgWide: boolean;
  activeView: PortalQueueViewId;
  onViewChange: (view: PortalQueueViewId) => void;
  counts: {
    companyAll: number;
    mine: number;
    open: number;
    in_progress: number;
    waiting: number;
    resolved: number;
  };
  statusQueuesOpen: boolean;
  onToggleStatusQueues: () => void;
}

function Row(props: {
  active: boolean;
  label: string;
  count: number;
  icon: ReactNode;
  onClick: () => void;
  collapsed?: boolean;
}) {
  return (
    <button
      type="button"
      title={props.label}
      onClick={props.onClick}
      className={cn(
        'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition-colors',
        props.active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        props.collapsed && 'justify-center px-0',
      )}
    >
      <span className="shrink-0">{props.icon}</span>
      {!props.collapsed ? (
        <>
          <span className="flex-1 min-w-0 truncate">{props.label}</span>
          <span
            className={cn(
              'tabular-nums text-[11px] font-bold shrink-0',
              props.active ? 'text-white/80' : 'text-slate-400',
            )}
          >
            {props.count}
          </span>
        </>
      ) : null}
    </button>
  );
}

export function PortalTicketsSidebar({
  collapsed,
  onToggleCollapsed,
  isOrgWide,
  activeView,
  onViewChange,
  counts,
  statusQueuesOpen,
  onToggleStatusQueues,
}: PortalTicketsSidebarProps) {
  return (
    <aside
      className={cn(
        'shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0 transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-[240px]',
      )}
    >
      <div className="h-12 px-2 flex items-center justify-between border-b border-slate-100 shrink-0">
        {!collapsed ? (
          <p className="px-1.5 text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
            Warteschlange
          </p>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-500"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Sidebar ausklappen' : 'Sidebar einklappen'}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <section className="space-y-1">
          {!collapsed ? (
            <p className="px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
              <Star className="w-3 h-3" />
              Ansichten / Favoriten
            </p>
          ) : null}
          {isOrgWide ? (
            <Row
              collapsed={collapsed}
              active={activeView === 'company_all'}
              label="Alle Firmen-Tickets"
              count={counts.companyAll}
              icon={<List className="w-4 h-4" />}
              onClick={() => onViewChange('company_all')}
            />
          ) : null}
          <Row
            collapsed={collapsed}
            active={activeView === 'mine'}
            label="Meine Tickets"
            count={counts.mine}
            icon={<User className="w-4 h-4" />}
            onClick={() => onViewChange('mine')}
          />
          <Row
            collapsed={collapsed}
            active={activeView === 'open'}
            label="Offen"
            count={counts.open}
            icon={<CircleDot className="w-4 h-4" />}
            onClick={() => onViewChange('open')}
          />
        </section>

        <section className="space-y-1">
          {!collapsed ? (
            <button
              type="button"
              onClick={onToggleStatusQueues}
              className="w-full px-2.5 pb-1 text-[10px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center justify-between hover:text-slate-600"
            >
              <span>Status &amp; Queues</span>
              <span>{statusQueuesOpen ? '−' : '+'}</span>
            </button>
          ) : null}
          {(collapsed || statusQueuesOpen) && (
            <>
              <Row
                collapsed={collapsed}
                active={activeView === 'in_progress'}
                label="In Bearbeitung"
                count={counts.in_progress}
                icon={<Loader2 className="w-4 h-4" />}
                onClick={() => onViewChange('in_progress')}
              />
              <Row
                collapsed={collapsed}
                active={activeView === 'waiting'}
                label="Wartend"
                count={counts.waiting}
                icon={<Hourglass className="w-4 h-4" />}
                onClick={() => onViewChange('waiting')}
              />
              <Row
                collapsed={collapsed}
                active={activeView === 'resolved'}
                label="Gelöst / Geschlossen"
                count={counts.resolved}
                icon={<CheckCircle2 className="w-4 h-4" />}
                onClick={() => onViewChange('resolved')}
              />
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
