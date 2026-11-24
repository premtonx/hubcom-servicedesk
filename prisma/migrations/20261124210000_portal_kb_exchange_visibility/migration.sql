-- Portal KB + Secure Exchange multi-tenant visibility contract.
-- Articles and vault items live in geistdesk_documents (JSONB); these indexes
-- accelerate portal list filters. Existing Private/unset articles remain
-- Hubcom-internal; Public is treated as shared_portal by application code.

CREATE INDEX IF NOT EXISTS idx_kb_articles_visibility
  ON geistdesk_documents ((data->>'visibility'))
  WHERE collection = 'kb_articles';

CREATE INDEX IF NOT EXISTS idx_kb_articles_organization
  ON geistdesk_documents ((COALESCE(data->>'organizationId', data->>'organization_id')))
  WHERE collection = 'kb_articles';

CREATE INDEX IF NOT EXISTS idx_vault_items_organization
  ON geistdesk_documents ((COALESCE(data->>'organizationId', data->>'organization_id', data->'metadata'->>'organizationId')))
  WHERE collection = 'vault_items';
