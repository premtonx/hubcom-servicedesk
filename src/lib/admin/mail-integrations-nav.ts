/**
 * Admin-Hub → Mail & Schnittstellen secondary navigation + URL sync.
 */

export const MAIL_SECTION_IDS = [
  'email-channels',
  'notifications',
  'integrations-hub',
  'api-mcp',
  'polyglot',
] as const;

export type MailSectionId = (typeof MAIL_SECTION_IDS)[number];

export const MAIL_SUBTAB_IDS = [
  'overview',
  'configuration',
  'settings',
  'test',
  'logs',
] as const;

export type MailSubTabId = (typeof MAIL_SUBTAB_IDS)[number];

export type MailSectionDef = {
  id: MailSectionId;
  label: string;
  description: string;
  /** Lucide icon name key for the shell */
  icon: 'mail' | 'bell' | 'puzzle' | 'code2' | 'globe';
  primaryActionLabel: string;
  subtabs: MailSubTabId[];
};

export const MAIL_SECTIONS: MailSectionDef[] = [
  {
    id: 'email-channels',
    label: 'E-Mail-Kanäle',
    description:
      'Eingehende und ausgehende E-Mail: Kanäle, Absender, Anzeigename, SMTP und Standard-Absender für Ticket-Antworten.',
    icon: 'mail',
    primaryActionLabel: '+ Neuen Kanal hinzufügen',
    subtabs: ['overview', 'configuration', 'settings', 'test', 'logs'],
  },
  {
    id: 'notifications',
    label: 'Benachrichtigungen',
    description: 'System-Trigger, Master-Vorlagen und automatisierte Warnmeldungen.',
    icon: 'bell',
    primaryActionLabel: 'Konfigurieren',
    subtabs: ['overview', 'configuration', 'settings', 'test', 'logs'],
  },
  {
    id: 'integrations-hub',
    label: 'Integrations-Hub',
    description: 'Personio, Slack, Webhooks und externe API-Verbindungen.',
    icon: 'puzzle',
    primaryActionLabel: 'Konfigurieren',
    subtabs: ['overview', 'configuration', 'settings', 'test', 'logs'],
  },
  {
    id: 'api-mcp',
    label: 'API & MCP',
    description:
      'Nativen MCP-Server aktivieren, API-Tokens verwalten und Client-Konfigurationen kopieren.',
    icon: 'code2',
    primaryActionLabel: 'Konfigurieren',
    subtabs: ['overview', 'configuration', 'settings', 'test', 'logs'],
  },
  {
    id: 'polyglot',
    label: 'Polyglot Bridge',
    description:
      'Header-Flags, Übersetzungs-API-Schlüssel und benutzerdefinierte Phrasenwörterbücher bereitstellen.',
    icon: 'globe',
    primaryActionLabel: 'Konfigurieren',
    subtabs: ['overview', 'configuration', 'settings', 'test', 'logs'],
  },
];

export const MAIL_SUBTAB_LABELS: Record<MailSubTabId, string> = {
  overview: 'Übersicht',
  configuration: 'Konfiguration',
  settings: 'Einstellungen',
  test: 'Testen',
  logs: 'Logs',
};

const SECTION_ALIASES: Record<string, MailSectionId> = {
  'email-channels': 'email-channels',
  email: 'email-channels',
  channels: 'email-channels',
  kanäle: 'email-channels',
  kanaele: 'email-channels',
  notifications: 'notifications',
  benachrichtigungen: 'notifications',
  'integrations-hub': 'integrations-hub',
  integrations: 'integrations-hub',
  hub: 'integrations-hub',
  'api-mcp': 'api-mcp',
  mcp: 'api-mcp',
  api: 'api-mcp',
  polyglot: 'polyglot',
  bridge: 'polyglot',
};

const TAB_ALIASES: Record<string, MailSubTabId> = {
  overview: 'overview',
  übersicht: 'overview',
  uebersicht: 'overview',
  configuration: 'configuration',
  konfigurierung: 'configuration',
  config: 'configuration',
  settings: 'settings',
  einstellungen: 'settings',
  test: 'test',
  testen: 'test',
  logs: 'logs',
  protokoll: 'logs',
};

export function resolveMailSection(raw: string | null | undefined): MailSectionId {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  return SECTION_ALIASES[key] ?? 'email-channels';
}

export function resolveMailSubTab(
  raw: string | null | undefined,
  section?: MailSectionId,
): MailSubTabId {
  const key = String(raw || '')
    .trim()
    .toLowerCase();
  const tab = TAB_ALIASES[key] ?? 'overview';
  const def = MAIL_SECTIONS.find((s) => s.id === (section || 'email-channels'));
  if (def && !def.subtabs.includes(tab)) return 'overview';
  return tab;
}

export function getMailSectionDef(id: MailSectionId): MailSectionDef {
  return MAIL_SECTIONS.find((s) => s.id === id) || MAIL_SECTIONS[0];
}

/** Build /admin/mail search string (section + tab + optional channel). */
export function buildMailSearch(params: {
  section: MailSectionId;
  tab: MailSubTabId;
  channel?: string | null;
}): string {
  const q = new URLSearchParams();
  q.set('section', params.section);
  q.set('tab', params.tab);
  if (params.channel) q.set('channel', params.channel);
  return `?${q.toString()}`;
}

export function mailWorkspacePath(params: {
  section: MailSectionId;
  tab: MailSubTabId;
  channel?: string | null;
}): string {
  return `/admin/mail${buildMailSearch(params)}`;
}

/** Map legacy admin paths → mail workspace. */
export function legacyAdminPathToMailWorkspace(pathname: string): string | null {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  if (path === '/admin/email-channels' || path === '/email-channels') {
    return mailWorkspacePath({ section: 'email-channels', tab: 'overview' });
  }
  if (path === '/admin/notifications') {
    return mailWorkspacePath({ section: 'notifications', tab: 'overview' });
  }
  if (path === '/admin/integrations') {
    return mailWorkspacePath({ section: 'integrations-hub', tab: 'overview' });
  }
  if (path === '/admin/polyglot') {
    return mailWorkspacePath({ section: 'polyglot', tab: 'overview' });
  }
  if (path === '/admin/mcp') {
    return mailWorkspacePath({ section: 'api-mcp', tab: 'overview' });
  }
  return null;
}
