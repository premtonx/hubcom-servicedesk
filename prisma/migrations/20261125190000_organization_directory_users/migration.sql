-- Org-scoped M365/Entra employee directory (autocomplete only — not portal login users).
-- Idempotent.

CREATE TABLE IF NOT EXISTS organization_directory_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entra_object_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  user_principal_name TEXT,
  phone_office TEXT,
  phone_mobile TEXT,
  manager_name TEXT,
  manager_email TEXT,
  department TEXT,
  job_title TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_org_directory_entra UNIQUE (organization_id, entra_object_id)
);

CREATE INDEX IF NOT EXISTS idx_org_directory_org_display_name
  ON organization_directory_users (organization_id, lower(display_name));

CREATE INDEX IF NOT EXISTS idx_org_directory_org_email
  ON organization_directory_users (organization_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_org_directory_org_active
  ON organization_directory_users (organization_id, is_active)
  WHERE is_active = TRUE;
