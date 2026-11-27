/**
 * SQL-backed Client Organizations (Kunden) for the MSP co-managed portal.
 * Distinct from CRM `companies` documents — organizations are portal tenants.
 */

import { randomUUID } from 'crypto';
import { queryDb } from '../postgres-backend.js';
import {
  defaultHardwareReturnsConfig,
  normalizeHardwareReturnsConfig,
  type HardwareReturnsConfig,
} from './hardware-returns.js';
import {
  resolveSsoApprovalMode,
  type SsoApprovalMode,
} from './sso-approval.js';
import {
  mergePortalThemeIntoSettings,
  portalThemeFromOrganization,
  type PortalThemeSettings,
} from './portal-theme.js';

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  is_active: boolean;
  settings: Record<string, unknown>;
  /** Optional Entra ID (Microsoft 365) tenant GUID for client SSO. */
  m365_tenant_id: string | null;
  /** When true, users from m365_tenant_id may sign in via Microsoft SSO. */
  sso_enabled: boolean;
  /**
   * M365 SSO Freigabe-Modus (stored in settings.sso_approval_mode).
   * Defaults to admin_approval when SSO is used.
   */
  sso_approval_mode: SsoApprovalMode;
  /** Optional Kunden-Portal logo (data URL). */
  logo_url: string | null;
  /** Custom portal title; empty → "{name} ServiceDesk". */
  portal_title: string | null;
  /** Optional Kunden-Portal dashboard banner (data URL). */
  portal_banner_url: string | null;
  /** Optional Kunden-Portal favicon (data URL). */
  favicon_url: string | null;
  /** CRM / Unternehmen fields (unified with companies docs). */
  industry: string | null;
  website: string | null;
  tier: string | null;
  sla: string | null;
  contract_renewal: string | null;
  monthly_rate: string | null;
  contract_reference: string | null;
  contract_notes: string | null;
  contract_term: string | null;
  /** Fixture / seed flag — purged by Demo-Daten bereinigen. */
  is_demo: boolean;
  /** Linked CRM company document id (geistdesk_documents.companies). */
  crm_company_id: string | null;
  /** Per-org Hardware-Rücklieferungen & SL module (default false). */
  hardware_returns_enabled: boolean;
  /** Module config (recipients, templates, delays). */
  hardware_returns_config: HardwareReturnsConfig;
  /** Per-org Sicherer Austausch module (default true). */
  secure_exchange_enabled: boolean;
  /** Per-org Tresor module (default true). */
  vault_enabled: boolean;
  /** Client Portal theme (from settings.portal_theme). */
  portal_theme: PortalThemeSettings;
  created_at: string;
  updated_at: string;
}

export interface OrganizationInput {
  name: string;
  slug?: string | null;
  domain?: string | null;
  is_active?: boolean;
  settings?: Record<string, unknown>;
  m365_tenant_id?: string | null;
  sso_enabled?: boolean;
  sso_approval_mode?: SsoApprovalMode | null;
  logo_url?: string | null;
  portal_title?: string | null;
  portal_banner_url?: string | null;
  favicon_url?: string | null;
  industry?: string | null;
  website?: string | null;
  tier?: string | null;
  sla?: string | null;
  contract_renewal?: string | null;
  monthly_rate?: string | null;
  contract_reference?: string | null;
  contract_notes?: string | null;
  contract_term?: string | null;
  is_demo?: boolean;
  crm_company_id?: string | null;
  hardware_returns_enabled?: boolean;
  hardware_returns_config?: Partial<HardwareReturnsConfig> | HardwareReturnsConfig | null;
  secure_exchange_enabled?: boolean;
  vault_enabled?: boolean;
}

function slugify(input: string): string {
  return (
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `org-${randomUUID().slice(0, 8)}`
  );
}

function mapRow(row: any): OrganizationRecord {
  const settings =
    row.settings == null
      ? {}
      : typeof row.settings === 'string'
        ? (JSON.parse(row.settings) as Record<string, unknown>)
        : (row.settings as Record<string, unknown>);

  // Prefer dedicated columns; fall back to settings JSON for older rows.
  const settingsTenant =
    typeof settings.m365_tenant_id === 'string'
      ? settings.m365_tenant_id
      : typeof settings.m365TenantId === 'string'
        ? settings.m365TenantId
        : null;
  const settingsSso =
    typeof settings.sso_enabled === 'boolean'
      ? settings.sso_enabled
      : typeof settings.ssoEnabled === 'boolean'
        ? settings.ssoEnabled
        : false;

  return {
    id: String(row.id),
    name: String(row.name || ''),
    slug: String(row.slug || ''),
    domain: row.domain == null || row.domain === '' ? null : String(row.domain),
    is_active: row.is_active !== false && row.is_active !== 'f',
    settings: settings || {},
    m365_tenant_id:
      row.m365_tenant_id == null || row.m365_tenant_id === ''
        ? settingsTenant
        : String(row.m365_tenant_id),
    sso_enabled:
      row.sso_enabled === true || row.sso_enabled === 't' || settingsSso === true,
    sso_approval_mode: resolveSsoApprovalMode({
      sso_enabled: row.sso_enabled === true || row.sso_enabled === 't' || settingsSso === true,
      settings: settings || {},
    }),
    logo_url: row.logo_url == null || row.logo_url === '' ? null : String(row.logo_url),
    portal_title:
      row.portal_title == null || row.portal_title === ''
        ? null
        : String(row.portal_title),
    portal_banner_url:
      row.portal_banner_url == null || row.portal_banner_url === ''
        ? null
        : String(row.portal_banner_url),
    favicon_url:
      row.favicon_url == null || row.favicon_url === '' ? null : String(row.favicon_url),
    industry: row.industry == null || row.industry === '' ? null : String(row.industry),
    website: row.website == null || row.website === '' ? null : String(row.website),
    tier: row.tier == null || row.tier === '' ? null : String(row.tier),
    sla: row.sla == null || row.sla === '' ? null : String(row.sla),
    contract_renewal:
      row.contract_renewal == null || row.contract_renewal === ''
        ? null
        : String(row.contract_renewal),
    monthly_rate:
      row.monthly_rate == null || row.monthly_rate === '' ? null : String(row.monthly_rate),
    contract_reference:
      row.contract_reference == null || row.contract_reference === ''
        ? null
        : String(row.contract_reference),
    contract_notes:
      row.contract_notes == null || row.contract_notes === ''
        ? null
        : String(row.contract_notes),
    contract_term:
      row.contract_term == null || row.contract_term === ''
        ? null
        : String(row.contract_term),
    is_demo: row.is_demo === true || row.is_demo === 't',
    crm_company_id:
      row.crm_company_id == null || row.crm_company_id === ''
        ? null
        : String(row.crm_company_id),
    hardware_returns_enabled:
      row.hardware_returns_enabled === true || row.hardware_returns_enabled === 't',
    hardware_returns_config: normalizeHardwareReturnsConfig(
      row.hardware_returns_config ?? defaultHardwareReturnsConfig(),
    ),
    // Missing column / null → default true (legacy orgs keep Exchange + Tresor).
    secure_exchange_enabled:
      row.secure_exchange_enabled == null
        ? true
        : row.secure_exchange_enabled === true || row.secure_exchange_enabled === 't',
    vault_enabled:
      row.vault_enabled == null
        ? true
        : row.vault_enabled === true || row.vault_enabled === 't',
    portal_theme: portalThemeFromOrganization({ settings: settings || {} }),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : '',
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

export async function listOrganizations(opts?: {
  includeInactive?: boolean;
}): Promise<OrganizationRecord[]> {
  const sql = opts?.includeInactive
    ? `SELECT * FROM organizations ORDER BY name ASC`
    : `SELECT * FROM organizations WHERE is_active = TRUE ORDER BY name ASC`;
  const res = await queryDb(sql);
  return res.rows.map(mapRow);
}

export async function getOrganization(id: string): Promise<OrganizationRecord | null> {
  const res = await queryDb(`SELECT * FROM organizations WHERE id = $1 LIMIT 1`, [id]);
  if (!res.rowCount) return null;
  return mapRow(res.rows[0]);
}

export async function getOrganizationBySlug(slug: string): Promise<OrganizationRecord | null> {
  const res = await queryDb(`SELECT * FROM organizations WHERE slug = $1 LIMIT 1`, [
    slugify(slug),
  ]);
  if (!res.rowCount) return null;
  return mapRow(res.rows[0]);
}

/** Resolve an SSO-enabled organization by Entra tenant GUID. */
export async function getOrganizationByM365TenantId(
  tenantId: string,
): Promise<OrganizationRecord | null> {
  const tid = String(tenantId || '').trim().toLowerCase();
  if (!tid) return null;
  const res = await queryDb(
    `SELECT * FROM organizations
      WHERE sso_enabled = TRUE
        AND LOWER(TRIM(m365_tenant_id)) = $1
        AND is_active = TRUE
      LIMIT 1`,
    [tid],
  );
  if (res.rowCount) return mapRow(res.rows[0]);

  // Fallback: settings JSON (pre-column deployments)
  const all = await listOrganizations({ includeInactive: false });
  return (
    all.find(
      (o) =>
        o.sso_enabled &&
        o.m365_tenant_id &&
        o.m365_tenant_id.trim().toLowerCase() === tid,
    ) || null
  );
}

export async function createOrganization(input: OrganizationInput): Promise<OrganizationRecord> {
  const id = randomUUID();
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Organization name is required.');
  const slug = slugify(input.slug || name);
  const domain = input.domain ? String(input.domain).trim().toLowerCase() : null;
  const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const isActive = input.is_active !== false;
  const m365TenantId = input.m365_tenant_id
    ? String(input.m365_tenant_id).trim()
    : null;
  const ssoEnabled = Boolean(input.sso_enabled);
  const logoUrl =
    input.logo_url == null || String(input.logo_url).trim() === ''
      ? null
      : String(input.logo_url).trim();
  const portalTitle =
    input.portal_title == null || String(input.portal_title).trim() === ''
      ? null
      : String(input.portal_title).trim().slice(0, 120);
  const industry =
    input.industry == null || String(input.industry).trim() === ''
      ? null
      : String(input.industry).trim();
  const website =
    input.website == null || String(input.website).trim() === ''
      ? null
      : String(input.website).trim();
  const tier =
    input.tier == null || String(input.tier).trim() === ''
      ? null
      : String(input.tier).trim();
  const sla =
    input.sla == null || String(input.sla).trim() === ''
      ? null
      : String(input.sla).trim();
  const contractRenewal =
    input.contract_renewal == null || String(input.contract_renewal).trim() === ''
      ? null
      : String(input.contract_renewal).trim();
  const portalBannerUrl =
    input.portal_banner_url == null || String(input.portal_banner_url).trim() === ''
      ? null
      : String(input.portal_banner_url).trim();
  const faviconUrl =
    input.favicon_url == null || String(input.favicon_url).trim() === ''
      ? null
      : String(input.favicon_url).trim();
  const monthlyRate =
    input.monthly_rate == null || String(input.monthly_rate).trim() === ''
      ? null
      : String(input.monthly_rate).trim();
  const contractReference =
    input.contract_reference == null || String(input.contract_reference).trim() === ''
      ? null
      : String(input.contract_reference).trim();
  const contractNotes =
    input.contract_notes == null || String(input.contract_notes).trim() === ''
      ? null
      : String(input.contract_notes).trim();
  const contractTerm =
    input.contract_term == null || String(input.contract_term).trim() === ''
      ? null
      : String(input.contract_term).trim();
  const isDemo = Boolean(input.is_demo);
  const crmCompanyId =
    input.crm_company_id == null || String(input.crm_company_id).trim() === ''
      ? null
      : String(input.crm_company_id).trim();
  const hardwareReturnsEnabled = Boolean(input.hardware_returns_enabled);
  const hardwareReturnsConfig = normalizeHardwareReturnsConfig(
    input.hardware_returns_config ?? defaultHardwareReturnsConfig(),
  );
  const secureExchangeEnabled =
    input.secure_exchange_enabled === undefined ? true : Boolean(input.secure_exchange_enabled);
  const vaultEnabled = input.vault_enabled === undefined ? true : Boolean(input.vault_enabled);

  const res = await queryDb(
    `INSERT INTO organizations (
       id, name, slug, domain, is_active, settings, m365_tenant_id, sso_enabled,
       logo_url, portal_title, portal_banner_url, favicon_url, industry, website, tier, sla,
       contract_renewal, monthly_rate, contract_reference, contract_notes, contract_term,
       is_demo, crm_company_id, hardware_returns_enabled, hardware_returns_config,
       secure_exchange_enabled, vault_enabled
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb, $26, $27)
     RETURNING *`,
    [
      id,
      name,
      slug,
      domain,
      isActive,
      JSON.stringify(settings),
      m365TenantId,
      ssoEnabled,
      logoUrl,
      portalTitle,
      portalBannerUrl,
      faviconUrl,
      industry,
      website,
      tier,
      sla,
      contractRenewal,
      monthlyRate,
      contractReference,
      contractNotes,
      contractTerm,
      isDemo,
      crmCompanyId,
      hardwareReturnsEnabled,
      JSON.stringify(hardwareReturnsConfig),
      secureExchangeEnabled,
      vaultEnabled,
    ],
  );
  return mapRow(res.rows[0]);
}

export async function updateOrganization(
  id: string,
  input: Partial<OrganizationInput>,
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;

  const name = input.name !== undefined ? String(input.name).trim() : existing.name;
  if (!name) throw new Error('Organization name is required.');
  const slug =
    input.slug !== undefined ? slugify(input.slug || name) : existing.slug;
  const domain =
    input.domain !== undefined
      ? input.domain
        ? String(input.domain).trim().toLowerCase()
        : null
      : existing.domain;
  const isActive =
    input.is_active !== undefined ? Boolean(input.is_active) : existing.is_active;
  const settings =
    input.settings !== undefined && typeof input.settings === 'object'
      ? input.settings
      : existing.settings;
  const m365TenantId =
    input.m365_tenant_id !== undefined
      ? input.m365_tenant_id
        ? String(input.m365_tenant_id).trim()
        : null
      : existing.m365_tenant_id;
  const ssoEnabled =
    input.sso_enabled !== undefined ? Boolean(input.sso_enabled) : existing.sso_enabled;
  const logoUrl =
    input.logo_url !== undefined
      ? input.logo_url == null || String(input.logo_url).trim() === ''
        ? null
        : String(input.logo_url).trim()
      : existing.logo_url;
  const portalTitle =
    input.portal_title !== undefined
      ? input.portal_title == null || String(input.portal_title).trim() === ''
        ? null
        : String(input.portal_title).trim().slice(0, 120)
      : existing.portal_title;
  const industry =
    input.industry !== undefined
      ? input.industry == null || String(input.industry).trim() === ''
        ? null
        : String(input.industry).trim()
      : existing.industry;
  const website =
    input.website !== undefined
      ? input.website == null || String(input.website).trim() === ''
        ? null
        : String(input.website).trim()
      : existing.website;
  const tier =
    input.tier !== undefined
      ? input.tier == null || String(input.tier).trim() === ''
        ? null
        : String(input.tier).trim()
      : existing.tier;
  const sla =
    input.sla !== undefined
      ? input.sla == null || String(input.sla).trim() === ''
        ? null
        : String(input.sla).trim()
      : existing.sla;
  const contractRenewal =
    input.contract_renewal !== undefined
      ? input.contract_renewal == null || String(input.contract_renewal).trim() === ''
        ? null
        : String(input.contract_renewal).trim()
      : existing.contract_renewal;
  const portalBannerUrl =
    input.portal_banner_url !== undefined
      ? input.portal_banner_url == null || String(input.portal_banner_url).trim() === ''
        ? null
        : String(input.portal_banner_url).trim()
      : existing.portal_banner_url;
  const faviconUrl =
    input.favicon_url !== undefined
      ? input.favicon_url == null || String(input.favicon_url).trim() === ''
        ? null
        : String(input.favicon_url).trim()
      : existing.favicon_url;
  const monthlyRate =
    input.monthly_rate !== undefined
      ? input.monthly_rate == null || String(input.monthly_rate).trim() === ''
        ? null
        : String(input.monthly_rate).trim()
      : existing.monthly_rate;
  const contractReference =
    input.contract_reference !== undefined
      ? input.contract_reference == null || String(input.contract_reference).trim() === ''
        ? null
        : String(input.contract_reference).trim()
      : existing.contract_reference;
  const contractNotes =
    input.contract_notes !== undefined
      ? input.contract_notes == null || String(input.contract_notes).trim() === ''
        ? null
        : String(input.contract_notes).trim()
      : existing.contract_notes;
  const contractTerm =
    input.contract_term !== undefined
      ? input.contract_term == null || String(input.contract_term).trim() === ''
        ? null
        : String(input.contract_term).trim()
      : existing.contract_term;
  const isDemo =
    input.is_demo !== undefined ? Boolean(input.is_demo) : existing.is_demo;
  const crmCompanyId =
    input.crm_company_id !== undefined
      ? input.crm_company_id == null || String(input.crm_company_id).trim() === ''
        ? null
        : String(input.crm_company_id).trim()
      : existing.crm_company_id;
  const hardwareReturnsEnabled =
    input.hardware_returns_enabled !== undefined
      ? Boolean(input.hardware_returns_enabled)
      : existing.hardware_returns_enabled;
  const hardwareReturnsConfig =
    input.hardware_returns_config !== undefined
      ? normalizeHardwareReturnsConfig({
          ...existing.hardware_returns_config,
          ...(input.hardware_returns_config || {}),
        })
      : existing.hardware_returns_config;
  const secureExchangeEnabled =
    input.secure_exchange_enabled !== undefined
      ? Boolean(input.secure_exchange_enabled)
      : existing.secure_exchange_enabled;
  const vaultEnabled =
    input.vault_enabled !== undefined
      ? Boolean(input.vault_enabled)
      : existing.vault_enabled;

  const res = await queryDb(
    `UPDATE organizations
        SET name = $2,
            slug = $3,
            domain = $4,
            is_active = $5,
            settings = $6::jsonb,
            m365_tenant_id = $7,
            sso_enabled = $8,
            logo_url = $9,
            portal_title = $10,
            portal_banner_url = $11,
            favicon_url = $12,
            industry = $13,
            website = $14,
            tier = $15,
            sla = $16,
            contract_renewal = $17,
            monthly_rate = $18,
            contract_reference = $19,
            contract_notes = $20,
            contract_term = $21,
            is_demo = $22,
            crm_company_id = $23,
            hardware_returns_enabled = $24,
            hardware_returns_config = $25::jsonb,
            secure_exchange_enabled = $26,
            vault_enabled = $27,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      name,
      slug,
      domain,
      isActive,
      JSON.stringify(settings),
      m365TenantId,
      ssoEnabled,
      logoUrl,
      portalTitle,
      portalBannerUrl,
      faviconUrl,
      industry,
      website,
      tier,
      sla,
      contractRenewal,
      monthlyRate,
      contractReference,
      contractNotes,
      contractTerm,
      isDemo,
      crmCompanyId,
      hardwareReturnsEnabled,
      JSON.stringify(hardwareReturnsConfig),
      secureExchangeEnabled,
      vaultEnabled,
    ],
  );
  if (!res.rowCount) return null;
  return mapRow(res.rows[0]);
}

export async function updateOrganizationSsoSettings(
  id: string,
  input: {
    m365_tenant_id?: string | null;
    sso_enabled?: boolean;
    sso_approval_mode?: SsoApprovalMode | null;
  },
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const nextSettings: Record<string, unknown> = { ...(existing.settings || {}) };
  if (input.sso_approval_mode) {
    nextSettings.sso_approval_mode = input.sso_approval_mode;
  } else if (
    input.sso_enabled === true &&
    nextSettings.sso_approval_mode == null &&
    nextSettings.ssoApprovalMode == null
  ) {
    // Idempotent default when enabling SSO for the first time.
    nextSettings.sso_approval_mode = 'admin_approval';
  }
  return updateOrganization(id, {
    m365_tenant_id: input.m365_tenant_id,
    sso_enabled: input.sso_enabled,
    settings: nextSettings,
  });
}

/** Persist 2nd-Level-Support notification settings into organizations.settings. */
export async function updateOrganizationSecondLevelSettings(
  id: string,
  input: {
    second_level_notify_enabled?: boolean;
    second_level_support_emails?: string | string[] | null;
    second_level_label?: string | null;
  },
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const { normalizeSecondLevelNotifySettings } = await import('./second-level-notify.js');
  const current = normalizeSecondLevelNotifySettings(existing.settings || {});
  const next = normalizeSecondLevelNotifySettings({
    ...current,
    ...(input.second_level_notify_enabled !== undefined
      ? { second_level_notify_enabled: input.second_level_notify_enabled }
      : {}),
    ...(input.second_level_support_emails !== undefined
      ? { second_level_support_emails: input.second_level_support_emails }
      : {}),
    ...(input.second_level_label !== undefined
      ? { second_level_label: input.second_level_label }
      : {}),
  });
  const nextSettings: Record<string, unknown> = {
    ...(existing.settings || {}),
    second_level_notify_enabled: next.second_level_notify_enabled,
    second_level_support_emails: next.second_level_support_emails,
    second_level_label: next.second_level_label,
  };
  return updateOrganization(id, { settings: nextSettings });
}

export async function updateOrganizationBranding(
  id: string,
  input: {
    logo_url?: string | null;
    portal_title?: string | null;
    portal_banner_url?: string | null;
    favicon_url?: string | null;
    portal_theme?: Partial<PortalThemeSettings>;
  },
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const nextSettings =
    input.portal_theme !== undefined
      ? mergePortalThemeIntoSettings(existing.settings, input.portal_theme)
      : undefined;
  return updateOrganization(id, {
    logo_url: input.logo_url,
    portal_title: input.portal_title,
    portal_banner_url: input.portal_banner_url,
    favicon_url: input.favicon_url,
    ...(nextSettings ? { settings: nextSettings } : {}),
  });
}

export async function updateOrganizationHardwareModule(
  id: string,
  input: {
    hardware_returns_enabled?: boolean;
    hardware_returns_config?: Partial<HardwareReturnsConfig> | null;
  },
): Promise<OrganizationRecord | null> {
  return updateOrganization(id, {
    hardware_returns_enabled: input.hardware_returns_enabled,
    hardware_returns_config: input.hardware_returns_config ?? undefined,
  });
}

export async function updateOrganizationPortalModules(
  id: string,
  input: {
    secure_exchange_enabled?: boolean;
    vault_enabled?: boolean;
  },
): Promise<OrganizationRecord | null> {
  return updateOrganization(id, {
    secure_exchange_enabled: input.secure_exchange_enabled,
    vault_enabled: input.vault_enabled,
  });
}

/** Persist Mandanten-KI & RAG local AI settings into organizations.settings. */
export async function updateOrganizationAiSettings(
  id: string,
  input: import('../ai/org-ai-settings.js').OrgAiSettingsUpdateInput,
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const {
    applyOrgAiSettingsUpdate,
    normalizeOrgAiSettings,
    orgAiSettingsToSettingsPatch,
  } = await import('../ai/org-ai-settings.js');
  const current = normalizeOrgAiSettings(existing);
  const next = applyOrgAiSettingsUpdate(current, input);
  const nextSettings: Record<string, unknown> = {
    ...(existing.settings || {}),
    ...orgAiSettingsToSettingsPatch(next),
  };
  return updateOrganization(id, { settings: nextSettings });
}

/** After a successful org RAG reindex, stamp last_embedding_model. */
export async function stampOrganizationEmbeddingModel(
  id: string,
): Promise<OrganizationRecord | null> {
  const existing = await getOrganization(id);
  if (!existing) return null;
  const {
    markEmbeddingModelSaved,
    normalizeOrgAiSettings,
    orgAiSettingsToSettingsPatch,
  } = await import('../ai/org-ai-settings.js');
  const stamped = markEmbeddingModelSaved(normalizeOrgAiSettings(existing));
  return updateOrganization(id, {
    settings: {
      ...(existing.settings || {}),
      ...orgAiSettingsToSettingsPatch(stamped),
    },
  });
}

/** Public module flags exposed on /api/portal/me and /api/organizations/:id. */
export function organizationEnabledModules(org: OrganizationRecord | null | undefined): {
  hardwareReturns: boolean;
  secureExchange: boolean;
  vault: boolean;
} {
  return {
    hardwareReturns: Boolean(org?.hardware_returns_enabled),
    // Default ON when org missing (keeps existing always-on behaviour).
    secureExchange: org == null ? true : org.secure_exchange_enabled !== false,
    vault: org == null ? true : org.vault_enabled !== false,
  };
}
