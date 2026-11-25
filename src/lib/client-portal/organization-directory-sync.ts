/**
 * Org-scoped M365 / Entra employee directory sync + autocomplete search.
 * Never writes into portal login `users` — only `organization_directory_users`.
 */

import axios from 'axios';
import { randomUUID } from 'crypto';
import { decryptEmailChannelSecret } from '../email-ingestion/channel-secret-crypto.js';
import { findOrganizationEmailChannel } from '../email-ingestion/channel-store.js';
import { getDocsDirect, queryDb, withPgTransaction } from '../postgres-backend.js';
import {
  normalizeHardwareReturnsConfig,
  type HardwareReturnsConfig,
  type M365DirectorySyncConfig,
} from './hardware-returns.js';
import { getOrganization, updateOrganizationHardwareModule } from './organizations.js';
import { isClientPortalRole } from './roles.js';

export interface GraphDirectoryUserRaw {
  id?: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  businessPhones?: string[] | null;
  mobilePhone?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  accountEnabled?: boolean | null;
  manager?: {
    displayName?: string | null;
    mail?: string | null;
    userPrincipalName?: string | null;
  } | null;
  '@odata.type'?: string;
}

export interface DirectoryUserRow {
  id: string;
  organization_id: string;
  entra_object_id: string;
  display_name: string;
  email: string | null;
  user_principal_name: string | null;
  phone_office: string | null;
  phone_mobile: string | null;
  manager_name: string | null;
  manager_email: string | null;
  department: string | null;
  job_title: string | null;
  is_active: boolean;
  last_synced_at: string;
  source: 'm365' | 'portal';
}

export interface DirectoryUserSearchResult {
  id: string;
  displayName: string;
  email: string | null;
  phoneOffice: string | null;
  phoneMobile: string | null;
  managerName: string | null;
  managerEmail: string | null;
  department: string | null;
  source: 'm365' | 'portal';
}

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export type GraphFetchPage = (url: string, token: string) => Promise<{
  value: GraphDirectoryUserRaw[];
  nextLink: string | null;
}>;

export type GraphTokenAcquirer = (creds: GraphCredentials) => Promise<string>;

function nullStr(raw: unknown, max: number): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function nullEmail(raw: unknown): string | null {
  const s = nullStr(raw, 320);
  if (!s || !s.includes('@')) return null;
  return s.toLowerCase();
}

export function mapGraphUserToDirectoryFields(user: GraphDirectoryUserRaw): {
  entra_object_id: string;
  display_name: string;
  email: string | null;
  user_principal_name: string | null;
  phone_office: string | null;
  phone_mobile: string | null;
  manager_name: string | null;
  manager_email: string | null;
  department: string | null;
  job_title: string | null;
  is_active: boolean;
} | null {
  const entraId = String(user.id || '').trim();
  const displayName = String(user.displayName || '').trim();
  if (!entraId || !displayName) return null;
  const upn = nullStr(user.userPrincipalName, 320);
  const email = nullEmail(user.mail) || nullEmail(upn);
  const phones = Array.isArray(user.businessPhones) ? user.businessPhones : [];
  const manager = user.manager && typeof user.manager === 'object' ? user.manager : null;
  return {
    entra_object_id: entraId.slice(0, 80),
    display_name: displayName.slice(0, 255),
    email,
    user_principal_name: upn,
    phone_office: nullStr(phones[0], 80),
    phone_mobile: nullStr(user.mobilePhone, 80),
    manager_name: nullStr(manager?.displayName, 200),
    manager_email: nullEmail(manager?.mail) || nullEmail(manager?.userPrincipalName),
    department: nullStr(user.department, 200),
    job_title: nullStr(user.jobTitle, 200),
    is_active: user.accountEnabled !== false,
  };
}

/** Pure prefix-first ranking for autocomplete (starts-with before contains). */
export function rankDirectorySearchResults(
  query: string,
  rows: DirectoryUserSearchResult[],
): DirectoryUserSearchResult[] {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!q) {
    return [...rows].sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'));
  }
  const scored = rows.map((row) => {
    const name = String(row.displayName || '').toLowerCase();
    const email = String(row.email || '').toLowerCase();
    const nameStarts = name.startsWith(q);
    const emailStarts = email.startsWith(q);
    const nameContains = name.includes(q);
    const emailContains = email.includes(q);
    let score = 100;
    if (nameStarts) score = 0;
    else if (emailStarts) score = 1;
    else if (nameContains) score = 2;
    else if (emailContains) score = 3;
    else score = 99;
    return { row, score, name };
  });
  return scored
    .filter((s) => s.score < 99)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'de'))
    .map((s) => s.row);
}

export function buildDirectoryUsersGraphUrl(params: {
  entraGroupId?: string | null;
  includeManagerExpand?: boolean;
  top?: number;
}): string {
  const top = Math.min(200, Math.max(1, params.top ?? 200));
  const select =
    'id,displayName,mail,userPrincipalName,businessPhones,mobilePhone,department,jobTitle,accountEnabled';
  const expand = params.includeManagerExpand === false ? '' : `&$expand=manager($select=displayName,mail)`;
  const groupId = String(params.entraGroupId || '').trim();
  if (groupId) {
    return (
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}` +
      `/transitiveMembers/microsoft.graph.user?$select=${select}${expand}&$top=${top}`
    );
  }
  const filter = encodeURIComponent("accountEnabled eq true and userType eq 'Member'");
  return (
    `https://graph.microsoft.com/v1.0/users?$filter=${filter}` +
    `&$select=${select}${expand}&$top=${top}`
  );
}

export async function acquireDirectoryGraphToken(creds: GraphCredentials): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await axios.post(tokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20_000,
  });
  const token = res.data?.access_token;
  if (!token) throw new Error('Graph-Token fehlt (access_token).');
  return String(token);
}

async function defaultFetchGraphPage(
  url: string,
  token: string,
): Promise<{ value: GraphDirectoryUserRaw[]; nextLink: string | null }> {
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 60_000,
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    const code = res.data?.error?.code || res.status;
    const msg = res.data?.error?.message || res.statusText || 'Graph-Anfrage fehlgeschlagen';
    const err = Object.assign(new Error(String(msg)), {
      status: res.status,
      graphCode: code,
      graphBody: res.data,
    });
    throw err;
  }
  const value = Array.isArray(res.data?.value) ? (res.data.value as GraphDirectoryUserRaw[]) : [];
  const nextLink =
    typeof res.data?.['@odata.nextLink'] === 'string' ? String(res.data['@odata.nextLink']) : null;
  return { value, nextLink };
}

export async function resolveDirectoryGraphCredentials(
  organizationId: string,
  syncCfg: M365DirectorySyncConfig,
): Promise<GraphCredentials> {
  const overrideTenant = String(syncCfg.tenant_id || '').trim();
  const overrideClient = String(syncCfg.client_id || '').trim();
  let overrideSecret = '';
  if (syncCfg.client_secret) {
    try {
      overrideSecret = decryptEmailChannelSecret(syncCfg.client_secret).trim();
    } catch {
      overrideSecret = '';
    }
  }

  if (overrideTenant && overrideClient && overrideSecret && overrideSecret !== '••••••••') {
    return {
      tenantId: overrideTenant,
      clientId: overrideClient,
      clientSecret: overrideSecret,
    };
  }

  const channel = await findOrganizationEmailChannel(organizationId, {
    includeSecrets: true,
  });
  const tenantId = overrideTenant || String(channel?.tenantId || '').trim();
  const clientId = overrideClient || String(channel?.clientId || '').trim();
  const clientSecret =
    (overrideSecret && overrideSecret !== '••••••••'
      ? overrideSecret
      : String(channel?.clientSecret || '').trim()) || '';

  if (!tenantId || !clientId || !clientSecret) {
    throw Object.assign(
      new Error(
        'M365-Verbindung fehlt. Bitte Tenant-ID, Client-ID und Client-Secret unter „M365 Tenant & Send-As“ hinterlegen (oder als Sync-Override).',
      ),
      { status: 400 },
    );
  }
  return { tenantId, clientId, clientSecret };
}

function germanGraphPermissionHint(err: any): string {
  const msg = String(err?.message || err || '');
  const code = String(err?.graphCode || '');
  const body = JSON.stringify(err?.graphBody || '');
  const combined = `${msg} ${code} ${body}`.toLowerCase();
  if (
    combined.includes('authorization_requestdenied') ||
    combined.includes('insufficient privileges') ||
    combined.includes('access denied') ||
    combined.includes('forbidden') ||
    err?.status === 403
  ) {
    return (
      'Microsoft Graph-Berechtigung fehlt. Bitte Application Permissions ' +
      '„User.Read.All“ und (bei Gruppenfilter) „GroupMember.Read.All“ erteilen und Admin Consent erteilen.'
    );
  }
  if (combined.includes('reques_resource_not_found') || combined.includes('request_resource_not_found')) {
    return 'Entra-Gruppe nicht gefunden. Bitte die Gruppen-Objekt-ID prüfen.';
  }
  return msg.slice(0, 500) || 'Verzeichnissynchronisation fehlgeschlagen.';
}

/**
 * Fetch all directory users from Graph (paginated). Retries without $expand=manager
 * when the tenant rejects the expand.
 */
export async function fetchAllDirectoryUsersFromGraph(params: {
  creds: GraphCredentials;
  entraGroupId?: string | null;
  acquireToken?: GraphTokenAcquirer;
  fetchPage?: GraphFetchPage;
}): Promise<GraphDirectoryUserRaw[]> {
  const acquire = params.acquireToken || acquireDirectoryGraphToken;
  const fetchPage = params.fetchPage || defaultFetchGraphPage;
  const token = await acquire(params.creds);

  const collect = async (includeManagerExpand: boolean): Promise<GraphDirectoryUserRaw[]> => {
    let url = buildDirectoryUsersGraphUrl({
      entraGroupId: params.entraGroupId,
      includeManagerExpand,
    });
    const out: GraphDirectoryUserRaw[] = [];
    const seen = new Set<string>();
    while (url) {
      const page = await fetchPage(url, token);
      for (const row of page.value) {
        const id = String(row.id || '');
        if (!id || seen.has(id)) continue;
        // Group transitiveMembers can still include non-user payloads in some tenants.
        if (row['@odata.type'] && !/user/i.test(String(row['@odata.type']))) continue;
        seen.add(id);
        out.push(row);
      }
      url = page.nextLink || '';
    }
    return out;
  };

  try {
    return await collect(true);
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    const body = JSON.stringify(err?.graphBody || '').toLowerCase();
    const expandFailed =
      msg.includes('expand') ||
      msg.includes('manager') ||
      body.includes('expand') ||
      body.includes('manager') ||
      err?.status === 400;
    if (!expandFailed) throw err;
    return collect(false);
  }
}

export async function upsertDirectoryUsers(
  organizationId: string,
  users: ReturnType<typeof mapGraphUserToDirectoryFields>[],
): Promise<number> {
  const now = new Date().toISOString();
  const activeIds: string[] = [];
  let count = 0;

  await withPgTransaction(async (client) => {
    for (const mapped of users) {
      if (!mapped) continue;
      if (!mapped.is_active) continue;
      activeIds.push(mapped.entra_object_id);
      await client.query(
        `INSERT INTO organization_directory_users (
           id, organization_id, entra_object_id, display_name, email, user_principal_name,
           phone_office, phone_mobile, manager_name, manager_email, department, job_title,
           is_active, last_synced_at, created_at, updated_at
         ) VALUES (
           $1::uuid, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12,
           TRUE, $13::timestamptz, NOW(), NOW()
         )
         ON CONFLICT (organization_id, entra_object_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           user_principal_name = EXCLUDED.user_principal_name,
           phone_office = EXCLUDED.phone_office,
           phone_mobile = EXCLUDED.phone_mobile,
           manager_name = EXCLUDED.manager_name,
           manager_email = EXCLUDED.manager_email,
           department = EXCLUDED.department,
           job_title = EXCLUDED.job_title,
           is_active = TRUE,
           last_synced_at = EXCLUDED.last_synced_at,
           updated_at = NOW()`,
        [
          randomUUID(),
          organizationId,
          mapped.entra_object_id,
          mapped.display_name,
          mapped.email,
          mapped.user_principal_name,
          mapped.phone_office,
          mapped.phone_mobile,
          mapped.manager_name,
          mapped.manager_email,
          mapped.department,
          mapped.job_title,
          now,
        ],
      );
      count += 1;
    }

    if (activeIds.length) {
      await client.query(
        `UPDATE organization_directory_users
         SET is_active = FALSE, updated_at = NOW()
         WHERE organization_id = $1
           AND is_active = TRUE
           AND NOT (entra_object_id = ANY($2::text[]))`,
        [organizationId, activeIds],
      );
    } else {
      await client.query(
        `UPDATE organization_directory_users
         SET is_active = FALSE, updated_at = NOW()
         WHERE organization_id = $1 AND is_active = TRUE`,
        [organizationId],
      );
    }
  });

  return count;
}

export async function syncOrganizationDirectoryFromGraph(
  organizationId: string,
  opts?: {
    acquireToken?: GraphTokenAcquirer;
    fetchPage?: GraphFetchPage;
  },
): Promise<{ syncedCount: number; lastSyncedAt: string }> {
  const org = await getOrganization(organizationId);
  if (!org) {
    throw Object.assign(new Error('Organisation nicht gefunden.'), { status: 404 });
  }
  if (!org.hardware_returns_enabled) {
    throw Object.assign(new Error('Hardware-Rücklieferungen nicht aktiv.'), { status: 403 });
  }

  const config = normalizeHardwareReturnsConfig(org.hardware_returns_config);
  const syncCfg = config.m365_directory_sync;
  const nowIso = new Date().toISOString();

  try {
    const creds = await resolveDirectoryGraphCredentials(organizationId, syncCfg);
    const rawUsers = await fetchAllDirectoryUsersFromGraph({
      creds,
      entraGroupId: syncCfg.entra_group_id,
      acquireToken: opts?.acquireToken,
      fetchPage: opts?.fetchPage,
    });
    const mapped = rawUsers.map(mapGraphUserToDirectoryFields);
    const syncedCount = await upsertDirectoryUsers(organizationId, mapped);

    const nextSync: M365DirectorySyncConfig = {
      ...syncCfg,
      last_synced_at: nowIso,
      last_sync_count: syncedCount,
      last_sync_error: null,
    };
    await updateOrganizationHardwareModule(organizationId, {
      hardware_returns_config: {
        ...config,
        m365_directory_sync: nextSync,
      },
    });

    return { syncedCount, lastSyncedAt: nowIso };
  } catch (err: any) {
    const hint = germanGraphPermissionHint(err);
    const nextSync: M365DirectorySyncConfig = {
      ...syncCfg,
      last_sync_error: hint,
    };
    try {
      await updateOrganizationHardwareModule(organizationId, {
        hardware_returns_config: {
          ...config,
          m365_directory_sync: nextSync,
        },
      });
    } catch {
      // ignore secondary write failure
    }
    throw Object.assign(new Error(hint), {
      status: err?.status && err.status >= 400 && err.status < 600 ? err.status : 502,
    });
  }
}

function toSearchResult(row: {
  id: string;
  display_name: string;
  email: string | null;
  phone_office: string | null;
  phone_mobile: string | null;
  manager_name: string | null;
  manager_email: string | null;
  department: string | null;
  source: 'm365' | 'portal';
}): DirectoryUserSearchResult {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phoneOffice: row.phone_office,
    phoneMobile: row.phone_mobile,
    managerName: row.manager_name,
    managerEmail: row.manager_email,
    department: row.department,
    source: row.source,
  };
}

/** Strict org-scoped autocomplete: M365 directory + portal users (deduped by email). */
export async function searchOrganizationDirectoryUsers(params: {
  organizationId: string;
  query?: string;
  limit?: number;
}): Promise<DirectoryUserSearchResult[]> {
  const organizationId = String(params.organizationId || '').trim();
  if (!organizationId) return [];
  const q = String(params.query || '').trim();
  const limit = Math.min(50, Math.max(1, Math.floor(params.limit ?? 15)));

  const dirRes = await queryDb(
    `SELECT id, display_name, email, phone_office, phone_mobile,
            manager_name, manager_email, department
     FROM organization_directory_users
     WHERE organization_id = $1
       AND is_active = TRUE
       AND (
         $2::text = ''
         OR display_name ILIKE ('%' || $2 || '%')
         OR COALESCE(email, '') ILIKE ('%' || $2 || '%')
         OR COALESCE(user_principal_name, '') ILIKE ('%' || $2 || '%')
       )
     LIMIT 200`,
    [organizationId, q],
  );

  const fromDir: DirectoryUserSearchResult[] = dirRes.rows.map((r) =>
    toSearchResult({
      id: String(r.id),
      display_name: String(r.display_name || ''),
      email: r.email ? String(r.email) : null,
      phone_office: r.phone_office ? String(r.phone_office) : null,
      phone_mobile: r.phone_mobile ? String(r.phone_mobile) : null,
      manager_name: r.manager_name ? String(r.manager_name) : null,
      manager_email: r.manager_email ? String(r.manager_email) : null,
      department: r.department ? String(r.department) : null,
      source: 'm365',
    }),
  );

  const portalUsers = await getDocsDirect('users', []);
  const fromPortal: DirectoryUserSearchResult[] = [];
  for (const u of portalUsers) {
    const orgId =
      (typeof u.organizationId === 'string' && u.organizationId.trim()) ||
      (typeof u.organization_id === 'string' && u.organization_id.trim()) ||
      '';
    if (orgId !== organizationId) continue;
    if (u.isDeactivated === true) continue;
    const role = String(u.role || '');
    if (!isClientPortalRole(role) && role !== 'CLIENT_ADMIN' && role !== 'CLIENT_SUPPORTER' && role !== 'CLIENT_USER') {
      // Still allow any org-scoped portal login user for autocomplete.
      if (!orgId) continue;
    }
    const displayName = String(u.name || u.email || '').trim();
    const email = nullEmail(u.email);
    if (!displayName) continue;
    if (q) {
      const hay = `${displayName} ${email || ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) continue;
    }
    fromPortal.push(
      toSearchResult({
        id: String(u.id),
        display_name: displayName,
        email,
        phone_office: nullStr(u.phone_office ?? u.phoneOffice ?? u.phone, 80),
        phone_mobile: nullStr(u.phone_mobile ?? u.phoneMobile ?? u.mobile, 80),
        manager_name: nullStr(u.manager_name ?? u.managerName, 200),
        manager_email: nullEmail(u.manager_email ?? u.managerEmail),
        department: nullStr(u.department, 200),
        source: 'portal',
      }),
    );
  }

  const seenEmails = new Set<string>();
  const merged: DirectoryUserSearchResult[] = [];
  for (const row of [...fromDir, ...fromPortal]) {
    const key = String(row.email || '').toLowerCase();
    if (key && seenEmails.has(key)) continue;
    if (key) seenEmails.add(key);
    merged.push(row);
  }

  return rankDirectorySearchResults(q, merged).slice(0, limit);
}

/** Cross-tenant guard used by tests and route wrappers. */
export function evaluateDirectorySearchAccess(params: {
  sessionOrgId: string | null;
  targetOrgId: string | null;
  role: string;
  orgEnabled: boolean;
}): { ok: true } | { ok: false; status: 403 | 404 } {
  if (!params.orgEnabled) return { ok: false, status: 404 };
  if (!params.targetOrgId) return { ok: false, status: 403 };
  if (params.role === 'SYSTEM_ADMIN' || params.role === 'AGENT' || params.role === 'agent') {
    return { ok: true };
  }
  if (params.role === 'CLIENT_USER') return { ok: false, status: 403 };
  if (!params.sessionOrgId || params.sessionOrgId !== params.targetOrgId) {
    return { ok: false, status: 403 };
  }
  if (params.role !== 'CLIENT_ADMIN' && params.role !== 'CLIENT_SUPPORTER') {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}

export async function listOrgsNeedingDirectorySync(): Promise<string[]> {
  const res = await queryDb(
    `SELECT id, hardware_returns_config
     FROM organizations
     WHERE is_active = TRUE
       AND hardware_returns_enabled = TRUE`,
  );
  const out: string[] = [];
  for (const row of res.rows) {
    const cfg = normalizeHardwareReturnsConfig(row.hardware_returns_config) as HardwareReturnsConfig;
    if (!cfg.m365_directory_sync?.enabled) continue;
    out.push(String(row.id));
  }
  return out;
}
