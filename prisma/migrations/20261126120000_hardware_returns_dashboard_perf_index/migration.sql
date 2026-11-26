-- Lean portal-dashboard returns KPIs/trends query filter.
CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_org_req_returned_due
  ON ticket_hardware_returns (organization_id, return_required, returned, return_due_date);
