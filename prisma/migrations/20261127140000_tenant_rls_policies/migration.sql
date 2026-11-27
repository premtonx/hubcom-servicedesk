-- Multi-tenant RLS (idempotent). Canonical install also runs from initDb via tenant-rls-ddl.ts.

CREATE OR REPLACE FUNCTION app_document_org_id(data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(TRIM(COALESCE(
    data->>'organizationId',
    data->>'organization_id',
    data->'metadata'->>'organizationId',
    data->'metadata'->>'organization_id',
    ''
  )), '');
$$;

CREATE OR REPLACE FUNCTION app_is_tenant_document_collection(collection text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    collection IN (
      'tickets', 'kb_articles', 'kb_categories', 'kb_documents',
      'email_channels', 'vault_items'
    )
    OR collection ~ '^tickets/[^/]+/messages$';
$$;

CREATE OR REPLACE FUNCTION app_rls_document_allowed(collection text, data jsonb)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE COALESCE(current_setting('app.rls_mode', true), '')
    WHEN 'super_admin' THEN TRUE
    WHEN 'system' THEN TRUE
    WHEN 'portal' THEN
      CASE
        WHEN NOT app_is_tenant_document_collection(collection) THEN TRUE
        ELSE app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
      END
    WHEN 'staff_scoped' THEN
      CASE
        WHEN NOT app_is_tenant_document_collection(collection) THEN TRUE
        WHEN app_document_org_id(data) IS NULL THEN TRUE
        ELSE app_document_org_id(data) = ANY (
          string_to_array(NULLIF(current_setting('app.allowed_org_ids', true), ''), ',')
        )
      END
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION app_rls_org_column_allowed(org_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE COALESCE(current_setting('app.rls_mode', true), '')
    WHEN 'super_admin' THEN TRUE
    WHEN 'system' THEN TRUE
    WHEN 'portal' THEN
      org_id IS NOT NULL AND org_id = NULLIF(current_setting('app.current_org_id', true), '')
    WHEN 'staff_scoped' THEN
      org_id IS NULL
      OR org_id = ANY (
        string_to_array(NULLIF(current_setting('app.allowed_org_ids', true), ''), ',')
      )
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE VIEW tickets AS
  SELECT id, app_document_org_id(data) AS organization_id, data, created_at, updated_at
  FROM geistdesk_documents WHERE collection = 'tickets';

CREATE OR REPLACE VIEW kb_articles AS
  SELECT id, app_document_org_id(data) AS organization_id, data, created_at, updated_at
  FROM geistdesk_documents WHERE collection = 'kb_articles';

ALTER TABLE geistdesk_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_hardware_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'KnowledgeEmbedding') THEN
    EXECUTE 'ALTER TABLE "KnowledgeEmbedding" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DROP POLICY IF EXISTS geistdesk_documents_tenant_isolation ON geistdesk_documents;
CREATE POLICY geistdesk_documents_tenant_isolation ON geistdesk_documents
  FOR ALL USING (app_rls_document_allowed(collection, data))
  WITH CHECK (app_rls_document_allowed(collection, data));

DROP POLICY IF EXISTS ticket_hardware_returns_tenant_isolation ON ticket_hardware_returns;
CREATE POLICY ticket_hardware_returns_tenant_isolation ON ticket_hardware_returns
  FOR ALL USING (app_rls_org_column_allowed(organization_id::text))
  WITH CHECK (app_rls_org_column_allowed(organization_id::text));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hubcom_app') THEN
    CREATE ROLE hubcom_app NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE hubcom_app NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO hubcom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hubcom_app;
DO $$ BEGIN
  EXECUTE format('GRANT hubcom_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
