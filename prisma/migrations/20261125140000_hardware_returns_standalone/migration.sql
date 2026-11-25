-- Standalone Hardware-Rücklieferungen: detach from normal tickets.
-- Idempotent — safe on fresh and existing DBs.

-- Fresh-create shape stays in postgres-backend initDb; this migration upgrades
-- existing ticket_hardware_returns rows.

ALTER TABLE ticket_hardware_returns
  ALTER COLUMN ticket_id DROP NOT NULL;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS return_number TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'Hardware';

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS employee_name TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS employee_email TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS assignee_name TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS activity_log JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_hw_returns_org_return_number
  ON ticket_hardware_returns (organization_id, return_number)
  WHERE return_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_org_status
  ON ticket_hardware_returns (organization_id, status);

-- Backfill standalone fields from linked ticket documents (where still null).
UPDATE ticket_hardware_returns thr
SET
  subject = COALESCE(
    NULLIF(thr.subject, ''),
    NULLIF(doc.data->>'subject', ''),
    'Hardware'
  ),
  employee_name = COALESCE(
    thr.employee_name,
    NULLIF(doc.data->>'customerName', ''),
    NULLIF(doc.data->>'customer_name', '')
  ),
  employee_email = COALESCE(
    thr.employee_email,
    LOWER(NULLIF(doc.data->>'customerEmail', '')),
    LOWER(NULLIF(doc.data->>'customer_email', ''))
  ),
  description = COALESCE(
    thr.description,
    NULLIF(doc.data->>'description', '')
  ),
  status = COALESCE(
    NULLIF(thr.status, ''),
    CASE
      WHEN thr.returned = TRUE THEN 'returned'
      WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('closed', 'resolved') THEN 'closed'
      WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('in_progress', 'pending') THEN 'in_progress'
      WHEN LOWER(COALESCE(doc.data->>'status', '')) IN ('waiting', 'waiting_customer', 'on_hold', 'on-hold') THEN 'waiting'
      ELSE 'open'
    END
  ),
  return_number = COALESCE(
    thr.return_number,
    thr.external_ref_id,
    'RL-LEGACY-' || LEFT(REPLACE(thr.id::text, '-', ''), 8)
  ),
  updated_at = NOW()
FROM geistdesk_documents doc
WHERE thr.ticket_id IS NOT NULL
  AND doc.collection = 'tickets'
  AND doc.id = thr.ticket_id;

-- Rows without a resolvable ticket still get a return_number.
UPDATE ticket_hardware_returns
SET
  return_number = COALESCE(return_number, external_ref_id, 'RL-LEGACY-' || LEFT(REPLACE(id::text, '-', ''), 8)),
  subject = COALESCE(NULLIF(subject, ''), 'Hardware'),
  status = COALESCE(NULLIF(status, ''), CASE WHEN returned THEN 'returned' ELSE 'open' END),
  updated_at = NOW()
WHERE return_number IS NULL
   OR subject IS NULL
   OR status IS NULL;

-- Snapshot ticket ids that are 1:1 RMA stubs before clearing the FK.
CREATE TEMP TABLE IF NOT EXISTS _hw_rma_stub_tickets AS
SELECT thr.ticket_id AS id
FROM ticket_hardware_returns thr
JOIN geistdesk_documents doc
  ON doc.collection = 'tickets' AND doc.id = thr.ticket_id
WHERE thr.ticket_id IS NOT NULL
  AND (
    doc.data->>'channel' = 'hardware_returns'
    OR COALESCE(doc.data->'tags', '[]'::jsonb) ? 'hardware-returns'
    OR COALESCE(doc.data->'tags', '[]'::jsonb) ? 'ruecklieferung'
    OR LOWER(COALESCE(doc.data->>'subject', '')) LIKE 'hardware-rücklieferung%'
    OR LOWER(COALESCE(doc.data->>'subject', '')) LIKE 'hardware-ruecklieferung%'
  );

-- Detach returns from normal tickets (legacy ticket_id kept null).
UPDATE ticket_hardware_returns
SET ticket_id = NULL, updated_at = NOW()
WHERE ticket_id IS NOT NULL;

-- Remove only auto-created RMA stub tickets (never regular support tickets).
DELETE FROM geistdesk_documents
WHERE collection = 'tickets'
  AND id IN (SELECT id FROM _hw_rma_stub_tickets);

DROP TABLE IF EXISTS _hw_rma_stub_tickets;
