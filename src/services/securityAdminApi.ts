/** Client API for Admin-Hub security monitor (no /api/db). */

export type SecurityBan = {
  id: string;
  ban_type: 'ip' | 'account';
  target_value: string;
  reason: string;
  strike_count: number;
  banned_until: string | null;
  is_active: boolean;
  created_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
};

export type SecurityAuditLog = {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  ip_address: string | null;
  user_id: string | null;
  organization_id: string | null;
  path: string | null;
  method: string | null;
  details_json: Record<string, unknown>;
  created_at: string;
};

export type SecurityOverview = {
  active_bans: number;
  critical_events_24h: number;
  honeypot_24h: number;
  failed_logins_24h: number;
  cross_tenant_24h: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export function fetchSecurityOverview() {
  return api<{ overview: SecurityOverview }>('/api/admin/security/overview');
}

export function fetchSecurityBans() {
  return api<{ bans: SecurityBan[] }>('/api/admin/security/bans');
}

export function fetchSecurityAuditLogs(params?: {
  severity?: string;
  event_type?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.event_type) qs.set('event_type', params.event_type);
  const q = qs.toString();
  return api<{ logs: SecurityAuditLog[] }>(
    `/api/admin/security/audit-logs${q ? `?${q}` : ''}`,
  );
}

export function unbanSecurityTarget(banId: string) {
  return api<{ ban: SecurityBan }>(`/api/admin/security/bans/${banId}/unban`, {
    method: 'POST',
    body: '{}',
  });
}

export function createManualBan(body: {
  ban_type: 'ip' | 'account';
  target_value: string;
  reason: string;
  duration_hours?: number | null;
}) {
  return api<{ ban: SecurityBan }>('/api/admin/security/bans', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
