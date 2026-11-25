-- Per-organization Hardware-Rücklieferungen & Service-Level module (Part 1).
-- Default OFF for all orgs. Tickets live in geistdesk_documents — ticket_id is
-- a soft reference (same pattern as ticket_participants). User PM/manager/phone
-- fields live on geistdesk_documents.users JSONB (not a SQL users table).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hardware_returns_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS hardware_returns_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS ticket_hardware_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id VARCHAR(255) NOT NULL UNIQUE,
  external_ref_id TEXT,
  service_level SMALLINT,
  time_sl1_minutes INT NOT NULL DEFAULT 0,
  time_sl2_minutes INT NOT NULL DEFAULT 0,
  time_sl3_minutes INT NOT NULL DEFAULT 0,
  exported BOOLEAN NOT NULL DEFAULT FALSE,
  exported_at TIMESTAMPTZ,
  request_type TEXT,
  device_details TEXT,
  employee_phone TEXT,
  employee_mobile TEXT,
  project_manager_name TEXT,
  project_manager_email TEXT,
  manager_name TEXT,
  manager_email TEXT,
  ceo_email_override TEXT,
  stage_recipients_override JSONB,
  solution_summary TEXT,
  shipping_method TEXT,
  shipping_reference TEXT,
  return_required BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_date DATE,
  return_due_date DATE,
  auto_reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mail1_sent_at TIMESTAMPTZ,
  mail1_sent_recipients JSONB,
  mail2_sent_at TIMESTAMPTZ,
  mail2_sent_recipients JSONB,
  mail3_sent_at TIMESTAMPTZ,
  mail3_sent_recipients JSONB,
  returned BOOLEAN NOT NULL DEFAULT FALSE,
  returned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ticket_hardware_returns_service_level_chk
    CHECK (service_level IS NULL OR service_level IN (1, 2, 3))
);

CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_org
  ON ticket_hardware_returns (organization_id);

CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_due
  ON ticket_hardware_returns (organization_id, return_due_date)
  WHERE return_required = TRUE AND returned = FALSE;

CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_ticket
  ON ticket_hardware_returns (ticket_id);
