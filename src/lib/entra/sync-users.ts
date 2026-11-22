/**
 * Microsoft Graph → users Collection Sync.
 */

import { acquireGraphToken } from '../kb/ms-graph.js';
import {
  addDocDirect,
  getDocsDirect,
  updateDocDirect,
} from '../postgres-backend.js';
import type { EntraSettings } from './config-store.js';
import { deriveKuerzel, normalizeRole } from './user-helpers.js';

interface GraphUser {
  id?: string;
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
  accountEnabled?: boolean;
  givenName?: string;
  surname?: string;
}

export interface SyncM365Result {
  imported: number;
  updated: number;
  skipped: number;
  totalFetched: number;
  errors: string[];
}

async function fetchGraphUsers(token: string): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let nextUrl: string | null =
    'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName,accountEnabled,givenName,surname&$top=100';

  while (nextUrl && users.length < 5000) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Graph-Benutzerabruf fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { value?: GraphUser[]; '@odata.nextLink'?: string };
    for (const u of data.value || []) {
      if (u.accountEnabled === false) continue;
      users.push(u);
    }
    nextUrl = data['@odata.nextLink'] || null;
  }
  return users;
}

export async function syncM365Users(settings: EntraSettings): Promise<SyncM365Result> {
  if (!settings.clientId || !settings.tenantId || !settings.clientSecret) {
    throw new Error('Microsoft 365 ist nicht vollständig konfiguriert (Tenant, Client ID, Secret).');
  }

  const token = await acquireGraphToken({
    clientId: settings.clientId,
    azureTenantId: settings.tenantId,
    clientSecret: settings.clientSecret,
  });

  const graphUsers = await fetchGraphUsers(token);
  const existing = await getDocsDirect('users', []);
  const byEmail = new Map<string, any>();
  const byOid = new Map<string, any>();
  for (const u of existing) {
    if (u.email) byEmail.set(String(u.email).toLowerCase(), u);
    if (u.entraObjectId) byOid.set(String(u.entraObjectId), u);
    if (u.upn) byEmail.set(String(u.upn).toLowerCase(), u);
  }

  const result: SyncM365Result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    totalFetched: graphUsers.length,
    errors: [],
  };

  const now = new Date().toISOString();
  const defaultRole = normalizeRole(settings.defaultRole);

  for (const gu of graphUsers) {
    try {
      const email = String(gu.mail || gu.userPrincipalName || '')
        .trim()
        .toLowerCase();
      const upn = String(gu.userPrincipalName || email).trim().toLowerCase();
      const oid = String(gu.id || '').trim();
      if (!email || !email.includes('@') || !oid) {
        result.skipped += 1;
        continue;
      }

      if (settings.allowedDomains.length > 0) {
        const domain = email.split('@')[1];
        if (!settings.allowedDomains.includes(domain)) {
          result.skipped += 1;
          continue;
        }
      }

      const name =
        String(gu.displayName || '').trim() ||
        [gu.givenName, gu.surname].filter(Boolean).join(' ').trim() ||
        email.split('@')[0];

      const found = byOid.get(oid) || byEmail.get(email) || byEmail.get(upn);
      if (found) {
        // Bestehende Rollen und Kürzel nicht überschreiben
        await updateDocDirect('users', found.id, {
          name: found.name || name,
          email: found.email || email,
          upn,
          entraObjectId: oid,
          authMethod: 'microsoft365',
          isDeactivated: gu.accountEnabled === false ? true : found.isDeactivated === true,
          updatedAt: now,
        });
        result.updated += 1;
      } else {
        await addDocDirect('users', {
          name,
          email,
          upn,
          entraObjectId: oid,
          authMethod: 'microsoft365',
          passwordHash: null,
          kuerzel: deriveKuerzel(name),
          role: defaultRole,
          is_admin: defaultRole === 'SYSTEM_ADMIN',
          company: '',
          isDeactivated: gu.accountEnabled === false,
          can_create_tickets: true,
          can_view_knowledgebase: true,
          createdAt: now,
          updatedAt: now,
        });
        result.imported += 1;
      }
    } catch (err: any) {
      result.errors.push(err?.message || String(err));
    }
  }

  return result;
}
