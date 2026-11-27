-- Hubcom staff ↔ client organization permission matrix
CREATE TABLE IF NOT EXISTS user_organization_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  access_role TEXT NOT NULL CHECK (access_role IN ('ORG_ADMIN', 'ORG_AGENT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,
  CONSTRAINT uq_user_organization_access UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_user_org_access_user
  ON user_organization_access (user_id);
CREATE INDEX IF NOT EXISTS idx_user_org_access_org
  ON user_organization_access (organization_id);
