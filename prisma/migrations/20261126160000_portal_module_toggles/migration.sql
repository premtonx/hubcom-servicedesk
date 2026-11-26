-- Per-organization Portal module toggles for Sicherer Austausch & Tresor.
-- Default ON for all orgs (preserves always-on behaviour). DPG is opted out below.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS secure_exchange_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS vault_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Idempotent: disable both modules for DPG only (slug or name match).
UPDATE organizations
   SET secure_exchange_enabled = FALSE,
       vault_enabled = FALSE,
       updated_at = NOW()
 WHERE LOWER(TRIM(slug)) = 'dpg'
    OR LOWER(TRIM(name)) = 'dpg';
