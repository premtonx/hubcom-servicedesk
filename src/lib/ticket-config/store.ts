import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  queryDb,
  setDocDirect,
} from '../postgres-backend.js';
import { countTicketsUsingValue, reassignTicketField } from './usage.js';
import {
  DEFAULT_TICKET_PRIORITIES,
  DEFAULT_TICKET_STATUSES,
  DEFAULT_TICKET_TYPES,
  TICKET_PRIORITIES_COLLECTION,
  TICKET_STATUSES_COLLECTION,
  TICKET_TYPES_COLLECTION,
  slugifyConfigKey,
  type StatusWorkflowKind,
  type TicketPriorityConfig,
  type TicketPriorityConfigInput,
  type TicketStatusConfig,
  type TicketStatusConfigInput,
  type TicketTypeConfig,
  type TicketTypeConfigInput,
} from './types.js';

function nowIso() {
  return new Date().toISOString();
}

function normalizeWorkflow(raw: unknown): StatusWorkflowKind {
  const v = String(raw || '').trim();
  if (v === 'open' || v === 'in_progress' || v === 'waiting' || v === 'closed') return v;
  if (v === 'resolved' || v === 'done') return 'closed';
  if (v === 'pending' || v === 'on_hold' || v === 'on-hold') return 'waiting';
  return 'open';
}

function normalizeStatus(id: string, data: Record<string, unknown>): TicketStatusConfig {
  const name = String(data.name || '').trim() || 'Unbenannt';
  const key = String(data.key || slugifyConfigKey(name));
  return {
    id,
    key,
    name,
    description: String(data.description || ''),
    color: String(data.color || '#3B82F6'),
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 100,
    isActive: data.isActive !== false,
    workflowKind: normalizeWorkflow(data.workflowKind),
    isSystem: data.isSystem === true,
    createdAt: String(data.createdAt || nowIso()),
    updatedAt: String(data.updatedAt || data.createdAt || nowIso()),
  };
}

function normalizePriority(id: string, data: Record<string, unknown>): TicketPriorityConfig {
  const name = String(data.name || '').trim() || 'Unbenannt';
  return {
    id,
    key: String(data.key || slugifyConfigKey(name)),
    name,
    description: String(data.description || ''),
    color: String(data.color || '#94A3B8'),
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 100,
    isActive: data.isActive !== false,
    isSystem: data.isSystem === true,
    createdAt: String(data.createdAt || nowIso()),
    updatedAt: String(data.updatedAt || data.createdAt || nowIso()),
  };
}

function normalizeType(id: string, data: Record<string, unknown>): TicketTypeConfig {
  const name = String(data.name || '').trim() || 'Unbenannt';
  return {
    id,
    key: String(data.key || slugifyConfigKey(name)),
    name,
    description: String(data.description || ''),
    color: String(data.color || '#3B82F6'),
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 100,
    isActive: data.isActive !== false,
    isSystem: data.isSystem === true,
    createdAt: String(data.createdAt || nowIso()),
    updatedAt: String(data.updatedAt || data.createdAt || nowIso()),
  };
}

async function ensureUniqueKey(
  collection: string,
  key: string,
  exceptId?: string,
): Promise<string> {
  const rows = await getDocsDirect(collection, []);
  const used = new Set(
    rows
      .filter((r) => r.id !== exceptId)
      .map((r) => String((r as any).key || '').toLowerCase()),
  );
  let candidate = key;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${key}_${i}`;
    i += 1;
  }
  return candidate;
}

// ─── Statuses ───────────────────────────────────────────────────────────────

export async function listTicketStatuses(options?: {
  activeOnly?: boolean;
}): Promise<TicketStatusConfig[]> {
  const rows = await getDocsDirect(TICKET_STATUSES_COLLECTION, []);
  let items = rows.map((r) => normalizeStatus(String(r.id), r as Record<string, unknown>));
  if (options?.activeOnly) items = items.filter((s) => s.isActive);
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function getTicketStatus(id: string): Promise<TicketStatusConfig | null> {
  const row = await getDocDirect(TICKET_STATUSES_COLLECTION, id);
  if (!row) return null;
  return normalizeStatus(id, row as Record<string, unknown>);
}

export async function createTicketStatus(
  input: TicketStatusConfigInput,
): Promise<TicketStatusConfig> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name ist erforderlich.');
  const existing = await listTicketStatuses();
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const key = await ensureUniqueKey(
    TICKET_STATUSES_COLLECTION,
    slugifyConfigKey(input.key || name),
  );
  const now = nowIso();
  const payload = {
    key,
    name,
    description: String(input.description || '').trim(),
    color: String(input.color || '#3B82F6'),
    sortOrder: input.sortOrder ?? maxOrder + 10,
    isActive: input.isActive !== false,
    workflowKind: normalizeWorkflow(input.workflowKind || 'open'),
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };
  const created = await addDocDirect(TICKET_STATUSES_COLLECTION, payload);
  return normalizeStatus(String(created.id), { ...payload, id: created.id });
}

export async function updateTicketStatus(
  id: string,
  patch: Partial<TicketStatusConfigInput> & { replacementKey?: string },
): Promise<TicketStatusConfig> {
  const existing = await getTicketStatus(id);
  if (!existing) throw new Error('Status nicht gefunden.');
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Name ist erforderlich.');

  const nextActive =
    patch.isActive !== undefined ? patch.isActive !== false : existing.isActive;

  if (existing.isActive && !nextActive) {
    const usage = await countTicketsUsingValue('status', existing.key);
    if (usage > 0) {
      const replacementKey = String(patch.replacementKey || '').trim();
      if (!replacementKey || replacementKey === existing.key) {
        const err: any = new Error(
          `${usage} Ticket(s) nutzen diesen Status. Bitte einen Ersatzstatus wählen, bevor er deaktiviert wird.`,
        );
        err.code = 'REPLACEMENT_REQUIRED';
        err.usageCount = usage;
        throw err;
      }
      await reassignTicketField('status', existing.key, replacementKey);
    }
  }

  const next: TicketStatusConfig = {
    ...existing,
    name,
    // key stays immutable to protect ticket data
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    color: patch.color !== undefined ? String(patch.color) : existing.color,
    sortOrder:
      patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))
        ? Number(patch.sortOrder)
        : existing.sortOrder,
    isActive: nextActive,
    workflowKind:
      patch.workflowKind !== undefined
        ? normalizeWorkflow(patch.workflowKind)
        : existing.workflowKind,
    updatedAt: nowIso(),
  };
  await setDocDirect(TICKET_STATUSES_COLLECTION, id, next);
  return next;
}

export async function deleteTicketStatus(
  id: string,
  replacementKey?: string,
): Promise<{ ok: true; reassigned: number }> {
  const existing = await getTicketStatus(id);
  if (!existing) throw new Error('Status nicht gefunden.');
  const usage = await countTicketsUsingValue('status', existing.key);
  let reassigned = 0;
  if (usage > 0) {
    const rep = String(replacementKey || '').trim();
    if (!rep || rep === existing.key) {
      const err: any = new Error(
        `${usage} Ticket(s) nutzen diesen Status. Bitte einen Ersatzstatus wählen.`,
      );
      err.code = 'REPLACEMENT_REQUIRED';
      err.usageCount = usage;
      throw err;
    }
    reassigned = await reassignTicketField('status', existing.key, rep);
  }
  await deleteDocDirect(TICKET_STATUSES_COLLECTION, id);
  return { ok: true, reassigned };
}

// ─── Priorities ─────────────────────────────────────────────────────────────

export async function listTicketPriorities(options?: {
  activeOnly?: boolean;
}): Promise<TicketPriorityConfig[]> {
  const rows = await getDocsDirect(TICKET_PRIORITIES_COLLECTION, []);
  let items = rows.map((r) => normalizePriority(String(r.id), r as Record<string, unknown>));
  if (options?.activeOnly) items = items.filter((s) => s.isActive);
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function getTicketPriority(id: string): Promise<TicketPriorityConfig | null> {
  const row = await getDocDirect(TICKET_PRIORITIES_COLLECTION, id);
  if (!row) return null;
  return normalizePriority(id, row as Record<string, unknown>);
}

export async function createTicketPriority(
  input: TicketPriorityConfigInput,
): Promise<TicketPriorityConfig> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name ist erforderlich.');
  const existing = await listTicketPriorities();
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const key = await ensureUniqueKey(
    TICKET_PRIORITIES_COLLECTION,
    slugifyConfigKey(input.key || name),
  );
  const now = nowIso();
  const payload = {
    key,
    name,
    description: String(input.description || '').trim(),
    color: String(input.color || '#94A3B8'),
    sortOrder: input.sortOrder ?? maxOrder + 10,
    isActive: input.isActive !== false,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };
  const created = await addDocDirect(TICKET_PRIORITIES_COLLECTION, payload);
  return normalizePriority(String(created.id), { ...payload, id: created.id });
}

export async function updateTicketPriority(
  id: string,
  patch: Partial<TicketPriorityConfigInput> & { replacementKey?: string },
): Promise<TicketPriorityConfig> {
  const existing = await getTicketPriority(id);
  if (!existing) throw new Error('Priorität nicht gefunden.');
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Name ist erforderlich.');
  const nextActive =
    patch.isActive !== undefined ? patch.isActive !== false : existing.isActive;

  if (existing.isActive && !nextActive) {
    const usage = await countTicketsUsingValue('priority', existing.key);
    if (usage > 0) {
      const replacementKey = String(patch.replacementKey || '').trim();
      if (!replacementKey || replacementKey === existing.key) {
        const err: any = new Error(
          `${usage} Ticket(s) nutzen diese Priorität. Bitte eine Ersatzpriorität wählen.`,
        );
        err.code = 'REPLACEMENT_REQUIRED';
        err.usageCount = usage;
        throw err;
      }
      await reassignTicketField('priority', existing.key, replacementKey);
    }
  }

  const next: TicketPriorityConfig = {
    ...existing,
    name,
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    color: patch.color !== undefined ? String(patch.color) : existing.color,
    sortOrder:
      patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))
        ? Number(patch.sortOrder)
        : existing.sortOrder,
    isActive: nextActive,
    updatedAt: nowIso(),
  };
  await setDocDirect(TICKET_PRIORITIES_COLLECTION, id, next);
  return next;
}

export async function deleteTicketPriority(
  id: string,
  replacementKey?: string,
): Promise<{ ok: true; reassigned: number }> {
  const existing = await getTicketPriority(id);
  if (!existing) throw new Error('Priorität nicht gefunden.');
  const usage = await countTicketsUsingValue('priority', existing.key);
  let reassigned = 0;
  if (usage > 0) {
    const rep = String(replacementKey || '').trim();
    if (!rep || rep === existing.key) {
      const err: any = new Error(
        `${usage} Ticket(s) nutzen diese Priorität. Bitte eine Ersatzpriorität wählen.`,
      );
      err.code = 'REPLACEMENT_REQUIRED';
      err.usageCount = usage;
      throw err;
    }
    reassigned = await reassignTicketField('priority', existing.key, rep);
  }
  await deleteDocDirect(TICKET_PRIORITIES_COLLECTION, id);
  return { ok: true, reassigned };
}

// ─── Types ──────────────────────────────────────────────────────────────────

export async function listTicketTypes(options?: {
  activeOnly?: boolean;
}): Promise<TicketTypeConfig[]> {
  const rows = await getDocsDirect(TICKET_TYPES_COLLECTION, []);
  let items = rows.map((r) => normalizeType(String(r.id), r as Record<string, unknown>));
  if (options?.activeOnly) items = items.filter((s) => s.isActive);
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function getTicketType(id: string): Promise<TicketTypeConfig | null> {
  const row = await getDocDirect(TICKET_TYPES_COLLECTION, id);
  if (!row) return null;
  return normalizeType(id, row as Record<string, unknown>);
}

export async function createTicketType(input: TicketTypeConfigInput): Promise<TicketTypeConfig> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name ist erforderlich.');
  const existing = await listTicketTypes();
  const maxOrder = existing.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  const key = await ensureUniqueKey(
    TICKET_TYPES_COLLECTION,
    slugifyConfigKey(input.key || name),
  );
  const now = nowIso();
  const payload = {
    key,
    name,
    description: String(input.description || '').trim(),
    color: String(input.color || '#3B82F6'),
    sortOrder: input.sortOrder ?? maxOrder + 10,
    isActive: input.isActive !== false,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };
  const created = await addDocDirect(TICKET_TYPES_COLLECTION, payload);
  return normalizeType(String(created.id), { ...payload, id: created.id });
}

export async function updateTicketType(
  id: string,
  patch: Partial<TicketTypeConfigInput> & { replacementKey?: string },
): Promise<TicketTypeConfig> {
  const existing = await getTicketType(id);
  if (!existing) throw new Error('Ticket-Typ nicht gefunden.');
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Name ist erforderlich.');
  const nextActive =
    patch.isActive !== undefined ? patch.isActive !== false : existing.isActive;

  if (existing.isActive && !nextActive) {
    const usage = await countTicketsUsingValue('type', existing.key);
    if (usage > 0) {
      const replacementKey = String(patch.replacementKey || '').trim();
      if (!replacementKey || replacementKey === existing.key) {
        const err: any = new Error(
          `${usage} Ticket(s) nutzen diesen Typ. Bitte einen Ersatztyp wählen.`,
        );
        err.code = 'REPLACEMENT_REQUIRED';
        err.usageCount = usage;
        throw err;
      }
      await reassignTicketField('type', existing.key, replacementKey);
    }
  }

  const next: TicketTypeConfig = {
    ...existing,
    name,
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    color: patch.color !== undefined ? String(patch.color) : existing.color,
    sortOrder:
      patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))
        ? Number(patch.sortOrder)
        : existing.sortOrder,
    isActive: nextActive,
    updatedAt: nowIso(),
  };
  await setDocDirect(TICKET_TYPES_COLLECTION, id, next);
  return next;
}

export async function deleteTicketType(
  id: string,
  replacementKey?: string,
): Promise<{ ok: true; reassigned: number }> {
  const existing = await getTicketType(id);
  if (!existing) throw new Error('Ticket-Typ nicht gefunden.');
  const usage = await countTicketsUsingValue('type', existing.key);
  let reassigned = 0;
  if (usage > 0) {
    const rep = String(replacementKey || '').trim();
    if (!rep || rep === existing.key) {
      const err: any = new Error(
        `${usage} Ticket(s) nutzen diesen Typ. Bitte einen Ersatztyp wählen.`,
      );
      err.code = 'REPLACEMENT_REQUIRED';
      err.usageCount = usage;
      throw err;
    }
    reassigned = await reassignTicketField('type', existing.key, rep);
  }
  await deleteDocDirect(TICKET_TYPES_COLLECTION, id);
  return { ok: true, reassigned };
}

// ─── Seed ───────────────────────────────────────────────────────────────────

async function seedCollection(
  collection: string,
  defaults: Array<Record<string, unknown>>,
  label: string,
): Promise<number> {
  try {
    const countRes = await queryDb(
      `SELECT COUNT(*)::int AS c FROM geistdesk_documents WHERE collection = $1`,
      [collection],
    );
    if (Number(countRes.rows[0]?.c || 0) > 0) return 0;
    const now = nowIso();
    let created = 0;
    for (const def of defaults) {
      await addDocDirect(collection, { ...def, createdAt: now, updatedAt: now });
      created += 1;
    }
    console.info(`[ticket-config] ${created} Standard-${label} angelegt.`);
    return created;
  } catch (err) {
    console.warn(`[ticket-config] Seed ${label} fehlgeschlagen:`, err);
    return 0;
  }
}

export async function ensureDefaultTicketConfig(): Promise<{
  statuses: number;
  priorities: number;
  types: number;
}> {
  const statuses = await seedCollection(
    TICKET_STATUSES_COLLECTION,
    DEFAULT_TICKET_STATUSES as any,
    'Status',
  );
  const priorities = await seedCollection(
    TICKET_PRIORITIES_COLLECTION,
    DEFAULT_TICKET_PRIORITIES as any,
    'Prioritäten',
  );
  const types = await seedCollection(
    TICKET_TYPES_COLLECTION,
    DEFAULT_TICKET_TYPES as any,
    'Typen',
  );
  return { statuses, priorities, types };
}

export async function getUsageForItem(
  kind: 'status' | 'priority' | 'type',
  key: string,
): Promise<number> {
  return countTicketsUsingValue(kind, key);
}
