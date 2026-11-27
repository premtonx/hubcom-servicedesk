/**
 * PostgreSQL-backed security audit log + ban store (append-only audits).
 * In-memory sliding-window trackers live alongside for hot-path detection.
 */

import { queryDb } from '../postgres-backend.js';
import {
  ADMIN_FAILED_LOGIN_COOLDOWN_MS,
  CROSS_TENANT_403_WINDOW_MS,
  HONEYPOT_BAN_MS,
  LOGIN_FAIL_WINDOW_MS,
  PROGRESSIVE_LOCKOUT_MS,
  appendEventInWindow,
  countEventsInWindow,
  isAdminIpAllowlisted,
  isHubcomCoreAdminRole,
  parseAdminIpAllowlist,
  progressiveLockoutMs,
  type SecurityBanType,
  type SecuritySeverity,
} from './security-policy.js';

export type SecurityAuditEventType =
  | 'failed_login'
  | 'login_lockout'
  | 'honeypot_probe'
  | 'cross_tenant_probe_ban'
  | 'manual_ban'
  | 'manual_unban'
  | 'role_change'
  | 'm365_sso_approval'
  | 'csrf_blocked'
  | 'rate_limited'
  | string;

export type SecurityBanRow = {
  id: string;
  ban_type: SecurityBanType;
  target_value: string;
  reason: string;
  strike_count: number;
  banned_until: string | null;
  is_active: boolean;
  created_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
};

export type SecurityAuditRow = {
  id: string;
  event_type: string;
  severity: SecuritySeverity;
  ip_address: string | null;
  user_id: string | null;
  organization_id: string | null;
  path: string | null;
  method: string | null;
  details_json: Record<string, unknown>;
  created_at: string;
};

/** Process-local sliding windows (reset on restart — bans persist in PG). */
const loginFailsByKey = new Map<string, number[]>();
const forbidden403ByKey = new Map<string, number[]>();

function trackKey(kind: string, value: string): string {
  return `${kind}:${String(value || '').trim().toLowerCase()}`;
}

export function resetSecurityTrackersForTests(): void {
  loginFailsByKey.clear();
  forbidden403ByKey.clear();
}

export async function writeSecurityAuditLog(params: {
  event_type: SecurityAuditEventType;
  severity: SecuritySeverity;
  ip_address?: string | null;
  user_id?: string | null;
  organization_id?: string | null;
  path?: string | null;
  method?: string | null;
  details?: Record<string, unknown>;
}): Promise<SecurityAuditRow | null> {
  try {
    const res = await queryDb(
      `INSERT INTO security_audit_logs
         (event_type, severity, ip_address, user_id, organization_id, path, method, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id::text, event_type, severity, ip_address, user_id, organization_id,
                 path, method, details_json, created_at::text`,
      [
        params.event_type,
        params.severity,
        params.ip_address || null,
        params.user_id || null,
        params.organization_id || null,
        params.path || null,
        params.method || null,
        JSON.stringify(params.details || {}),
      ],
    );
    return mapAudit(res.rows?.[0]);
  } catch (err: any) {
    console.warn('[security] audit write failed:', err?.message || err);
    return null;
  }
}

export async function findActiveBan(
  banType: SecurityBanType,
  targetValue: string,
  now = new Date(),
): Promise<SecurityBanRow | null> {
  const target = String(targetValue || '').trim().toLowerCase();
  if (!target) return null;
  try {
    const res = await queryDb(
      `SELECT id::text, ban_type, target_value, reason, strike_count,
              banned_until::text, is_active, created_at::text,
              lifted_at::text, lifted_by
         FROM security_bans
        WHERE ban_type = $1
          AND lower(target_value) = $2
          AND is_active = TRUE
          AND (banned_until IS NULL OR banned_until > $3::timestamptz)
        ORDER BY created_at DESC
        LIMIT 1`,
      [banType, target, now.toISOString()],
    );
    return res.rows?.[0] ? mapBan(res.rows[0]) : null;
  } catch {
    return null;
  }
}

/** Active (non-deactivated) user role by email — used to exempt Hubcom core admins. */
export async function lookupActiveUserRoleByEmail(email: string): Promise<string | null> {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  try {
    const res = await queryDb(
      `SELECT data->>'role' AS role
         FROM geistdesk_documents
        WHERE collection = 'users'
          AND lower(COALESCE(data->>'email', '')) = $1
          AND lower(COALESCE(data->>'isDeactivated', 'false')) NOT IN ('true', '1', 'yes')
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1`,
      [clean],
    );
    const role = res.rows?.[0]?.role;
    return role ? String(role) : null;
  } catch {
    return null;
  }
}

/** Active user role by document id — used for cross-tenant account ban exemption. */
export async function lookupActiveUserRoleById(userId: string): Promise<string | null> {
  const id = String(userId || '').trim();
  if (!id) return null;
  try {
    const res = await queryDb(
      `SELECT data->>'role' AS role
         FROM geistdesk_documents
        WHERE collection = 'users'
          AND id = $1
          AND lower(COALESCE(data->>'isDeactivated', 'false')) NOT IN ('true', '1', 'yes')
        LIMIT 1`,
      [id],
    );
    const role = res.rows?.[0]?.role;
    return role ? String(role) : null;
  } catch {
    return null;
  }
}

export type AutoBanSkipReason = 'admin_ip_allowlist' | 'hubcom_core_admin';

/**
 * Decide whether an automatic ban must be skipped for Hubcom core admins
 * or IPs listed in ADMIN_IP_ALLOWLIST. Manual bans still use createSecurityBan.
 */
export async function shouldSkipAutoBan(params: {
  ban_type: SecurityBanType;
  target: string;
  ip?: string | null;
  /** Failed-login email context (exempts IP bans when the target account is a core admin). */
  loginEmail?: string | null;
  role?: string | null;
  userId?: string | null;
}): Promise<{ skip: boolean; reason: AutoBanSkipReason | null; role: string | null }> {
  if (isAdminIpAllowlisted(params.ip) || isAdminIpAllowlisted(params.target)) {
    return { skip: true, reason: 'admin_ip_allowlist', role: params.role || null };
  }

  let role = params.role ? String(params.role) : null;

  if (params.ban_type === 'account') {
    if (!role) {
      const target = String(params.target || '').trim();
      role = target.includes('@')
        ? await lookupActiveUserRoleByEmail(target)
        : await lookupActiveUserRoleById(target);
    }
    if (isHubcomCoreAdminRole(role)) {
      return { skip: true, reason: 'hubcom_core_admin', role };
    }
  }

  if (params.ban_type === 'ip' && params.loginEmail) {
    if (!role) {
      role = await lookupActiveUserRoleByEmail(params.loginEmail);
    }
    if (isHubcomCoreAdminRole(role)) {
      return { skip: true, reason: 'hubcom_core_admin', role };
    }
  }

  // Cross-tenant IP bans from a Hubcom core admin session must not lock their IP.
  if (params.ban_type === 'ip' && params.userId) {
    if (!role) {
      role = await lookupActiveUserRoleById(params.userId);
    }
    if (isHubcomCoreAdminRole(role)) {
      return { skip: true, reason: 'hubcom_core_admin', role };
    }
  }

  if (params.userId && !role) {
    role = await lookupActiveUserRoleById(params.userId);
  }
  if (params.ban_type === 'account' && isHubcomCoreAdminRole(role)) {
    return { skip: true, reason: 'hubcom_core_admin', role };
  }

  return { skip: false, reason: null, role };
}

export async function countPriorStrikes(
  banType: SecurityBanType,
  targetValue: string,
): Promise<number> {
  const target = String(targetValue || '').trim().toLowerCase();
  if (!target) return 0;
  try {
    const res = await queryDb(
      `SELECT COALESCE(MAX(strike_count), 0)::int AS max_strikes
         FROM security_bans
        WHERE ban_type = $1 AND lower(target_value) = $2`,
      [banType, target],
    );
    return Number(res.rows?.[0]?.max_strikes || 0);
  } catch {
    return 0;
  }
}

export async function createSecurityBan(params: {
  ban_type: SecurityBanType;
  target_value: string;
  reason: string;
  durationMs?: number | null;
  strike_count?: number;
}): Promise<SecurityBanRow | null> {
  const target = String(params.target_value || '').trim().toLowerCase();
  if (!target) return null;
  const prior = params.strike_count ?? (await countPriorStrikes(params.ban_type, target));
  const strike = Math.max(1, prior + (params.strike_count != null ? 0 : 1));
  const strikeCount = params.strike_count != null ? params.strike_count : strike;
  const until =
    params.durationMs == null
      ? null
      : new Date(Date.now() + Math.max(0, params.durationMs)).toISOString();

  // Deactivate overlapping active bans for same target.
  try {
    await queryDb(
      `UPDATE security_bans
          SET is_active = FALSE, lifted_at = NOW(), lifted_by = 'system:supersede'
        WHERE ban_type = $1 AND lower(target_value) = $2 AND is_active = TRUE`,
      [params.ban_type, target],
    );
  } catch {
    /* non-fatal */
  }

  try {
    const res = await queryDb(
      `INSERT INTO security_bans
         (ban_type, target_value, reason, strike_count, banned_until, is_active)
       VALUES ($1, $2, $3, $4, $5::timestamptz, TRUE)
       RETURNING id::text, ban_type, target_value, reason, strike_count,
                 banned_until::text, is_active, created_at::text,
                 lifted_at::text, lifted_by`,
      [params.ban_type, target, params.reason, strikeCount, until],
    );
    return res.rows?.[0] ? mapBan(res.rows[0]) : null;
  } catch (err: any) {
    console.warn('[security] ban create failed:', err?.message || err);
    return null;
  }
}

export async function liftSecurityBan(params: {
  banId: string;
  liftedBy: string;
}): Promise<SecurityBanRow | null> {
  const id = String(params.banId || '').trim();
  if (!id) return null;
  try {
    const res = await queryDb(
      `UPDATE security_bans
          SET is_active = FALSE, lifted_at = NOW(), lifted_by = $2
        WHERE id = $1::uuid
        RETURNING id::text, ban_type, target_value, reason, strike_count,
                  banned_until::text, is_active, created_at::text,
                  lifted_at::text, lifted_by`,
      [id, params.liftedBy],
    );
    return res.rows?.[0] ? mapBan(res.rows[0]) : null;
  } catch {
    return null;
  }
}

export async function listActiveBans(limit = 100): Promise<SecurityBanRow[]> {
  const res = await queryDb(
    `SELECT id::text, ban_type, target_value, reason, strike_count,
            banned_until::text, is_active, created_at::text,
            lifted_at::text, lifted_by
       FROM security_bans
      WHERE is_active = TRUE
        AND (banned_until IS NULL OR banned_until > NOW())
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return (res.rows || []).map(mapBan);
}

export async function listSecurityAuditLogs(params: {
  limit?: number;
  severity?: SecuritySeverity | null;
  event_type?: string | null;
}): Promise<SecurityAuditRow[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (params.severity) {
    values.push(params.severity);
    clauses.push(`severity = $${values.length}`);
  }
  if (params.event_type) {
    values.push(params.event_type);
    clauses.push(`event_type = $${values.length}`);
  }
  values.push(Math.min(500, Math.max(1, params.limit ?? 100)));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await queryDb(
    `SELECT id::text, event_type, severity, ip_address, user_id, organization_id,
            path, method, details_json, created_at::text
       FROM security_audit_logs
       ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length}`,
    values,
  );
  return (res.rows || []).map(mapAudit);
}

export async function getSecurityOverview(): Promise<{
  active_bans: number;
  critical_events_24h: number;
  honeypot_24h: number;
  failed_logins_24h: number;
  cross_tenant_24h: number;
}> {
  try {
    const bans = await queryDb(
      `SELECT COUNT(*)::int AS c FROM security_bans
        WHERE is_active = TRUE AND (banned_until IS NULL OR banned_until > NOW())`,
    );
    const crit = await queryDb(
      `SELECT COUNT(*)::int AS c FROM security_audit_logs
        WHERE severity = 'critical' AND created_at > NOW() - INTERVAL '24 hours'`,
    );
    const honey = await queryDb(
      `SELECT COUNT(*)::int AS c FROM security_audit_logs
        WHERE event_type = 'honeypot_probe' AND created_at > NOW() - INTERVAL '24 hours'`,
    );
    const fails = await queryDb(
      `SELECT COUNT(*)::int AS c FROM security_audit_logs
        WHERE event_type = 'failed_login' AND created_at > NOW() - INTERVAL '24 hours'`,
    );
    const cross = await queryDb(
      `SELECT COUNT(*)::int AS c FROM security_audit_logs
        WHERE event_type = 'cross_tenant_probe_ban' AND created_at > NOW() - INTERVAL '24 hours'`,
    );
    return {
      active_bans: Number(bans.rows?.[0]?.c || 0),
      critical_events_24h: Number(crit.rows?.[0]?.c || 0),
      honeypot_24h: Number(honey.rows?.[0]?.c || 0),
      failed_logins_24h: Number(fails.rows?.[0]?.c || 0),
      cross_tenant_24h: Number(cross.rows?.[0]?.c || 0),
    };
  } catch {
    return {
      active_bans: 0,
      critical_events_24h: 0,
      honeypot_24h: 0,
      failed_logins_24h: 0,
      cross_tenant_24h: 0,
    };
  }
}

/**
 * Record a failed login for IP + account; returns lockout info when threshold hit.
 * Uses an injectable clock + optional memory-only mode for unit tests.
 */
export function recordFailedLoginAttempt(params: {
  ip: string;
  email: string;
  nowMs?: number;
}): {
  ipFailCount: number;
  emailFailCount: number;
  lockoutTriggered: boolean;
  lockoutTargets: Array<{ ban_type: SecurityBanType; target: string }>;
} {
  const now = params.nowMs ?? Date.now();
  const ipKey = trackKey('ip', params.ip);
  const emailKey = trackKey('email', params.email);
  const ipTs = appendEventInWindow(loginFailsByKey.get(ipKey) || [], now, LOGIN_FAIL_WINDOW_MS);
  const emailTs = appendEventInWindow(
    loginFailsByKey.get(emailKey) || [],
    now,
    LOGIN_FAIL_WINDOW_MS,
  );
  loginFailsByKey.set(ipKey, ipTs);
  loginFailsByKey.set(emailKey, emailTs);

  const ipFailCount = countEventsInWindow(ipTs, now, LOGIN_FAIL_WINDOW_MS);
  const emailFailCount = countEventsInWindow(emailTs, now, LOGIN_FAIL_WINDOW_MS);
  const lockoutTargets: Array<{ ban_type: SecurityBanType; target: string }> = [];
  if (ipFailCount >= 5 && params.ip) {
    lockoutTargets.push({ ban_type: 'ip', target: params.ip });
  }
  if (emailFailCount >= 5 && params.email) {
    lockoutTargets.push({ ban_type: 'account', target: params.email.toLowerCase() });
  }
  return {
    ipFailCount,
    emailFailCount,
    lockoutTriggered: lockoutTargets.length > 0,
    lockoutTargets,
  };
}

export function recordForbidden403(params: {
  ip: string;
  userId?: string | null;
  nowMs?: number;
}): {
  ipCount: number;
  userCount: number;
  banTriggered: boolean;
  banTargets: Array<{ ban_type: SecurityBanType; target: string }>;
} {
  const now = params.nowMs ?? Date.now();
  const ipKey = trackKey('403ip', params.ip);
  const ipTs = appendEventInWindow(
    forbidden403ByKey.get(ipKey) || [],
    now,
    CROSS_TENANT_403_WINDOW_MS,
  );
  forbidden403ByKey.set(ipKey, ipTs);
  const ipCount = countEventsInWindow(ipTs, now, CROSS_TENANT_403_WINDOW_MS);

  let userCount = 0;
  const banTargets: Array<{ ban_type: SecurityBanType; target: string }> = [];
  if (params.userId) {
    const userKey = trackKey('403user', params.userId);
    const userTs = appendEventInWindow(
      forbidden403ByKey.get(userKey) || [],
      now,
      CROSS_TENANT_403_WINDOW_MS,
    );
    forbidden403ByKey.set(userKey, userTs);
    userCount = countEventsInWindow(userTs, now, CROSS_TENANT_403_WINDOW_MS);
    if (userCount >= 10) {
      banTargets.push({ ban_type: 'account', target: params.userId });
    }
  }
  if (ipCount >= 10 && params.ip) {
    banTargets.push({ ban_type: 'ip', target: params.ip });
  }
  return {
    ipCount,
    userCount,
    banTriggered: banTargets.length > 0,
    banTargets,
  };
}

export async function applyProgressiveLoginLockout(params: {
  ban_type: SecurityBanType;
  target: string;
  ip?: string | null;
  path?: string | null;
  loginEmail?: string | null;
  role?: string | null;
}): Promise<{
  ban: SecurityBanRow | null;
  durationMs: number;
  exempt: boolean;
  cooldownMs: number;
  skipReason: AutoBanSkipReason | null;
}> {
  const skip = await shouldSkipAutoBan({
    ban_type: params.ban_type,
    target: params.target,
    ip: params.ip || null,
    loginEmail: params.loginEmail || null,
    role: params.role || null,
  });
  if (skip.skip) {
    await writeSecurityAuditLog({
      event_type: 'login_lockout',
      severity: 'warning',
      ip_address: params.ip || null,
      user_id: params.ban_type === 'account' ? params.target : null,
      path: params.path || '/api/auth/login',
      method: 'POST',
      details: {
        ban_type: params.ban_type,
        target: params.target,
        exempt: true,
        reason: skip.reason,
        role: skip.role,
        cooldown_ms: ADMIN_FAILED_LOGIN_COOLDOWN_MS,
      },
    });
    return {
      ban: null,
      durationMs: 0,
      exempt: true,
      cooldownMs: ADMIN_FAILED_LOGIN_COOLDOWN_MS,
      skipReason: skip.reason,
    };
  }

  const prior = await countPriorStrikes(params.ban_type, params.target);
  const durationMs = progressiveLockoutMs(prior);
  const ban = await createSecurityBan({
    ban_type: params.ban_type,
    target_value: params.target,
    reason: 'login_brute_force',
    durationMs,
    strike_count: prior + 1,
  });
  await writeSecurityAuditLog({
    event_type: 'login_lockout',
    severity: 'critical',
    ip_address: params.ip || null,
    user_id: params.ban_type === 'account' ? params.target : null,
    path: params.path || '/api/auth/login',
    method: 'POST',
    details: {
      ban_type: params.ban_type,
      target: params.target,
      duration_ms: durationMs,
      strike_count: prior + 1,
      progressive_steps_ms: [...PROGRESSIVE_LOCKOUT_MS],
    },
  });
  return {
    ban,
    durationMs,
    exempt: false,
    cooldownMs: 0,
    skipReason: null,
  };
}

export async function applyHoneypotBan(params: {
  ip: string;
  path: string;
  method?: string;
}): Promise<SecurityBanRow | null> {
  if (isAdminIpAllowlisted(params.ip)) {
    await writeSecurityAuditLog({
      event_type: 'honeypot_probe',
      severity: 'warning',
      ip_address: params.ip,
      path: params.path,
      method: params.method || 'GET',
      details: {
        exempt: true,
        reason: 'admin_ip_allowlist',
        duration_ms: HONEYPOT_BAN_MS,
      },
    });
    return null;
  }

  const ban = await createSecurityBan({
    ban_type: 'ip',
    target_value: params.ip,
    reason: 'honeypot_probe',
    durationMs: HONEYPOT_BAN_MS,
  });
  await writeSecurityAuditLog({
    event_type: 'honeypot_probe',
    severity: 'critical',
    ip_address: params.ip,
    path: params.path,
    method: params.method || 'GET',
    details: { ban_id: ban?.id || null, duration_ms: HONEYPOT_BAN_MS },
  });
  return ban;
}

export async function applyCrossTenantBan(params: {
  ban_type: SecurityBanType;
  target: string;
  ip?: string | null;
  user_id?: string | null;
  role?: string | null;
  path?: string | null;
  method?: string | null;
  count?: number;
}): Promise<SecurityBanRow | null> {
  const skip = await shouldSkipAutoBan({
    ban_type: params.ban_type,
    target: params.target,
    ip: params.ip || null,
    role: params.role || null,
    userId: params.user_id || null,
  });
  if (skip.skip) {
    await writeSecurityAuditLog({
      event_type: 'cross_tenant_probe_ban',
      severity: 'warning',
      ip_address: params.ip || null,
      user_id: params.user_id || null,
      path: params.path || null,
      method: params.method || null,
      details: {
        ban_type: params.ban_type,
        target: params.target,
        forbidden_count: params.count || 10,
        exempt: true,
        reason: skip.reason,
        role: skip.role,
      },
    });
    return null;
  }

  const ban = await createSecurityBan({
    ban_type: params.ban_type,
    target_value: params.target,
    reason: 'cross_tenant_probe',
    durationMs: 60 * 60 * 1000,
  });
  await writeSecurityAuditLog({
    event_type: 'cross_tenant_probe_ban',
    severity: 'critical',
    ip_address: params.ip || null,
    user_id: params.user_id || null,
    path: params.path || null,
    method: params.method || null,
    details: {
      ban_type: params.ban_type,
      target: params.target,
      forbidden_count: params.count || 10,
      duration_ms: 60 * 60 * 1000,
    },
  });
  return ban;
}

function mapBan(row: any): SecurityBanRow {
  return {
    id: String(row.id),
    ban_type: row.ban_type as SecurityBanType,
    target_value: String(row.target_value),
    reason: String(row.reason || ''),
    strike_count: Number(row.strike_count || 0),
    banned_until: row.banned_until == null ? null : String(row.banned_until),
    is_active: row.is_active !== false && row.is_active !== 'f',
    created_at: String(row.created_at || ''),
    lifted_at: row.lifted_at == null ? null : String(row.lifted_at),
    lifted_by: row.lifted_by == null ? null : String(row.lifted_by),
  };
}

function mapAudit(row: any): SecurityAuditRow {
  let details: Record<string, unknown> = {};
  if (row?.details_json && typeof row.details_json === 'object') {
    details = row.details_json;
  } else if (typeof row?.details_json === 'string') {
    try {
      details = JSON.parse(row.details_json);
    } catch {
      details = {};
    }
  }
  return {
    id: String(row.id),
    event_type: String(row.event_type || ''),
    severity: row.severity as SecuritySeverity,
    ip_address: row.ip_address == null ? null : String(row.ip_address),
    user_id: row.user_id == null ? null : String(row.user_id),
    organization_id: row.organization_id == null ? null : String(row.organization_id),
    path: row.path == null ? null : String(row.path),
    method: row.method == null ? null : String(row.method),
    details_json: details,
    created_at: String(row.created_at || ''),
  };
}

export type MemorySecurityEngineOptions = {
  /** Override ADMIN_IP_ALLOWLIST for deterministic tests. */
  adminIpAllowlist?: string[];
  /** email (lower) → role for login lockout exemptions. */
  accountRoles?: Record<string, string>;
  /** userId → role for cross-tenant account exemptions. */
  userRoles?: Record<string, string>;
};

/** In-memory engine for isolation tests (no Postgres). */
export function createMemorySecurityEngine(options: MemorySecurityEngineOptions = {}) {
  const bans: SecurityBanRow[] = [];
  const audits: SecurityAuditRow[] = [];
  const fails = new Map<string, number[]>();
  const forbiddens = new Map<string, number[]>();
  let seq = 0;
  const allowlist =
    options.adminIpAllowlist != null
      ? options.adminIpAllowlist.map((s) => s.trim().toLowerCase()).filter(Boolean)
      : parseAdminIpAllowlist();
  const accountRoles = options.accountRoles || {};
  const userRoles = options.userRoles || {};

  function roleForEmail(email: string): string | null {
    return accountRoles[email.toLowerCase()] || null;
  }

  function roleForUser(userId: string): string | null {
    return userRoles[userId] || null;
  }

  function ipAllowlisted(ip: string): boolean {
    return isAdminIpAllowlisted(ip, allowlist);
  }

  function loginExempt(ip: string, email: string): AutoBanSkipReason | null {
    if (ipAllowlisted(ip)) return 'admin_ip_allowlist';
    if (isHubcomCoreAdminRole(roleForEmail(email))) return 'hubcom_core_admin';
    return null;
  }

  return {
    bans,
    audits,
    recordFailedLogin(ip: string, email: string, nowMs = Date.now()) {
      const ipKey = trackKey('ip', ip);
      const emailKey = trackKey('email', email);
      fails.set(ipKey, appendEventInWindow(fails.get(ipKey) || [], nowMs, LOGIN_FAIL_WINDOW_MS));
      fails.set(
        emailKey,
        appendEventInWindow(fails.get(emailKey) || [], nowMs, LOGIN_FAIL_WINDOW_MS),
      );
      const ipCount = countEventsInWindow(fails.get(ipKey) || [], nowMs, LOGIN_FAIL_WINDOW_MS);
      const emailCount = countEventsInWindow(
        fails.get(emailKey) || [],
        nowMs,
        LOGIN_FAIL_WINDOW_MS,
      );
      const lockouts: SecurityBanRow[] = [];
      const thresholdHit = ipCount >= 5 || emailCount >= 5;
      const skipReason = thresholdHit ? loginExempt(ip, email) : null;

      if (thresholdHit && skipReason) {
        audits.push({
          id: `aud-${++seq}`,
          event_type: 'login_lockout',
          severity: 'warning',
          ip_address: ip,
          user_id: email.toLowerCase(),
          organization_id: null,
          path: '/api/auth/login',
          method: 'POST',
          details_json: {
            exempt: true,
            reason: skipReason,
            cooldown_ms: ADMIN_FAILED_LOGIN_COOLDOWN_MS,
            role: roleForEmail(email),
          },
          created_at: new Date(nowMs).toISOString(),
        });
        return {
          ipCount,
          emailCount,
          lockouts,
          exempt: true,
          cooldownMs: ADMIN_FAILED_LOGIN_COOLDOWN_MS,
          skipReason,
        };
      }

      if (ipCount >= 5) {
        const prior = bans.filter((b) => b.ban_type === 'ip' && b.target_value === ip.toLowerCase())
          .length;
        const durationMs = progressiveLockoutMs(prior);
        const ban: SecurityBanRow = {
          id: `ban-${++seq}`,
          ban_type: 'ip',
          target_value: ip.toLowerCase(),
          reason: 'login_brute_force',
          strike_count: prior + 1,
          banned_until: new Date(nowMs + durationMs).toISOString(),
          is_active: true,
          created_at: new Date(nowMs).toISOString(),
          lifted_at: null,
          lifted_by: null,
        };
        bans.push(ban);
        lockouts.push(ban);
        audits.push({
          id: `aud-${++seq}`,
          event_type: 'login_lockout',
          severity: 'critical',
          ip_address: ip,
          user_id: null,
          organization_id: null,
          path: '/api/auth/login',
          method: 'POST',
          details_json: { ban_type: 'ip', target: ip, duration_ms: durationMs },
          created_at: new Date(nowMs).toISOString(),
        });
      }
      if (emailCount >= 5) {
        const prior = bans.filter(
          (b) => b.ban_type === 'account' && b.target_value === email.toLowerCase(),
        ).length;
        const durationMs = progressiveLockoutMs(prior);
        const ban: SecurityBanRow = {
          id: `ban-${++seq}`,
          ban_type: 'account',
          target_value: email.toLowerCase(),
          reason: 'login_brute_force',
          strike_count: prior + 1,
          banned_until: new Date(nowMs + durationMs).toISOString(),
          is_active: true,
          created_at: new Date(nowMs).toISOString(),
          lifted_at: null,
          lifted_by: null,
        };
        bans.push(ban);
        lockouts.push(ban);
        audits.push({
          id: `aud-${++seq}`,
          event_type: 'login_lockout',
          severity: 'critical',
          ip_address: ip,
          user_id: email.toLowerCase(),
          organization_id: null,
          path: '/api/auth/login',
          method: 'POST',
          details_json: { ban_type: 'account', target: email, duration_ms: durationMs },
          created_at: new Date(nowMs).toISOString(),
        });
      }
      return {
        ipCount,
        emailCount,
        lockouts,
        exempt: false,
        cooldownMs: 0,
        skipReason: null as AutoBanSkipReason | null,
      };
    },
    honeypot(ip: string, path: string, nowMs = Date.now()) {
      if (ipAllowlisted(ip)) {
        audits.push({
          id: `aud-${++seq}`,
          event_type: 'honeypot_probe',
          severity: 'warning',
          ip_address: ip,
          user_id: null,
          organization_id: null,
          path,
          method: 'GET',
          details_json: { exempt: true, reason: 'admin_ip_allowlist' },
          created_at: new Date(nowMs).toISOString(),
        });
        return null;
      }
      const ban: SecurityBanRow = {
        id: `ban-${++seq}`,
        ban_type: 'ip',
        target_value: ip.toLowerCase(),
        reason: 'honeypot_probe',
        strike_count: 1,
        banned_until: new Date(nowMs + HONEYPOT_BAN_MS).toISOString(),
        is_active: true,
        created_at: new Date(nowMs).toISOString(),
        lifted_at: null,
        lifted_by: null,
      };
      bans.push(ban);
      audits.push({
        id: `aud-${++seq}`,
        event_type: 'honeypot_probe',
        severity: 'critical',
        ip_address: ip,
        user_id: null,
        organization_id: null,
        path,
        method: 'GET',
        details_json: { duration_ms: HONEYPOT_BAN_MS },
        created_at: new Date(nowMs).toISOString(),
      });
      return ban;
    },
    record403(ip: string, userId: string, nowMs = Date.now()) {
      const ipKey = trackKey('403ip', ip);
      const userKey = trackKey('403user', userId);
      forbiddens.set(
        ipKey,
        appendEventInWindow(forbiddens.get(ipKey) || [], nowMs, CROSS_TENANT_403_WINDOW_MS),
      );
      forbiddens.set(
        userKey,
        appendEventInWindow(forbiddens.get(userKey) || [], nowMs, CROSS_TENANT_403_WINDOW_MS),
      );
      const ipCount = countEventsInWindow(
        forbiddens.get(ipKey) || [],
        nowMs,
        CROSS_TENANT_403_WINDOW_MS,
      );
      const userCount = countEventsInWindow(
        forbiddens.get(userKey) || [],
        nowMs,
        CROSS_TENANT_403_WINDOW_MS,
      );
      const lockouts: SecurityBanRow[] = [];
      if (ipCount >= 10 || userCount >= 10) {
        const userRole = roleForUser(userId);
        const accountExempt = ipAllowlisted(ip)
          ? ('admin_ip_allowlist' as const)
          : isHubcomCoreAdminRole(userRole)
            ? ('hubcom_core_admin' as const)
            : null;
        const ipExempt = ipAllowlisted(ip)
          ? ('admin_ip_allowlist' as const)
          : isHubcomCoreAdminRole(userRole)
            ? ('hubcom_core_admin' as const)
            : null;

        if (userCount >= 10) {
          if (accountExempt) {
            audits.push({
              id: `aud-${++seq}`,
              event_type: 'cross_tenant_probe_ban',
              severity: 'warning',
              ip_address: ip,
              user_id: userId,
              organization_id: null,
              path: null,
              method: null,
              details_json: {
                exempt: true,
                reason: accountExempt,
                role: userRole,
                ban_type: 'account',
              },
              created_at: new Date(nowMs).toISOString(),
            });
          } else {
            const ban: SecurityBanRow = {
              id: `ban-${++seq}`,
              ban_type: 'account',
              target_value: userId,
              reason: 'cross_tenant_probe',
              strike_count: 1,
              banned_until: new Date(nowMs + 60 * 60 * 1000).toISOString(),
              is_active: true,
              created_at: new Date(nowMs).toISOString(),
              lifted_at: null,
              lifted_by: null,
            };
            bans.push(ban);
            lockouts.push(ban);
          }
        }
        if (ipCount >= 10) {
          if (ipExempt) {
            audits.push({
              id: `aud-${++seq}`,
              event_type: 'cross_tenant_probe_ban',
              severity: 'warning',
              ip_address: ip,
              user_id: userId,
              organization_id: null,
              path: null,
              method: null,
              details_json: {
                exempt: true,
                reason: ipExempt,
                ban_type: 'ip',
              },
              created_at: new Date(nowMs).toISOString(),
            });
          } else {
            const ban: SecurityBanRow = {
              id: `ban-${++seq}`,
              ban_type: 'ip',
              target_value: ip.toLowerCase(),
              reason: 'cross_tenant_probe',
              strike_count: 1,
              banned_until: new Date(nowMs + 60 * 60 * 1000).toISOString(),
              is_active: true,
              created_at: new Date(nowMs).toISOString(),
              lifted_at: null,
              lifted_by: null,
            };
            bans.push(ban);
            lockouts.push(ban);
          }
        }
        if (lockouts.length > 0) {
          audits.push({
            id: `aud-${++seq}`,
            event_type: 'cross_tenant_probe_ban',
            severity: 'critical',
            ip_address: ip,
            user_id: userId,
            organization_id: null,
            path: null,
            method: null,
            details_json: { ipCount, userCount },
            created_at: new Date(nowMs).toISOString(),
          });
        }
      }
      return { ipCount, userCount, lockouts };
    },
    isBanned(banType: SecurityBanType, target: string, nowMs = Date.now()) {
      if (banType === 'ip' && ipAllowlisted(target)) return false;
      const t = target.toLowerCase();
      return bans.some(
        (b) =>
          b.ban_type === banType &&
          b.target_value === t &&
          b.is_active &&
          (b.banned_until == null || Date.parse(b.banned_until) > nowMs),
      );
    },
    unban(banId: string, liftedBy: string, nowMs = Date.now()) {
      const ban = bans.find((b) => b.id === banId);
      if (!ban) return null;
      ban.is_active = false;
      ban.lifted_at = new Date(nowMs).toISOString();
      ban.lifted_by = liftedBy;
      return ban;
    },
  };
}
