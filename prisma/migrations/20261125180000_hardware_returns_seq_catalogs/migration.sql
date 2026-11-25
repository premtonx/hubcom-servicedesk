-- Hardware returns: sequential org-scoped IDs (#DPG-N), extended fields, catalogs.
-- Idempotent — safe on fresh and existing DBs.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hardware_returns_seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ticket_hardware_returns
  ALTER COLUMN subject DROP NOT NULL;

ALTER TABLE ticket_hardware_returns
  ALTER COLUMN subject SET DEFAULT NULL;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS assignee_user_id TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS directory_user_id TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS device_old_type TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS device_old_serial TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS device_new_type TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS device_new_serial TEXT;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS sla TEXT DEFAULT 'Normal';

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS mail1_scheduled_date DATE;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS mail2_scheduled_date DATE;

ALTER TABLE ticket_hardware_returns
  ADD COLUMN IF NOT EXISTS mail3_scheduled_date DATE;

-- service_level: SMALLINT → TEXT so admins can add custom levels beyond 1/2/3
ALTER TABLE ticket_hardware_returns
  ALTER COLUMN service_level TYPE TEXT
  USING CASE
    WHEN service_level IS NULL THEN NULL
    ELSE TRIM(service_level::text)
  END;

ALTER TABLE ticket_hardware_returns
  ALTER COLUMN status SET DEFAULT 'Neu';
