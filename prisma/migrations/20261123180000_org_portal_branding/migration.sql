-- Per-client white-label branding for the Kunden-Portal.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS portal_title TEXT;
