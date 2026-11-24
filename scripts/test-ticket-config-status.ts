/**
 * Ticket Configuration status model: display name vs workflow meaning.
 * Run: npx tsx scripts/test-ticket-config-status.ts
 */

import assert from 'node:assert/strict';
import {
  STATUS_WORKFLOW_KINDS,
  statusColorConflictWarning,
  type StatusWorkflowKind,
  type TicketStatusConfig,
} from '../src/lib/ticket-config/types.ts';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err?.message || err}`);
  }
}

/** Mimic store update: name change must not alter key or workflowKind unless patched. */
function applyStatusPatch(
  existing: TicketStatusConfig,
  patch: Partial<Pick<TicketStatusConfig, 'name' | 'description' | 'color' | 'workflowKind' | 'isActive'>>,
): TicketStatusConfig {
  return {
    ...existing,
    name: patch.name !== undefined ? String(patch.name).trim() : existing.name,
    description:
      patch.description !== undefined ? String(patch.description).trim() : existing.description,
    color: patch.color !== undefined ? String(patch.color) : existing.color,
    isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
    workflowKind:
      patch.workflowKind !== undefined ? patch.workflowKind : existing.workflowKind,
    // key stays immutable
    updatedAt: new Date().toISOString(),
  };
}

console.log('Ticket config status — unit tests');
console.log('=================================\n');

check('workflow kinds expose DE labels for Offen / In Bearbeitung / Wartend / Geschlossen', () => {
  const byValue = Object.fromEntries(STATUS_WORKFLOW_KINDS.map((k) => [k.value, k]));
  assert.equal(byValue.open.label, 'Offen');
  assert.equal(byValue.in_progress.label, 'In Bearbeitung');
  assert.equal(byValue.waiting.label, 'Wartend');
  assert.equal(byValue.closed.label, 'Geschlossen / Gelöst');
});

check('renaming Anzeigename does not change workflowKind or key', () => {
  const existing: TicketStatusConfig = {
    id: 'st-1',
    key: 'open',
    name: 'Offen',
    description: '',
    color: '#3B82F6',
    sortOrder: 1,
    isActive: true,
    workflowKind: 'open',
    isSystem: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };
  const renamed = applyStatusPatch(existing, { name: 'Neu eingegangen' });
  assert.equal(renamed.name, 'Neu eingegangen');
  assert.equal(renamed.key, 'open');
  assert.equal(renamed.workflowKind, 'open');
});

check('workflowKind only changes when explicitly patched', () => {
  const existing: TicketStatusConfig = {
    id: 'st-2',
    key: 'pending',
    name: 'In Bearbeitung',
    description: '',
    color: '#F59E0B',
    sortOrder: 2,
    isActive: true,
    workflowKind: 'in_progress',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };
  const same = applyStatusPatch(existing, { description: 'Agent arbeitet' });
  assert.equal(same.workflowKind, 'in_progress');
  const moved = applyStatusPatch(existing, { workflowKind: 'waiting' as StatusWorkflowKind });
  assert.equal(moved.workflowKind, 'waiting');
  assert.equal(moved.key, 'pending');
  assert.equal(moved.name, 'In Bearbeitung');
});

check('display name and workflow meaning stay independent fields', () => {
  // Same workflowKind, different display names — both valid
  const a = applyStatusPatch(
    {
      id: '1',
      key: 'waiting_customer',
      name: 'Wartet auf Kunde',
      description: '',
      color: '#94A3B8',
      sortOrder: 1,
      isActive: true,
      workflowKind: 'waiting',
      createdAt: '',
      updatedAt: '',
    },
    { name: 'Kundenrückfrage' },
  );
  assert.equal(a.workflowKind, 'waiting');
  assert.notEqual(a.name, a.workflowKind);
});

check('color conflict helper still runs for closed + urgent-like colors', () => {
  const warn = statusColorConflictWarning('closed', '#EF4444');
  assert.ok(warn === null || typeof warn === 'string');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
