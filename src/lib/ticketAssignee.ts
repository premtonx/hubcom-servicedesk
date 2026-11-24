import type { Ticket } from '../types';

/**
 * Canonical “unassigned” = no real assignee across agentId / assigneeId /
 * assignedTo / assignedToEmail / agentName. Legacy string sentinels are
 * normalized to empty/null — never a status and never a pseudo-user.
 */
export const UNASSIGNED_SENTINELS = new Set([
  '',
  'unassigned',
  'nicht-zugewiesen',
  'nicht zugewiesen',
  'nicht_zugewiesen',
]);

export function isUnassignedSentinel(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'object') return false;
  return UNASSIGNED_SENTINELS.has(String(value).trim().toLowerCase());
}

/** Pull a primitive id from a string or `{ id, uid, agentId }` object. */
export function scalarAssigneeId(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const nested = obj.id ?? obj.uid ?? obj.agentId ?? obj.assigneeId;
    return scalarAssigneeId(nested);
  }
  const id = String(val).trim();
  return UNASSIGNED_SENTINELS.has(id.toLowerCase()) ? '' : id;
}

export function scalarAssigneeName(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return scalarAssigneeName(obj.name ?? obj.displayName ?? obj.label ?? obj.email);
  }
  const name = String(val).trim();
  return UNASSIGNED_SENTINELS.has(name.toLowerCase()) ? '' : name;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function identitySet(values: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const n = norm(value);
    if (!n || UNASSIGNED_SENTINELS.has(n)) continue;
    set.add(n);
  }
  return set;
}

export interface TicketAssigneeUser {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

export function ticketAssigneeIds(ticket: Pick<
  Ticket,
  'agentId' | 'assigneeId' | 'assignedTo' | 'assignedToEmail'
>): string[] {
  return [
    scalarAssigneeId(ticket.agentId),
    scalarAssigneeId(ticket.assigneeId),
    scalarAssigneeId(ticket.assignedTo),
    scalarAssigneeId(ticket.assignedToEmail),
  ].filter(Boolean);
}

/** Displayed assignee label — `assignedTo` is an id alias, not a name. */
export function ticketAssigneeNames(ticket: Pick<Ticket, 'agentName'>): string[] {
  return [scalarAssigneeName(ticket.agentName)].filter(Boolean);
}

export function hasAssignee(
  ticket: Pick<Ticket, 'agentId' | 'assigneeId' | 'assignedTo' | 'assignedToEmail' | 'agentName'>,
): boolean {
  return ticketAssigneeIds(ticket).length > 0 || ticketAssigneeNames(ticket).length > 0;
}

/**
 * Resolve the current real assignee for UI controls.
 * Returns null when unassigned (including legacy sentinels).
 */
export function resolveTicketAssignee(
  ticket: Pick<Ticket, 'agentId' | 'assigneeId' | 'assignedTo' | 'assignedToEmail' | 'agentName'>,
): { id: string; name: string } | null {
  if (!hasAssignee(ticket)) return null;
  const id =
    scalarAssigneeId(ticket.agentId) ||
    scalarAssigneeId(ticket.assignedTo) ||
    scalarAssigneeId(ticket.assigneeId) ||
    scalarAssigneeId(ticket.assignedToEmail);
  const name = scalarAssigneeName(ticket.agentName) || id;
  if (!id && !name) return null;
  return { id, name };
}

export type AssigneeWriteFields = {
  agentId: string | null;
  agentName: string | null;
  assignedTo: string | null;
  assigneeId: string | null;
  assignedToEmail: string | null;
};

/** Explicit clear — all assignee aliases null; never touches status. */
export function clearAssigneePayload(): AssigneeWriteFields {
  return {
    agentId: null,
    agentName: null,
    assignedTo: null,
    assigneeId: null,
    assignedToEmail: null,
  };
}

/**
 * Normalize an assignee change into the full set of fields the ticket stores.
 * - `null` / sentinel / empty → clear all assignee fields
 * - real id → set id aliases + optional name/email
 * Never includes `status` or other ticket fields.
 */
export function buildAssigneePayload(
  agentId: string | undefined | null,
  agentName?: string | null,
  assignedToEmail?: string | null,
): Partial<AssigneeWriteFields> {
  if (agentId === undefined && agentName === undefined && assignedToEmail === undefined) {
    return {};
  }

  const id = agentId === undefined ? undefined : scalarAssigneeId(agentId);
  const name =
    agentName === undefined ? undefined : scalarAssigneeName(agentName) || null;
  const email =
    assignedToEmail === undefined
      ? undefined
      : isUnassignedSentinel(assignedToEmail)
        ? null
        : String(assignedToEmail).trim() || null;

  // Explicit clear: null/empty/sentinel id (or clear with empty name when id omitted)
  const clearing =
    agentId === null ||
    (typeof agentId === 'string' && !scalarAssigneeId(agentId)) ||
    (agentId === undefined && agentName === null);

  if (clearing || (id !== undefined && !id)) {
    return clearAssigneePayload();
  }

  const payload: Partial<AssigneeWriteFields> = {};
  if (id !== undefined) {
    payload.agentId = id;
    payload.assignedTo = id;
    payload.assigneeId = id;
  }
  if (name !== undefined) payload.agentName = name;
  if (email !== undefined) payload.assignedToEmail = email;
  return payload;
}

/**
 * Server-side: coerce inbound assignee patch so sentinels/`''` become null
 * and a clear always writes all five fields.
 */
export function normalizeAssigneePatchForWrite(
  body: Record<string, unknown>,
): Partial<AssigneeWriteFields> | null {
  const hasAgentId =
    body.agentId !== undefined || body.assignedTo !== undefined || body.assigneeId !== undefined;
  const hasName = body.agentName !== undefined;
  const hasEmail = body.assignedToEmail !== undefined;
  if (!hasAgentId && !hasName && !hasEmail) return null;

  const rawId = hasAgentId ? (body.agentId ?? body.assignedTo ?? body.assigneeId) : undefined;
  return buildAssigneePayload(
    rawId === undefined ? undefined : (rawId as string | null),
    hasName ? (body.agentName as string | null) : undefined,
    hasEmail ? (body.assignedToEmail as string | null) : undefined,
  );
}

/**
 * Read-path hydrate: convert legacy sentinel strings to null in memory.
 * Idempotent; does not touch status or other fields.
 */
export function normalizeTicketAssigneeFields<T extends Record<string, unknown>>(doc: T): T {
  const fields = ['agentId', 'agentName', 'assignedTo', 'assigneeId', 'assignedToEmail'] as const;
  let changed = false;
  const next: Record<string, unknown> = { ...doc };
  for (const field of fields) {
    if (!(field in next)) continue;
    const value = next[field];
    if (typeof value === 'string' && isUnassignedSentinel(value)) {
      next[field] = null;
      changed = true;
    }
  }
  return (changed ? next : doc) as T;
}

function displayedNameMatchesUser(displayed: string, user: TicketAssigneeUser): boolean {
  const n = norm(displayed);
  if (!n) return false;
  const names = identitySet([user.userName, user.userEmail]);
  if (names.has(n)) return true;

  const emailLocal = String(user.userEmail ?? '')
    .split('@')[0]
    ?.trim()
    .toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && (n === emailLocal || n.startsWith(`${emailLocal} `))) {
    return true;
  }

  const userName = norm(user.userName || '');
  if (userName && (n === userName || n.startsWith(`${userName} `) || userName.startsWith(`${n} `))) {
    return true;
  }
  return false;
}

/**
 * True when this ticket belongs in "Mir zugewiesen" for the signed-in agent.
 * Matches assignee id/email against the current user, or the displayed
 * agentName against the current user's name. If the chip shows a different
 * person, the ticket is not treated as mine even when a stale agentId still
 * points at the current user.
 */
export function isTicketAssignedToUser(ticket: Ticket, user: TicketAssigneeUser): boolean {
  const userIds = identitySet([user.userId, user.userEmail]);
  const userNames = identitySet([user.userName, user.userEmail]);
  if (userIds.size === 0 && userNames.size === 0) return false;

  const ids = ticketAssigneeIds(ticket).map(norm);
  const displayedName = scalarAssigneeName(ticket.agentName);
  const idMatches = ids.some((id) => userIds.has(id));
  const nameMatches = displayedName ? displayedNameMatchesUser(displayedName, user) : false;

  if (displayedName && !nameMatches) {
    return false;
  }
  return idMatches || nameMatches;
}
