-- Durable company Tresor (AES-256-GCM). Shared by Admin-Hub Kunden → Vault
-- and Kunden-Portal /portal/vault. client_visible defaults FALSE so Hubcom
-- staff secrets never accidentally leak into the client portal.

CREATE TABLE IF NOT EXISTS organization_vault_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id TEXT NOT NULL,
  updated_by_user_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'password',
  notes TEXT,
  encrypted_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_vault_org_visible
  ON organization_vault_secrets (organization_id, client_visible);

CREATE INDEX IF NOT EXISTS idx_org_vault_org_created
  ON organization_vault_secrets (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS organization_vault_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_id UUID,
  organization_id UUID,
  actor_user_id TEXT NOT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_org_vault_audit_secret
  ON organization_vault_audit_log (secret_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_org_vault_audit_org
  ON organization_vault_audit_log (organization_id, created_at DESC);
