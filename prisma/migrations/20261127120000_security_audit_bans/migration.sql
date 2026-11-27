-- Perimeter security: immutable audit log + progressive bans (idempotent).

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  ip_address TEXT,
  user_id TEXT,
  organization_id TEXT,
  path TEXT,
  method TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_security_audit_created
  ON security_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_severity
  ON security_audit_logs (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_event
  ON security_audit_logs (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS security_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_type TEXT NOT NULL CHECK (ban_type IN ('ip', 'account')),
  target_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  strike_count INTEGER NOT NULL DEFAULT 1,
  banned_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lifted_at TIMESTAMPTZ,
  lifted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_bans_active_target
  ON security_bans (ban_type, lower(target_value), is_active);
CREATE INDEX IF NOT EXISTS idx_security_bans_active_until
  ON security_bans (is_active, banned_until);
