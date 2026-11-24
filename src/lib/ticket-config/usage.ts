import { queryDb } from '../postgres-backend.js';

export type TicketTaxonomyField = 'status' | 'priority' | 'type' | 'category';

/**
 * Count tickets that reference a taxonomy value.
 * Categories match categoryId / categorySlug / categoryName.
 */
export async function countTicketsUsingValue(
  field: TicketTaxonomyField,
  value: string,
  extras?: { slug?: string; name?: string; id?: string },
): Promise<number> {
  const v = String(value || '').trim();
  if (!v && field !== 'category') return 0;

  if (field === 'category') {
    const id = extras?.id || v;
    const slug = extras?.slug || '';
    const name = extras?.name || '';
    const res = await queryDb(
      `
      SELECT COUNT(*)::int AS c
        FROM geistdesk_documents
       WHERE collection = 'tickets'
         AND (
           data->>'categoryId' = $1
           OR ($2 <> '' AND LOWER(COALESCE(data->>'categorySlug', '')) = LOWER($2))
           OR ($3 <> '' AND LOWER(COALESCE(data->>'categoryName', '')) = LOWER($3))
           OR ($3 <> '' AND LOWER(COALESCE(data->>'category', '')) = LOWER($3))
         )
      `,
      [id, slug, name],
    );
    return Number(res.rows[0]?.c || 0);
  }

  const column =
    field === 'status' ? 'status' : field === 'priority' ? 'priority' : 'type';
  const res = await queryDb(
    `
    SELECT COUNT(*)::int AS c
      FROM geistdesk_documents
     WHERE collection = 'tickets'
       AND LOWER(COALESCE(data->>$1, '')) = LOWER($2)
    `,
    [column, v],
  );
  return Number(res.rows[0]?.c || 0);
}

/** Reassign ticket field from oldKey → newKey. Returns rows updated. */
export async function reassignTicketField(
  field: TicketTaxonomyField,
  fromKey: string,
  toKey: string,
  extras?: { fromId?: string; fromSlug?: string; fromName?: string; toId?: string; toName?: string; toSlug?: string },
): Promise<number> {
  const from = String(fromKey || '').trim();
  const to = String(toKey || '').trim();
  if (!to) throw new Error('Ersatzwert ist erforderlich.');

  if (field === 'category') {
    const fromId = extras?.fromId || from;
    const res = await queryDb(
      `
      UPDATE geistdesk_documents
         SET data = jsonb_set(
               jsonb_set(
                 jsonb_set(data, '{categoryId}', to_jsonb($4::text), true),
                 '{categoryName}', to_jsonb($5::text), true
               ),
               '{categorySlug}', to_jsonb($6::text), true
             ),
             updated_at = NOW()
       WHERE collection = 'tickets'
         AND (
           data->>'categoryId' = $1
           OR ($2 <> '' AND LOWER(COALESCE(data->>'categorySlug', '')) = LOWER($2))
           OR ($3 <> '' AND LOWER(COALESCE(data->>'categoryName', '')) = LOWER($3))
         )
      `,
      [
        fromId,
        extras?.fromSlug || '',
        extras?.fromName || '',
        extras?.toId || to,
        extras?.toName || to,
        extras?.toSlug || to,
      ],
    );
    return res.rowCount ?? 0;
  }

  const column =
    field === 'status' ? 'status' : field === 'priority' ? 'priority' : 'type';
  if (!from) throw new Error('Ursprungswert fehlt.');
  const res = await queryDb(
    `
    UPDATE geistdesk_documents
       SET data = jsonb_set(data, ARRAY[$1::text], to_jsonb($3::text), true),
           updated_at = NOW()
     WHERE collection = 'tickets'
       AND LOWER(COALESCE(data->>$1, '')) = LOWER($2)
    `,
    [column, from, to],
  );
  return res.rowCount ?? 0;
}
