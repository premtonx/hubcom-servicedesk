import {
  addDocDirect,
  deleteDocDirect,
  getDocDirect,
  getDocsDirect,
  queryDb,
  setDocDirect,
} from '../postgres-backend.js';
import { withSystemTenantContext } from '../security/tenant-rls.js';
import {
  countTicketsUsingValue,
  reassignTicketField,
} from '../ticket-config/usage.js';
import {
  DEFAULT_TICKET_CATEGORIES,
  TICKET_CATEGORIES_COLLECTION,
  type TicketCategory,
  type TicketCategoryInput,
} from './types.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'kategorie';
}

function normalize(id: string, data: Record<string, unknown>): TicketCategory {
  const name = String(data.name || '').trim() || 'Unbenannt';
  return {
    id,
    name,
    slug: String(data.slug || slugify(name)),
    description: String(data.description || ''),
    color: String(data.color || '#1B6CA8'),
    sortOrder: Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 100,
    isActive: data.isActive !== false,
    createdAt: String(data.createdAt || new Date().toISOString()),
    updatedAt: String(data.updatedAt || data.createdAt || new Date().toISOString()),
  };
}

export async function listTicketCategories(options?: {
  activeOnly?: boolean;
}): Promise<TicketCategory[]> {
  const rows = await getDocsDirect(TICKET_CATEGORIES_COLLECTION, []);
  let items = rows.map((row) => normalize(String(row.id), row as Record<string, unknown>));
  if (options?.activeOnly) {
    items = items.filter((c) => c.isActive);
  }
  return items.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function getTicketCategory(id: string): Promise<TicketCategory | null> {
  const row = await getDocDirect(TICKET_CATEGORIES_COLLECTION, id);
  if (!row) return null;
  return normalize(id, row as Record<string, unknown>);
}

export async function createTicketCategory(input: TicketCategoryInput): Promise<TicketCategory> {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Name ist erforderlich.');
  const now = new Date().toISOString();
  const existing = await listTicketCategories();
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), 0);
  const payload = {
    name,
    slug: input.slug?.trim() || slugify(name),
    description: String(input.description || '').trim(),
    color: String(input.color || '#1B6CA8'),
    sortOrder: input.sortOrder ?? maxOrder + 10,
    isActive: input.isActive !== false,
    createdAt: now,
    updatedAt: now,
  };
  const created = await addDocDirect(TICKET_CATEGORIES_COLLECTION, payload);
  return normalize(String(created.id), { ...payload, id: created.id });
}

export async function updateTicketCategory(
  id: string,
  patch: Partial<TicketCategoryInput> & { replacementId?: string },
): Promise<TicketCategory> {
  const existing = await getTicketCategory(id);
  if (!existing) throw new Error('Kategorie nicht gefunden.');
  const now = new Date().toISOString();
  const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!name) throw new Error('Name ist erforderlich.');
  const nextActive =
    patch.isActive !== undefined ? patch.isActive !== false : existing.isActive;

  if (existing.isActive && !nextActive) {
    const usage = await countTicketsUsingValue('category', existing.id, {
      id: existing.id,
      slug: existing.slug,
      name: existing.name,
    });
    if (usage > 0) {
      const replacementId = String(patch.replacementId || '').trim();
      if (!replacementId || replacementId === existing.id) {
        const err: any = new Error(
          `${usage} Ticket(s) nutzen diese Kategorie. Bitte eine Ersatzkategorie wählen, bevor sie deaktiviert wird.`,
        );
        err.code = 'REPLACEMENT_REQUIRED';
        err.usageCount = usage;
        throw err;
      }
      const replacement = await getTicketCategory(replacementId);
      if (!replacement) throw new Error('Ersatzkategorie nicht gefunden.');
      await reassignTicketField('category', existing.id, replacement.id, {
        fromId: existing.id,
        fromSlug: existing.slug,
        fromName: existing.name,
        toId: replacement.id,
        toName: replacement.name,
        toSlug: replacement.slug,
      });
    }
  }

  const next: TicketCategory = {
    ...existing,
    name,
    slug: patch.slug?.trim() || (patch.name ? slugify(name) : existing.slug),
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    color: patch.color !== undefined ? String(patch.color) : existing.color,
    sortOrder:
      patch.sortOrder !== undefined && Number.isFinite(Number(patch.sortOrder))
        ? Number(patch.sortOrder)
        : existing.sortOrder,
    isActive: nextActive,
    updatedAt: now,
  };
  await setDocDirect(TICKET_CATEGORIES_COLLECTION, id, next);
  return next;
}

export async function deleteTicketCategory(
  id: string,
  replacementId?: string,
): Promise<{ ok: true; reassigned: number }> {
  const existing = await getTicketCategory(id);
  if (!existing) throw new Error('Kategorie nicht gefunden.');
  const usage = await countTicketsUsingValue('category', existing.id, {
    id: existing.id,
    slug: existing.slug,
    name: existing.name,
  });
  let reassigned = 0;
  if (usage > 0) {
    const repId = String(replacementId || '').trim();
    if (!repId || repId === existing.id) {
      const err: any = new Error(
        `${usage} Ticket(s) nutzen diese Kategorie. Bitte eine Ersatzkategorie wählen.`,
      );
      err.code = 'REPLACEMENT_REQUIRED';
      err.usageCount = usage;
      throw err;
    }
    const replacement = await getTicketCategory(repId);
    if (!replacement) throw new Error('Ersatzkategorie nicht gefunden.');
    reassigned = await reassignTicketField('category', existing.id, replacement.id, {
      fromId: existing.id,
      fromSlug: existing.slug,
      fromName: existing.name,
      toId: replacement.id,
      toName: replacement.name,
      toSlug: replacement.slug,
    });
  }
  await deleteDocDirect(TICKET_CATEGORIES_COLLECTION, id);
  return { ok: true, reassigned };
}

export async function getTicketCategoryUsage(id: string): Promise<number> {
  const existing = await getTicketCategory(id);
  if (!existing) return 0;
  return countTicketsUsingValue('category', existing.id, {
    id: existing.id,
    slug: existing.slug,
    name: existing.name,
  });
}

/** Legt Standard-Kategorien an, falls die Collection leer ist. */
export async function ensureDefaultTicketCategories(): Promise<number> {
  try {
    return await withSystemTenantContext(async () => {
      const countRes = await queryDb(
        `SELECT COUNT(*)::int AS c FROM geistdesk_documents WHERE collection = $1`,
        [TICKET_CATEGORIES_COLLECTION],
      );
      const count = Number(countRes.rows[0]?.c || 0);
      if (count > 0) return 0;

      const now = new Date().toISOString();
      let created = 0;
      for (const def of DEFAULT_TICKET_CATEGORIES) {
        await addDocDirect(TICKET_CATEGORIES_COLLECTION, {
          ...def,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
      console.info(`[ticket-categories] ${created} Standard-Kategorien angelegt.`);
      return created;
    });
  } catch (err) {
    console.warn('[ticket-categories] Seed fehlgeschlagen:', err);
    return 0;
  }
}
