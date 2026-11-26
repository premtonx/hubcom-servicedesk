-- Per-organization Kunden-Portal favicon (data URL).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS favicon_url TEXT;
