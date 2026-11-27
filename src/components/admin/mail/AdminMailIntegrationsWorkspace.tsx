import { useCallback, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  Code2,
  Globe,
  Mail,
  Puzzle,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  MAIL_SECTIONS,
  MAIL_SUBTAB_LABELS,
  buildMailSearch,
  getMailSectionDef,
  resolveMailSection,
  resolveMailSubTab,
  type MailSectionId,
  type MailSubTabId,
} from '../../../lib/admin/mail-integrations-nav';
import { AdminMailSectionHeader } from './AdminMailSectionHeader';
import { AdminMailEmailChannelsPane } from './AdminMailEmailChannelsPane';
import { AdminMailGenericSectionPane } from './AdminMailGenericSectionPane';

const ICONS = {
  mail: Mail,
  bell: Bell,
  puzzle: Puzzle,
  code2: Code2,
  globe: Globe,
} as const;

/**
 * Mail & Schnittstellen workspace — secondary sidebar + section content.
 * URL: /admin/mail?section=email-channels&tab=overview
 */
export default function AdminMailIntegrationsWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const section = resolveMailSection(searchParams.get('section'));
  const tab = resolveMailSubTab(searchParams.get('tab'), section);
  const channelId = searchParams.get('channel');
  const def = getMailSectionDef(section);

  const setNav = useCallback(
    (next: { section?: MailSectionId; tab?: MailSubTabId; channel?: string | null }) => {
      const s = next.section ?? section;
      const t = next.tab ?? tab;
      const ch = next.channel === undefined ? channelId : next.channel;
      const q = new URLSearchParams();
      q.set('section', s);
      q.set('tab', t);
      if (ch) q.set('channel', ch);
      setSearchParams(q, { replace: false });
    },
    [section, tab, channelId, setSearchParams],
  );

  // Normalize URL so deep links always carry section + tab.
  useEffect(() => {
    const rawSection = searchParams.get('section');
    const rawTab = searchParams.get('tab');
    const needNormalize =
      !rawSection ||
      !rawTab ||
      resolveMailSection(rawSection) !== rawSection ||
      resolveMailSubTab(rawTab, section) !== rawTab;
    if (!needNormalize) return;
    navigate(`/admin/mail${buildMailSearch({ section, tab, channel: channelId })}`, {
      replace: true,
    });
  }, [searchParams, section, tab, channelId, navigate]);

  const Icon = ICONS[def.icon];

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden bg-[#fafafa]">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200/80 bg-white">
        <button
          type="button"
          onClick={() => navigate('/admin?tab=uebersicht')}
          className="flex items-center gap-2 px-4 h-12 border-b border-slate-200/80 text-sm font-bold text-slate-600 hover:text-primary hover:bg-primary/5 transition-colors text-left cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span className="truncate">Mail & Schnittstellen</span>
        </button>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Mail & Schnittstellen">
          {MAIL_SECTIONS.map((s) => {
            const SIcon = ICONS[s.icon];
            const active = s.id === section;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setNav({ section: s.id, tab: 'overview', channel: null })}
                className={cn(
                  'w-full flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer border border-transparent',
                  active
                    ? 'bg-primary/5 text-foreground shadow-sm border-primary/10'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 w-0.5 self-stretch rounded-full shrink-0',
                    active ? 'bg-primary' : 'bg-transparent',
                  )}
                  aria-hidden
                />
                <SIcon
                  className={cn(
                    'w-4 h-4 mt-0.5 shrink-0',
                    active ? 'text-primary' : 'text-slate-400',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-bold leading-snug">{s.label}</span>
                  <span className="block text-[10px] text-slate-500 font-medium leading-snug mt-0.5 line-clamp-2">
                    {s.description}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 px-4 lg:px-6 h-10 border-b border-slate-200/60 bg-white/80 flex items-center gap-1.5 text-xs font-semibold text-slate-500 min-w-0">
          <Link to="/admin?tab=uebersicht" className="hover:text-primary shrink-0">
            Admin
          </Link>
          <span className="text-slate-300">›</span>
          <button
            type="button"
            className="hover:text-primary shrink-0 cursor-pointer"
            onClick={() => setNav({ section: 'email-channels', tab: 'overview', channel: null })}
          >
            Mail & Schnittstellen
          </button>
          <span className="text-slate-300">›</span>
          <span className="text-foreground font-bold truncate">{def.label}</span>
        </div>

        <div className="md:hidden shrink-0 px-4 py-2 border-b border-slate-200 bg-white flex gap-2 overflow-x-auto">
          {MAIL_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setNav({ section: s.id, tab: 'overview', channel: null })}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border cursor-pointer',
                s.id === section
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-slate-600 border-slate-200',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
            <AdminMailSectionHeader
              icon={Icon}
              title={def.label}
              subtitle={def.description}
              primaryActionLabel={def.primaryActionLabel}
              onPrimaryAction={() => {
                if (section === 'email-channels') {
                  setNav({ tab: 'configuration', channel: null });
                  queueMicrotask(() => {
                    window.dispatchEvent(new CustomEvent('hubcom-mail-open-create-channel'));
                  });
                } else {
                  setNav({ tab: 'configuration' });
                }
              }}
              statusSlotId={`mail-status-${section}`}
            />

            <div className="border-b border-slate-200">
              <div className="flex flex-wrap gap-x-4 gap-y-1" role="tablist">
                {def.subtabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setNav({ tab: t })}
                    className={cn(
                      'px-1 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer',
                      tab === t
                        ? 'border-primary text-primary'
                        : 'border-transparent text-slate-500 hover:text-foreground',
                    )}
                  >
                    {MAIL_SUBTAB_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {section === 'email-channels' ? (
              <AdminMailEmailChannelsPane
                tab={tab}
                channelId={channelId}
                onNavigateTab={(t, ch) => setNav({ tab: t, channel: ch ?? null })}
              />
            ) : (
              <AdminMailGenericSectionPane section={section} tab={tab} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
