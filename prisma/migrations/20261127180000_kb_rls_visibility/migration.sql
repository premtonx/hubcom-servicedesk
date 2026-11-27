-- KB article + KnowledgeEmbedding RLS: portal may read shared_portal (global)
-- and own-org organization (tenant) rows; writes are tenant-only. Embeddings
-- expose shared_portal NULL-org chunks without leaking internal Hubcom docs.

CREATE OR REPLACE FUNCTION app_document_kb_visibility(data jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(replace(trim(COALESCE(data->>'visibility', '')), '-', '_'))
    WHEN 'shared_portal' THEN 'shared_portal'
    WHEN 'shared' THEN 'shared_portal'
    WHEN 'public' THEN 'shared_portal'
    WHEN 'global' THEN 'shared_portal'
    WHEN 'organization' THEN 'organization'
    WHEN 'org' THEN 'organization'
    WHEN 'company' THEN 'organization'
    WHEN 'tenant' THEN 'organization'
    ELSE 'internal'
  END;
$$;

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
        WHEN collection = 'kb_articles' THEN
          (
            app_document_kb_visibility(data) = 'shared_portal'
            OR (
              app_document_kb_visibility(data) = 'organization'
              AND app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
            )
          )
        WHEN collection IN ('kb_categories', 'kb_documents') THEN
          app_document_org_id(data) IS NULL
          OR app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
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

CREATE OR REPLACE FUNCTION app_rls_document_write_allowed(collection text, data jsonb)
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
        WHEN collection = 'kb_articles' THEN
          app_document_kb_visibility(data) = 'organization'
          AND app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
        WHEN collection IN ('kb_categories', 'kb_documents') THEN
          app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
        ELSE app_document_org_id(data) = NULLIF(current_setting('app.current_org_id', true), '')
      END
    WHEN 'staff_scoped' THEN
      app_rls_document_allowed(collection, data)
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION app_rls_embedding_allowed(org_id text, metadata jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE COALESCE(current_setting('app.rls_mode', true), '')
    WHEN 'super_admin' THEN TRUE
    WHEN 'system' THEN TRUE
    WHEN 'portal' THEN
      (
        org_id IS NOT NULL
        AND org_id = NULLIF(current_setting('app.current_org_id', true), '')
      )
      OR (
        (org_id IS NULL OR TRIM(org_id) = '')
        AND lower(replace(trim(COALESCE(
          metadata->>'visibility',
          ''
        )), '-', '_')) IN ('shared_portal', 'shared', 'public', 'global')
      )
    WHEN 'staff_scoped' THEN
      org_id IS NULL
      OR org_id = ANY (
        string_to_array(NULLIF(current_setting('app.allowed_org_ids', true), ''), ',')
      )
    ELSE FALSE
  END;
$$;

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
        WITH CHECK (app_rls_document_write_allowed(collection, data))
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
        USING (app_rls_embedding_allowed(organization_id, metadata))
        WITH CHECK (
          CASE COALESCE(current_setting('app.rls_mode', true), '')
            WHEN 'super_admin' THEN TRUE
            WHEN 'system' THEN TRUE
            WHEN 'portal' THEN
              organization_id IS NOT NULL
              AND organization_id = NULLIF(current_setting('app.current_org_id', true), '')
            ELSE app_rls_embedding_allowed(organization_id, metadata)
          END
        )
    $p$;
  END IF;
END $$;
