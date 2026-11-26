-- Strict per-organization pgvector RAG isolation (Part 1).
-- organization_id is NULL for Hubcom-global / shared articles; set for org-owned KB.

ALTER TABLE "KnowledgeEmbedding"
  ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255);

-- Composite indexes for org-scoped retrieval + article lookups.
CREATE INDEX IF NOT EXISTS "idx_knowledge_embedding_tenant_org"
  ON "KnowledgeEmbedding" ("tenant_id", "organization_id");

CREATE INDEX IF NOT EXISTS "idx_knowledge_embedding_article"
  ON "KnowledgeEmbedding" ("source_id")
  WHERE source_type = 'KB_ARTICLE';

CREATE INDEX IF NOT EXISTS "idx_knowledge_embedding_org"
  ON "KnowledgeEmbedding" ("organization_id")
  WHERE organization_id IS NOT NULL;

-- Idempotent backfill from parent KB article documents.
UPDATE "KnowledgeEmbedding" ke
   SET organization_id = COALESCE(
         NULLIF(TRIM(d.data->>'organizationId'), ''),
         NULLIF(TRIM(d.data->>'organization_id'), ''),
         CASE
           WHEN ke.tenant_id LIKE 'org:%' THEN NULLIF(TRIM(substring(ke.tenant_id from 5)), '')
           ELSE NULL
         END
       ),
       updated_at = CURRENT_TIMESTAMP
  FROM geistdesk_documents d
 WHERE ke.source_type = 'KB_ARTICLE'
   AND ke.organization_id IS NULL
   AND d.collection = 'kb_articles'
   AND d.id = ke.source_id;

-- Fallback for org-tenant rows still missing a parent article match.
UPDATE "KnowledgeEmbedding" ke
   SET organization_id = NULLIF(TRIM(substring(ke.tenant_id from 5)), ''),
       updated_at = CURRENT_TIMESTAMP
 WHERE ke.organization_id IS NULL
   AND ke.tenant_id LIKE 'org:%'
   AND length(trim(substring(ke.tenant_id from 5))) > 0;

-- Refresh compat view to expose organization_id.
CREATE OR REPLACE VIEW rag_chunks AS
SELECT
  id,
  CASE source_type::text
    WHEN 'KB_ARTICLE' THEN 'kb_article'
    WHEN 'RESOLVED_TICKET' THEN 'resolved_ticket'
    WHEN 'KB_DOCUMENT' THEN 'file'
    ELSE lower(source_type::text)
  END AS source_type,
  source_id,
  chunk_index,
  chunk_content AS content,
  embedding,
  tenant_id,
  organization_id,
  metadata,
  created_at,
  updated_at
FROM "KnowledgeEmbedding";
