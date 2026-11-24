-- Per-client portal dashboard banner + editable support-contract fields.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS portal_banner_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monthly_rate TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_reference TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_notes TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contract_term TEXT;
