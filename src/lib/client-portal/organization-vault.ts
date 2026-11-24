/**
 * Durable company Tresor (organization_vault_secrets) — AES-256-GCM at rest.
 * Shared source of truth for Admin-Hub Kunden → Vault and /portal/vault.
 */

import { randomUUID } from 'crypto';
import { queryDb } from '../postgres-backend.js';
import {
  assertVaultEncryptionConfigured,
  decryptPayloadAuto,
  encryptExchangeAtRest,
} from '../crypto.js';
import type { AnyEncryptedPayload } from '../crypto-payload.js';

export const ORG_VAULT_CATEGORIES = [
  'password',
  'api_key',
  'certificate',
  'license',
  'note',
] as const;

export type OrgVaultCategory = (typeof ORG_VAULT_CATEGORIES)[number];

export type OrgVaultAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'reveal'
  | 'copy'
  | 'toggle_client_visible';

export interface OrganizationVaultSecretRecord {
  id: string;
  organization_id: string | null;
  client_visible: boolean;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  name: string;
  category: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationVaultSecretView extends OrganizationVaultSecretRecord {
  /** Always masked in list/metadata responses. */
  masked_value: string;
}

function mapRow(row: any): OrganizationVaultSecretRecord {
  return {
    id: String(row.id),
    organization_id: row.organization_id == null ? null : String(row.organization_id),
    client_visible: Boolean(row.client_visible),
    created_by_user_id: String(row.created_by_user_id || ''),
    updated_by_user_id:
      row.updated_by_user_id == null || row.updated_by_user_id === ''
        ? null
        : String(row.updated_by_user_id),
    name: String(row.name || ''),
    category: String(row.category || 'password'),
    notes: row.notes == null || row.notes === '' ? null : String(row.notes),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

export function toOrgVaultListItem(
  record: OrganizationVaultSecretRecord,
): OrganizationVaultSecretView {
  return {
    ...record,
    masked_value: '••••••••••••',
  };
}

export function normalizeOrgVaultCategory(raw: unknown): OrgVaultCategory {
  const value = String(raw || 'password')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if ((ORG_VAULT_CATEGORIES as readonly string[]).includes(value)) {
    return value as OrgVaultCategory;
  }
  if (value === 'passwort' || value === 'secret') return 'password';
  if (value === 'api' || value === 'token' || value === 'api-schlüssel') return 'api_key';
  if (value === 'zertifikat' || value === 'ssl' || value === 'pem') return 'certificate';
  if (value === 'lizenz') return 'license';
  if (value === 'notiz') return 'note';
  return 'password';
}

export async function appendOrgVaultAudit(params: {
  secretId?: string | null;
  organizationId?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
  action: OrgVaultAuditAction;
  detail?: string | null;
}): Promise<void> {
  try {
    await queryDb(
      `INSERT INTO organization_vault_audit_log
        (id, secret_id, organization_id, actor_user_id, actor_email, action, detail, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [
        randomUUID(),
        params.secretId || null,
        params.organizationId || null,
        params.actorUserId,
        params.actorEmail || null,
        params.action,
        params.detail || null,
      ],
    );
  } catch {
    /* audit must never break the primary flow */
  }
}

export async function listOrgVaultSecrets(params: {
  organizationId: string;
  /** When true, only client_visible rows (portal). Staff can pass false to see all. */
  clientVisibleOnly?: boolean;
  category?: string | null;
  q?: string | null;
}): Promise<OrganizationVaultSecretView[]> {
  const clauses = ['organization_id = $1::uuid'];
  const values: unknown[] = [params.organizationId];
  let idx = 2;

  if (params.clientVisibleOnly) {
    clauses.push('client_visible = TRUE');
  }
  if (params.category && params.category !== 'all') {
    clauses.push(`category = $${idx}`);
    values.push(normalizeOrgVaultCategory(params.category));
    idx += 1;
  }
  if (params.q && params.q.trim()) {
    clauses.push(`(name ILIKE $${idx} OR COALESCE(notes, '') ILIKE $${idx})`);
    values.push(`%${params.q.trim()}%`);
    idx += 1;
  }

  const result = await queryDb(
    `SELECT id, organization_id, client_visible, created_by_user_id, updated_by_user_id,
            name, category, notes, created_at, updated_at
     FROM organization_vault_secrets
     WHERE ${clauses.join(' AND ')}
     ORDER BY updated_at DESC`,
    values,
  );
  return result.rows.map((row) => toOrgVaultListItem(mapRow(row)));
}

export async function getOrgVaultSecretById(
  id: string,
): Promise<(OrganizationVaultSecretRecord & { encrypted_payload: AnyEncryptedPayload }) | null> {
  const result = await queryDb(
    `SELECT id, organization_id, client_visible, created_by_user_id, updated_by_user_id,
            name, category, notes, encrypted_payload, created_at, updated_at
     FROM organization_vault_secrets
     WHERE id = $1::uuid
     LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapRow(row),
    encrypted_payload: row.encrypted_payload as AnyEncryptedPayload,
  };
}

export async function createOrgVaultSecret(params: {
  organizationId: string | null;
  clientVisible: boolean;
  createdByUserId: string;
  name: string;
  category?: string;
  notes?: string | null;
  plaintext: string;
}): Promise<OrganizationVaultSecretView> {
  assertVaultEncryptionConfigured();
  const id = randomUUID();
  const category = normalizeOrgVaultCategory(params.category);
  const payload = encryptExchangeAtRest(
    params.plaintext,
    `org-vault:${params.organizationId || 'global'}:${id}`,
  );
  const result = await queryDb(
    `INSERT INTO organization_vault_secrets
      (id, organization_id, client_visible, created_by_user_id, updated_by_user_id,
       name, category, notes, encrypted_payload, created_at, updated_at)
     VALUES ($1::uuid, $2::uuid, $3, $4, $4, $5, $6, $7, $8::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, organization_id, client_visible, created_by_user_id, updated_by_user_id,
               name, category, notes, created_at, updated_at`,
    [
      id,
      params.organizationId,
      params.clientVisible,
      params.createdByUserId,
      params.name.trim(),
      category,
      params.notes?.trim() || null,
      JSON.stringify(payload),
    ],
  );
  return toOrgVaultListItem(mapRow(result.rows[0]));
}

export async function updateOrgVaultSecret(params: {
  id: string;
  updatedByUserId: string;
  name?: string;
  category?: string;
  notes?: string | null;
  plaintext?: string;
  clientVisible?: boolean;
}): Promise<OrganizationVaultSecretView | null> {
  const existing = await getOrgVaultSecretById(params.id);
  if (!existing) return null;

  let encryptedPayload = existing.encrypted_payload;
  if (typeof params.plaintext === 'string' && params.plaintext.length > 0) {
    assertVaultEncryptionConfigured();
    encryptedPayload = encryptExchangeAtRest(
      params.plaintext,
      `org-vault:${existing.organization_id || 'global'}:${existing.id}`,
    );
  }

  const name = params.name != null ? params.name.trim() : existing.name;
  const category =
    params.category != null ? normalizeOrgVaultCategory(params.category) : existing.category;
  const notes =
    params.notes !== undefined
      ? params.notes == null || String(params.notes).trim() === ''
        ? null
        : String(params.notes).trim()
      : existing.notes;
  const clientVisible =
    typeof params.clientVisible === 'boolean' ? params.clientVisible : existing.client_visible;

  const result = await queryDb(
    `UPDATE organization_vault_secrets
     SET name = $2,
         category = $3,
         notes = $4,
         client_visible = $5,
         encrypted_payload = $6::jsonb,
         updated_by_user_id = $7,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1::uuid
     RETURNING id, organization_id, client_visible, created_by_user_id, updated_by_user_id,
               name, category, notes, created_at, updated_at`,
    [
      params.id,
      name,
      category,
      notes,
      clientVisible,
      JSON.stringify(encryptedPayload),
      params.updatedByUserId,
    ],
  );
  if (!result.rows[0]) return null;
  return toOrgVaultListItem(mapRow(result.rows[0]));
}

export async function deleteOrgVaultSecret(id: string): Promise<boolean> {
  const result = await queryDb(
    `DELETE FROM organization_vault_secrets WHERE id = $1::uuid RETURNING id`,
    [id],
  );
  return Number(result.rowCount || 0) > 0;
}

export async function revealOrgVaultSecretPlaintext(id: string): Promise<string | null> {
  const existing = await getOrgVaultSecretById(id);
  if (!existing) return null;
  assertVaultEncryptionConfigured();
  return decryptPayloadAuto(existing.encrypted_payload);
}

/** Portal access: same org + client_visible. */
export function isOrgVaultVisibleToPortal(
  record: Pick<OrganizationVaultSecretRecord, 'organization_id' | 'client_visible'> | null,
  organizationId: string,
): boolean {
  if (!record || !organizationId) return false;
  if (!record.client_visible) return false;
  return record.organization_id === organizationId;
}

export function assertPortalVaultRole(
  role: string | null | undefined,
): 'CLIENT_ADMIN' | 'CLIENT_SUPPORTER' | null {
  if (role === 'CLIENT_ADMIN' || role === 'CLIENT_SUPPORTER') return role;
  return null;
}
