import type { LucideIcon } from 'lucide-react';
import {
  Shield,
  Globe,
  Webhook,
  Database,
  ShieldAlert,
  Sparkles,
  Mail,
  Settings as SettingsIcon,
  Users,
  Radio,
  Briefcase,
  Bell,
  BarChart3,
  Building2,
  ShieldCheck,
  Lock,
  Clock,
  FolderTree,
} from 'lucide-react';

export const ADMIN_HUB_TABS = [
  { id: 'uebersicht', label: 'Übersicht', labelKey: 'admin.hubTabs.overview' },
  { id: 'ai-engine', label: 'Kern-KI & Modelle', labelKey: 'admin.hubTabs.aiEngine' },
  { id: 'rag', label: 'RAG & Wissensbasis', labelKey: 'admin.hubTabs.rag' },
  { id: 'governance', label: 'PII & Compliance', labelKey: 'admin.hubTabs.governance' },
  { id: 'integrations', label: 'Mail & Schnittstellen', labelKey: 'admin.hubTabs.integrations' },
  { id: 'system', label: 'Infrastruktur & Backups', labelKey: 'admin.hubTabs.system' },
] as const;

export type AdminHubTabId = (typeof ADMIN_HUB_TABS)[number]['id'];

const TAB_ALIASES: Record<string, AdminHubTabId> = {
  uebersicht: 'uebersicht',
  overview: 'uebersicht',
  'ai-engine': 'ai-engine',
  ai: 'ai-engine',
  ki: 'ai-engine',
  rag: 'rag',
  wissensbasis: 'rag',
  governance: 'governance',
  pii: 'governance',
  compliance: 'governance',
  integrations: 'integrations',
  mail: 'integrations',
  system: 'system',
  infra: 'system',
};

export function resolveAdminHubTab(raw: string | null | undefined): AdminHubTabId {
  const key = String(raw || '').trim().toLowerCase();
  return TAB_ALIASES[key] ?? 'uebersicht';
}

/** Sub-routes nested under AdminHubLayout → parent sidebar section + labels. */
export interface AdminHubSubRouteMeta {
  parentTab: AdminHubTabId;
  label: string;
  /** Optional German/English title override for content breadcrumb */
  title?: string;
}

/**
 * Longest-prefix wins. Keep more specific paths (e.g. time-tracking/overview) before parents.
 */
export const ADMIN_HUB_SUBROUTES: Array<{ path: string; meta: AdminHubSubRouteMeta }> = [
  { path: '/admin/time-tracking/overview', meta: { parentTab: 'system', label: 'Zeiterfassung Gesamt' } },
  { path: '/admin/time-tracking', meta: { parentTab: 'system', label: 'Zeiterfassung & Stundensätze' } },
  { path: '/admin/ticket-configuration', meta: { parentTab: 'system', label: 'Ticket Configuration' } },
  { path: '/admin/ticket-categories', meta: { parentTab: 'system', label: 'Ticket Configuration' } },
  { path: '/admin/vault-portfolio', meta: { parentTab: 'system', label: 'Vault-Portfoliomanagement' } },
  { path: '/admin/workforce-legacy', meta: { parentTab: 'system', label: 'Workforce (Legacy)' } },
  { path: '/admin/workforce', meta: { parentTab: 'system', label: 'Benutzerverwaltung' } },
  { path: '/admin/users', meta: { parentTab: 'system', label: 'Benutzerverwaltung' } },
  { path: '/admin/groups', meta: { parentTab: 'system', label: 'Functional Teams' } },
  { path: '/admin/roles', meta: { parentTab: 'system', label: 'RBAC Command' } },
  { path: '/admin/import', meta: { parentTab: 'system', label: 'Data Import & Migration' } },
  { path: '/admin/customers', meta: { parentTab: 'system', label: 'Kunden' } },
  { path: '/admin/settings', meta: { parentTab: 'system', label: 'Systemeinstellungen' } },
  { path: '/admin/branding', meta: { parentTab: 'system', label: 'Firmenbranding' } },
  { path: '/admin/contact-schema', meta: { parentTab: 'system', label: 'Kontaktprofil' } },
  { path: '/admin/insights', meta: { parentTab: 'ai-engine', label: 'Sovereign AI Insights' } },
  { path: '/admin/sovereignty', meta: { parentTab: 'governance', label: 'Sovereignty Center' } },
  { path: '/admin/pii', meta: { parentTab: 'governance', label: 'PII Shield' } },
  { path: '/admin/legal', meta: { parentTab: 'governance', label: 'Legal & Risk' } },
  { path: '/admin/audit', meta: { parentTab: 'governance', label: 'Reports & Auditing' } },
  { path: '/admin/schema', meta: { parentTab: 'governance', label: 'Company Schema' } },
  { path: '/admin/rag/pipeline', meta: { parentTab: 'rag', label: 'RAG Pipeline Status' } },
  { path: '/admin/rag/search', meta: { parentTab: 'rag', label: 'Similarity Search Test' } },
  { path: '/admin/notifications', meta: { parentTab: 'integrations', label: 'Benachrichtigungen' } },
  { path: '/admin/integrations', meta: { parentTab: 'integrations', label: 'Integrations-Hub' } },
  { path: '/admin/polyglot', meta: { parentTab: 'integrations', label: 'Polyglot Bridge' } },
  { path: '/admin/email-channels', meta: { parentTab: 'integrations', label: 'E-Mail-Kanäle' } },
  { path: '/email-channels', meta: { parentTab: 'integrations', label: 'E-Mail-Kanäle' } },
];

export function findAdminHubSubRoute(pathname: string): AdminHubSubRouteMeta | null {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  for (const entry of ADMIN_HUB_SUBROUTES) {
    if (path === entry.path || path.startsWith(`${entry.path}/`)) {
      return entry.meta;
    }
  }
  return null;
}

export function tabLabel(tabId: AdminHubTabId): string {
  return ADMIN_HUB_TABS.find((t) => t.id === tabId)?.label ?? tabId;
}

/** Resolve which left-sidebar section should be highlighted for the current location. */
export function resolveActiveAdminHubSection(
  pathname: string,
  searchParams?: URLSearchParams | { get: (key: string) => string | null },
): AdminHubTabId {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path === '/admin' || path === '/admin/') {
    return resolveAdminHubTab(searchParams?.get('tab'));
  }
  const sub = findAdminHubSubRoute(path);
  if (sub) return sub.parentTab;
  // Nested under /admin but unknown → keep Übersicht only when truly on hub index aliases
  if (path.startsWith('/admin')) {
    return resolveAdminHubTab(searchParams?.get('tab'));
  }
  return 'uebersicht';
}

export interface AdminHubSection {
  title: string;
  description: string;
  icon: LucideIcon;
  path: string;
  color: string;
  bgColor: string;
  borderColor: string;
  badge: string;
  module: string;
  /** When set, “Configure” scrolls to this element id on the current page instead of navigating. */
  scrollTargetId?: string;
}

export interface AdminHubCategory {
  id: string;
  title: string;
  tab: AdminHubTabId;
  sections: AdminHubSection[];
}

export const ADMIN_HUB_CATEGORIES: AdminHubCategory[] = [
  {
    id: 'core_ai',
    title: 'Core AI',
    tab: 'ai-engine',
    sections: [
      {
        title: 'AI Orchestrator',
        description: 'Configure LLM routing, sentiment analysis, and intelligence layers.',
        icon: Sparkles,
        path: '#admin-hub-ai-orchestrator',
        color: 'text-blue-500',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-105',
        badge: 'Core Engine',
        module: 'legal',
        scrollTargetId: 'admin-hub-ai-orchestrator',
      },
      {
        title: 'Sovereign AI Insights',
        description: 'Executive intelligence, autonomous problem detection clusters, and SLA analysis.',
        icon: Sparkles,
        path: '/admin/insights',
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-105',
        badge: 'Insights',
        module: 'insights',
      },
    ],
  },
  {
    id: 'rag_indexing',
    title: 'RAG Indexing',
    tab: 'rag',
    sections: [
      {
        title: 'RAG Pipeline Status',
        description: 'Indexed KB articles vs vector chunks, solved tickets vs vectors, and missing-index gaps.',
        icon: Database,
        path: '/admin/rag/pipeline',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-105',
        badge: 'Indexing',
        module: 'kb',
      },
      {
        title: 'Similarity Search Test',
        description: 'Run an end-to-end retrieval query against the vector store and inspect top hits.',
        icon: Sparkles,
        path: '/admin/rag/search',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-105',
        badge: 'Retrieval',
        module: 'kb',
      },
    ],
  },
  {
    id: 'identity_access',
    title: 'Identity & Access',
    tab: 'system',
    sections: [
      {
        title: 'RBAC Command',
        description: 'Granular role architecture, module-level scoping, and user mapping.',
        icon: ShieldCheck,
        path: '/admin/roles',
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-105',
        badge: 'Governance',
        module: 'rbac',
      },
      {
        title: 'Benutzerverwaltung',
        description: 'Lokale Benutzer und Microsoft 365 / Entra ID — Rollen, Kürzel, Sync und SSO.',
        icon: Briefcase,
        path: '/admin/users',
        color: 'text-violet-600',
        bgColor: 'bg-violet-50',
        borderColor: 'border-violet-105',
        badge: 'Benutzer',
        module: 'workforce',
      },
      {
        title: 'Functional Teams',
        description: 'Manage agent groups, routing targets, and team schedules.',
        icon: Users,
        path: '/admin/groups',
        color: 'text-violet-500',
        bgColor: 'bg-violet-50',
        borderColor: 'border-violet-105',
        badge: 'Routing',
        module: 'groups',
      },
      {
        title: 'Vault-Portfoliomanagement',
        description: 'Create KeePass-style vault instances, assign users, and manage RBAC clearance tiers.',
        icon: Lock,
        path: '/admin/vault-portfolio',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-105',
        badge: 'Tresor',
        module: 'vault',
      },
      {
        title: 'Companies Directory',
        description: 'Manage corporate organizational accounts, domains, SLA tiers, and credentials.',
        icon: Building2,
        path: '/admin/customers',
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-105',
        badge: 'Structure',
        module: 'customers',
      },
    ],
  },
  {
    id: 'governance',
    title: 'Governance',
    tab: 'governance',
    sections: [
      {
        title: 'Sovereignty Center',
        description: 'Verify local data residency, encryption status, and network egress limits in real-time.',
        icon: ShieldCheck,
        path: '/admin/sovereignty',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-105',
        badge: 'Sovereignty',
        module: 'legal',
      },
      {
        title: 'PII Shield',
        description: 'Manage data redaction, compliance guardrails, and security masks.',
        icon: Shield,
        path: '/admin/pii',
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-105',
        badge: 'Security',
        module: 'legal',
      },
      {
        title: 'Legal & Risk',
        description: 'Forbidden topics, AI disclosures, and automated compliance checks.',
        icon: ShieldAlert,
        path: '/admin/legal',
        color: 'text-amber-500',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-105',
        badge: 'Governance',
        module: 'legal',
      },
      {
        title: 'Reports & Auditing',
        description: 'Immutable protocol audit trails, legal intercepts, and compliance tracking.',
        icon: BarChart3,
        path: '/admin/audit',
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        borderColor: 'border-purple-105',
        badge: 'Reports',
        module: 'rbac',
      },
      {
        title: 'Company Schema',
        description: 'Dynamic metadata fields for accounts. Managed by AI Schema Architect.',
        icon: Database,
        path: '/admin/schema',
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-105',
        badge: 'Structure',
        module: 'customers',
      },
    ],
  },
  {
    id: 'integrations',
    title: 'Integrations',
    tab: 'integrations',
    sections: [
      {
        title: 'E-Mail-Kanäle',
        description:
          'Eingehende und ausgehende E-Mail: Kanäle, Absender, Anzeigename, SMTP und Standard-Absender für Ticket-Antworten.',
        icon: Mail,
        path: '/admin/email-channels',
        color: 'text-rose-500',
        bgColor: 'bg-rose-50',
        borderColor: 'border-rose-105',
        badge: 'Kanäle',
        module: 'tickets',
      },
      {
        title: 'Notifications',
        description: 'System triggers, master templates, and automated alerts.',
        icon: Bell,
        path: '/admin/notifications',
        color: 'text-orange-500',
        bgColor: 'bg-orange-50',
        borderColor: 'border-orange-105',
        badge: 'Automation',
        module: 'rbac',
      },
      {
        title: 'Integrations Hub',
        description: 'Personio, Slack, Webhooks, and external API connections.',
        icon: Webhook,
        path: '/admin/integrations',
        color: 'text-indigo-500',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-105',
        badge: 'Connectivity',
        module: 'rbac',
      },
      {
        title: 'API & MCP',
        description: 'Enable the native MCP server, manage API tokens, and copy client configs.',
        icon: Radio,
        path: '#admin-hub-mcp-panel',
        color: 'text-rose-600',
        bgColor: 'bg-rose-50',
        borderColor: 'border-rose-105',
        badge: 'Protocol',
        module: 'rbac',
        scrollTargetId: 'admin-hub-mcp-panel',
      },
      {
        title: 'Polyglot Bridge',
        description: 'Provision header flags, translation API keys, and custom phrase dictionaries.',
        icon: Globe,
        path: '/admin/polyglot',
        color: 'text-teal-600',
        bgColor: 'bg-teal-50',
        borderColor: 'border-teal-105',
        badge: 'Global',
        module: 'rbac',
      },
    ],
  },
  {
    id: 'platform',
    title: 'Platform',
    tab: 'system',
    sections: [
      {
        title: 'Systemeinstellungen',
        description:
          'Identität, globale Feature-Flags, Workspace-Module und Debug-Werkzeuge.',
        icon: SettingsIcon,
        path: '/admin/settings',
        color: 'text-slate-500',
        bgColor: 'bg-slate-50',
        borderColor: 'border-slate-105',
        badge: 'Global',
        module: 'rbac',
      },
      {
        title: 'Firmenbranding',
        description:
          'Firmenname Hubcom - Citadelle AG, Support-Domain und Logo (Platzhalter durch offizielles Logo ersetzen).',
        icon: Briefcase,
        path: '/admin/branding',
        color: 'text-[#1B6CA8]',
        bgColor: 'bg-[#E8F1F8]',
        borderColor: 'border-[#1B6CA8]/20',
        badge: 'Branding',
        module: 'rbac',
      },
      {
        title: 'Data Import & Migration',
        description:
          'Massenimport (CSV/JSON) für Tickets und Wissensdatenbank sowie Schnellerfassung mit RAG-Indexierung.',
        icon: Database,
        path: '/admin/import',
        color: 'text-cyan-600',
        bgColor: 'bg-cyan-50',
        borderColor: 'border-cyan-105',
        badge: 'Migration',
        module: 'rbac',
      },
      {
        title: 'Zeiterfassung & Stundensätze',
        description:
          'Standard- und Sonderzahlungssätze, Excel-Export und Microsoft Graph Synchronisation.',
        icon: Clock,
        path: '/admin/time-tracking',
        color: 'text-[#1B6CA8]',
        bgColor: 'bg-[#E8F1F8]',
        borderColor: 'border-[#1B6CA8]/20',
        badge: 'Reporting',
        module: 'rbac',
      },
      {
        title: 'Zeiterfassung Gesamt',
        description: 'Globale Übersicht aller Zeiteinträge inkl. Excel-Download.',
        icon: BarChart3,
        path: '/admin/time-tracking/overview',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-105',
        badge: 'Reporting',
        module: 'rbac',
      },
      {
        title: 'Ticket Configuration',
        description:
          'Kategorien, Status, Prioritäten und Ticket-Typen anlegen, sortieren und aktivieren.',
        icon: FolderTree,
        path: '/admin/ticket-configuration',
        color: 'text-violet-600',
        bgColor: 'bg-violet-50',
        borderColor: 'border-violet-105',
        badge: 'Struktur',
        module: 'tickets',
      },
      {
        title: 'Kontaktprofil',
        description: 'Custom attributes for individuals. Ingested into AI reply context.',
        icon: Users,
        path: '/admin/contact-schema',
        color: 'text-sky-600',
        bgColor: 'bg-sky-50',
        borderColor: 'border-sky-105',
        badge: 'Schema',
        module: 'customers',
      },
      {
        title: 'Client Organizations',
        description:
          'MSP-Kunden-Tenants anlegen und den initialen CLIENT_ADMIN für jede Organisation provisionieren.',
        icon: Building2,
        path: '/admin/customers',
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-105',
        badge: 'MSP Portal',
        module: 'rbac',
      },
    ],
  },
];

export function categoriesForTab(tab: AdminHubTabId): AdminHubCategory[] {
  return ADMIN_HUB_CATEGORIES.filter((category) => category.tab === tab);
}
