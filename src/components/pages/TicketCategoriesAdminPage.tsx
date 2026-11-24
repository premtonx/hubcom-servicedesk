import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderTree, Flag, Layers, ListOrdered, Tag } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useTranslation } from '../../lib/context/I18nContext';
import { CategoriesSection } from '../admin/ticket-config/CategoriesSection';
import { StatusesSection } from '../admin/ticket-config/StatusesSection';
import { PrioritiesSection } from '../admin/ticket-config/PrioritiesSection';
import { TypesSection } from '../admin/ticket-config/TypesSection';

const SECTIONS = [
  { id: 'categories', label: 'Categories', labelDe: 'Kategorien', icon: FolderTree },
  { id: 'statuses', label: 'Statuses', labelDe: 'Status', icon: ListOrdered },
  { id: 'priorities', label: 'Priorities', labelDe: 'Prioritäten', icon: Flag },
  { id: 'types', label: 'Ticket Types', labelDe: 'Ticket-Typen', icon: Tag },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function resolveSection(raw: string | null): SectionId {
  const v = String(raw || '').toLowerCase();
  if (v === 'statuses' || v === 'status') return 'statuses';
  if (v === 'priorities' || v === 'priority') return 'priorities';
  if (v === 'types' || v === 'type' || v === 'ticket-types') return 'types';
  return 'categories';
}

/**
 * Admin-Hub → Ticket Configuration
 * (route kept at /admin/ticket-categories for existing bookmarks; also /admin/ticket-configuration)
 */
export default function TicketCategoriesAdminPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const section = useMemo(() => resolveSection(params.get('section')), [params]);

  const setSection = (next: string) => {
    const id = resolveSection(next);
    const sp = new URLSearchParams(params);
    if (id === 'categories') sp.delete('section');
    else sp.set('section', id);
    setParams(sp, { replace: true });
  };

  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-[#fafafa]">
      <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6 pb-20">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E8F1F8] flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5 text-[#1B6CA8]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black text-[#0B1F3A] tracking-tight">
              {t('ticketConfig.adminTitle', 'Ticket Configuration')}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t(
                'ticketConfig.adminDesc',
                'Kategorien, Status, Prioritäten und Ticket-Typen zentral verwalten — ohne bestehende Ticketdaten still zu löschen.',
              )}
            </p>
          </div>
        </div>

        <Tabs value={section} onValueChange={setSection} className="w-full">
          <TabsList className="w-full max-w-full h-auto flex flex-wrap justify-start gap-1 bg-white border border-slate-200 rounded-2xl p-1.5 shadow-sm">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  className="rounded-xl px-3 py-2 text-xs font-bold data-[state=active]:bg-[#0B1F3A] data-[state=active]:text-white gap-1.5"
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden />
                  <span className="hidden sm:inline">{s.labelDe}</span>
                  <span className="sm:hidden">{s.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="categories" className="mt-6 focus-visible:outline-none">
            <CategoriesSection />
          </TabsContent>
          <TabsContent value="statuses" className="mt-6 focus-visible:outline-none">
            <StatusesSection />
          </TabsContent>
          <TabsContent value="priorities" className="mt-6 focus-visible:outline-none">
            <PrioritiesSection />
          </TabsContent>
          <TabsContent value="types" className="mt-6 focus-visible:outline-none">
            <TypesSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
