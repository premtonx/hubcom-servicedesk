/**
 * Kanban lane mapping — Wartend is its own column; Gelöst maps resolved/closed.
 * Run: npx tsx scripts/test-ticket-kanban-status.ts
 */

import assert from 'node:assert/strict';
import {
  KANBAN_LANES,
  kanbanLaneToTicketStatus,
  normalizeKanbanStatus,
} from '../src/lib/ticket-kanban-status.ts';

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

console.log('Ticket Kanban status — unit tests');
console.log('=================================\n');

check('maps open variants to offen', () => {
  assert.equal(normalizeKanbanStatus('open'), 'offen');
  assert.equal(normalizeKanbanStatus('Offen'), 'offen');
  assert.equal(normalizeKanbanStatus('+ New'), 'offen');
});

check('maps waiting to wartend (not in_bearbeitung)', () => {
  assert.equal(normalizeKanbanStatus('waiting'), 'wartend');
  assert.equal(normalizeKanbanStatus('Wartend'), 'wartend');
  assert.equal(normalizeKanbanStatus('on_hold'), 'wartend');
});

check('maps pending / in progress to in_bearbeitung', () => {
  assert.equal(normalizeKanbanStatus('pending'), 'in_bearbeitung');
  assert.equal(normalizeKanbanStatus('in_progress'), 'in_bearbeitung');
});

check('maps resolved and closed to geloest', () => {
  assert.equal(normalizeKanbanStatus('resolved'), 'geloest');
  assert.equal(normalizeKanbanStatus('closed'), 'geloest');
  assert.equal(normalizeKanbanStatus('Gelöst'), 'geloest');
});

check('writes canonical statuses for all four lanes', () => {
  assert.equal(kanbanLaneToTicketStatus('offen'), 'open');
  assert.equal(kanbanLaneToTicketStatus('in_bearbeitung'), 'pending');
  assert.equal(kanbanLaneToTicketStatus('wartend'), 'on_hold');
  assert.equal(kanbanLaneToTicketStatus('geloest'), 'resolved');
});

check('exposes four lanes matching real statuses', () => {
  assert.deepEqual(
    KANBAN_LANES.map((l) => l.id),
    ['offen', 'in_bearbeitung', 'wartend', 'geloest'],
  );
});

/** Mirrors TicketListView pagination range (1-based, empty → 0). */
function paginationRange(total: number, page: number, pageSize: number) {
  if (total === 0) return { startIdx: 0, endIdx: 0 };
  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, total);
  return { startIdx, endIdx };
}

check('pagination is 1-based (Zeige 1 bis 3 von 3)', () => {
  assert.deepEqual(paginationRange(3, 1, 25), { startIdx: 1, endIdx: 3 });
  assert.deepEqual(paginationRange(3, 2, 2), { startIdx: 3, endIdx: 3 });
  assert.deepEqual(paginationRange(0, 1, 25), { startIdx: 0, endIdx: 0 });
  assert.deepEqual(paginationRange(1, 1, 25), { startIdx: 1, endIdx: 1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
