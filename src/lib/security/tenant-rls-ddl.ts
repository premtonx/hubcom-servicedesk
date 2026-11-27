/**
 * Idempotent PostgreSQL RLS policies for multi-tenant defense-in-depth.
 * Tickets / KB articles live in geistdesk_documents JSONB; relational tables
 * (KnowledgeEmbedding, ticket_hardware_returns, organizations, …) use columns.
 */

export const TENANT_RLS_DDL = `
-- Helper: extract org id from document JSON
CREATE OR REPLACE FUNCTION app_document_org_id(data jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(TRIM(COALESCE(
    data->>'organizationId',
    data->>'organization_id',
    data->'metadata'->>'organizationId',
    data->'metadata'->>'organization_id',
    ''
  )), '');
$$;

-- Helper: is this a tenant-scoped document collection?
CREATE OR REPLACE FUNCTION app_is_tenant_document_collection(collection text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    collection IN (
      'tickets',
      'kb_articles',
      'kb_categories',
      'kb_documents',
      'email_channels',
      'vault_items'
    )
    OR collection ~ '^tickets/[^/]+/messages$'
$$;

-- Core RLS predicate for document org matching.
-- Policies use this for both USING (SELECT/UPDATE/DELETE) and WITH CHECK (INSERT/UPDATE).
-- system / super_admin: full access for boot, workers, pre-auth endpoints.
-- portal: organization_id must equal app.current_org_id.
-- staff_scoped: organization_id IS NULL (internal) OR in app.allowed_org_ids.
-- unset: fail closed (FALSE) — never leak all tenants.
CREATE OR REPLACE FUNCTION app_rls_document_allowed(collection text, data jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
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
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
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

-- Convenience views so SQL tests can SELECT FROM tickets / kb_articles.
-- security_invoker=true ensures RLS on the underlying table applies as the
-- querying role (hubcom_app), not as the view owner (who may BYPASSRLS).
CREATE OR REPLACE VIEW tickets
  WITH (security_invoker = true) AS
  SELECT
    id,
    app_document_org_id(data) AS organization_id,
    data,
    created_at,
    updated_at
  FROM geistdesk_documents
  WHERE collection = 'tickets';

CREATE OR REPLACE VIEW kb_articles
  WITH (security_invoker = true) AS
  SELECT
    id,
    app_document_org_id(data) AS organization_id,
    data,
    created_at,
    updated_at
  FROM geistdesk_documents
  WHERE collection = 'kb_articles';

CREATE OR REPLACE VIEW ticket_messages
  WITH (security_invoker = true) AS
  SELECT
    id,
    collection,
    app_document_org_id(data) AS organization_id,
    data,
    created_at,
    updated_at
  FROM geistdesk_documents
  WHERE collection ~ '^tickets/[^/]+/messages$';

-- ---------------------------------------------------------------------------
-- ENABLE RLS on core tables (skip missing tables idempotently)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'geistdesk_documents',
    'ticket_hardware_returns',
    'organizations',
    'organization_vault_secrets',
    'organization_vault_audit_log',
    'organization_directory_users',
    'user_organization_access'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'KnowledgeEmbedding'
  ) THEN
    EXECUTE 'ALTER TABLE "KnowledgeEmbedding" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Drop/recreate policies idempotently
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'geistdesk_documents'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS geistdesk_documents_tenant_isolation ON geistdesk_documents';
    EXECUTE $p$
      CREATE POLICY geistdesk_documents_tenant_isolation ON geistdesk_documents
        FOR ALL
        USING (app_rls_document_allowed(collection, data))
        WITH CHECK (app_rls_document_allowed(collection, data))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'ticket_hardware_returns'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS ticket_hardware_returns_tenant_isolation ON ticket_hardware_returns';
    EXECUTE $p$
      CREATE POLICY ticket_hardware_returns_tenant_isolation ON ticket_hardware_returns
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id::text))
        WITH CHECK (app_rls_org_column_allowed(organization_id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS organizations_tenant_isolation ON organizations';
    EXECUTE $p$
      CREATE POLICY organizations_tenant_isolation ON organizations
        FOR ALL
        USING (app_rls_org_column_allowed(id::text))
        WITH CHECK (app_rls_org_column_allowed(id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'organization_vault_secrets'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS organization_vault_secrets_tenant_isolation ON organization_vault_secrets';
    EXECUTE $p$
      CREATE POLICY organization_vault_secrets_tenant_isolation ON organization_vault_secrets
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id::text))
        WITH CHECK (app_rls_org_column_allowed(organization_id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'organization_vault_audit_log'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS organization_vault_audit_log_tenant_isolation ON organization_vault_audit_log';
    EXECUTE $p$
      CREATE POLICY organization_vault_audit_log_tenant_isolation ON organization_vault_audit_log
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id::text))
        WITH CHECK (app_rls_org_column_allowed(organization_id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'organization_directory_users'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS organization_directory_users_tenant_isolation ON organization_directory_users';
    EXECUTE $p$
      CREATE POLICY organization_directory_users_tenant_isolation ON organization_directory_users
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id::text))
        WITH CHECK (app_rls_org_column_allowed(organization_id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'user_organization_access'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS user_organization_access_tenant_isolation ON user_organization_access';
    EXECUTE $p$
      CREATE POLICY user_organization_access_tenant_isolation ON user_organization_access
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id::text))
        WITH CHECK (app_rls_org_column_allowed(organization_id::text))
    $p$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'KnowledgeEmbedding'
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS knowledge_embedding_tenant_isolation ON "KnowledgeEmbedding"';
    EXECUTE $p$
      CREATE POLICY knowledge_embedding_tenant_isolation ON "KnowledgeEmbedding"
        FOR ALL
        USING (app_rls_org_column_allowed(organization_id))
        WITH CHECK (app_rls_org_column_allowed(organization_id))
    $p$;
  END IF;
END $$;

-- Application role (NOBYPASSRLS). Owner still bypasses unless FORCE is set.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hubcom_app') THEN
    CREATE ROLE hubcom_app NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE hubcom_app NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO hubcom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hubcom_app;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA public TO hubcom_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO hubcom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hubcom_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, USAGE ON SEQUENCES TO hubcom_app;
-- Allow SET ROLE hubcom_app from the migration/owner role
DO $$ BEGIN
  EXECUTE format('GRANT hubcom_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- When DATABASE_APP_URL / FORCE is requested via GUC at runtime we can
-- ALTER TABLE ... FORCE ROW LEVEL SECURITY. Keep ENABLE (not FORCE) here so
-- schema migrations as table owner still work without SET LOCAL context.
`;
