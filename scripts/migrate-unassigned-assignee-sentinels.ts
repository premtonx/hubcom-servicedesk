/**
 * Idempotent migration: normalize legacy assignee sentinels to null.
 * Does NOT change status, priority, category, or audit history beyond the
 * assignee field rewrite (same document update as a normal clear).
 *
 * Dry-run by default. Apply with: APPLY=1 npx tsx scripts/migrate-unassigned-assignee-sentinels.ts
 */

import {
  clearAssigneePayload,
  hasAssignee,
  isUnassignedSentinel,
  normalizeTicketAssigneeFields,
} from '../src/lib/ticketAssignee.ts';

const SENTINEL_FIELDS = [
  'agentId',
  'agentName',
  'assignedTo',
  'assigneeId',
  'assignedToEmail',
] as const;

function needsMigration(doc: Record<string, unknown>): boolean {
  for (const field of SENTINEL_FIELDS) {
    const value = doc[field];
    if (typeof value === 'string' && isUnassignedSentinel(value)) return true;
  }
  // Fully empty-of-real-assignee but with leftover empty strings
  if (
    !hasAssignee({
      agentId: doc.agentId as string | null,
      agentName: doc.agentName as string | null,
      assignedTo: doc.assignedTo as string | null,
      assigneeId: doc.assigneeId as string | null,
      assignedToEmail: doc.assignedToEmail as string | null,
    })
  ) {
    return SENTINEL_FIELDS.some((f) => typeof doc[f] === 'string' && String(doc[f]).trim() !== '');
  }
  return false;
}

function buildClearPatch(doc: Record<string, unknown>): Record<string, string | null> {
  const normalized = normalizeTicketAssigneeFields({ ...doc });
  if (
    !hasAssignee({
      agentId: normalized.agentId as string | null,
      agentName: normalized.agentName as string | null,
      assignedTo: normalized.assignedTo as string | null,
      assigneeId: normalized.assigneeId as string | null,
      assignedToEmail: normalized.assignedToEmail as string | null,
    })
  ) {
    return { ...clearAssigneePayload() };
  }
  // Only null the sentinel string fields; keep real assignee values.
  const patch: Record<string, string | null> = {};
  for (const field of SENTINEL_FIELDS) {
    const value = doc[field];
    if (typeof value === 'string' && isUnassignedSentinel(value)) {
      patch[field] = null;
    }
  }
  return patch;
}

async function main() {
  const apply = process.env.APPLY === '1';
  const { getDocsDirect, updateDocDirect } = await import('../src/lib/postgres-backend.ts');

  const tickets = await getDocsDirect('tickets', []);
  let candidates = 0;
  let updated = 0;

  for (const raw of tickets) {
    const doc = raw as Record<string, unknown>;
    const id = String(doc.id || '');
    if (!id || !needsMigration(doc)) continue;
    candidates += 1;
    const statusBefore = doc.status;
    const patch = buildClearPatch(doc);
    if (Object.keys(patch).length === 0) continue;

    console.log(
      `${apply ? 'APPLY' : 'DRY'} ${id}: ${JSON.stringify(patch)} (status stays ${JSON.stringify(statusBefore)})`,
    );

    if (apply) {
      await updateDocDirect('tickets', id, patch);
      updated += 1;
    }
  }

  console.log(
    `\nDone. candidates=${candidates} updated=${apply ? updated : 0} mode=${apply ? 'APPLY' : 'DRY-RUN'}`,
  );
  if (!apply && candidates > 0) {
    console.log('Re-run with APPLY=1 to persist null clears.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
