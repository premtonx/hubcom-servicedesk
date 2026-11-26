-- Composite index for portal dashboard KPI COUNT FILTER + trends generate_series joins.
CREATE INDEX IF NOT EXISTS idx_ticket_hw_returns_org_dashboard_trends
  ON ticket_hardware_returns (
    organization_id,
    return_required,
    returned,
    return_due_date,
    returned_at,
    created_at
  );
