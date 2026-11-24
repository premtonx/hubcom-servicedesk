/**
 * Canonical assignee / “Nicht zugewiesen” semantics.
 * Run: npx tsx scripts/test-ticket-assignee.ts
 */

import assert from 'node:assert/strict';
import {
  buildAssigneePayload,
  clearAssigneePayload,
  hasAssignee,
  isUnassignedSentinel,
  normalizeAssigneePatchForWrite,
  normalizeTicketAssigneeFields,
  resolveTicketAssignee,
  scalarAssigneeId,
} from '../src/lib/ticketAssignee.ts';
import {
  filterTicketsByView,
  isUnassignedTicket,
  type TicketViewFilterContext,
} from '../src/lib/ticketViewFilters.ts';
import type { Ticket } from '../src/types/index.ts';

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

function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    subject: 'Test',
    status: 'open',
    priority: 'medium',
    ...partial,
  } as Ticket;
}

const emptyCtx: TicketViewFilterContext = {
  userId: 'agent-1',
  userEmail: 'a@hubcom.de',
  userName: 'Agent',
  watchedTicketIds: [],
  allTickets: [],
  isAiReady: false,
};

console.log('Ticket assignee — unit tests');
console.log('============================\n');

check('clearAssigneePayload nulls all assignee fields and omits status', () => {
  const clear = clearAssigneePayload();
  assert.deepEqual(clear, {
    agentId: null,
    agentName: null,
    assignedTo: null,
    assigneeId: null,
    assignedToEmail: null,
  });
  assert.equal('status' in clear, false);
});

check('buildAssigneePayload assigns a real user without touching status', () => {
  const payload = buildAssigneePayload('agent-1', 'Agent One', 'a@hubcom.de');
  assert.equal(payload.agentId, 'agent-1');
  assert.equal(payload.assignedTo, 'agent-1');
  assert.equal(payload.assigneeId, 'agent-1');
  assert.equal(payload.agentName, 'Agent One');
  assert.equal(payload.assignedToEmail, 'a@hubcom.de');
  assert.equal('status' in payload, false);
});

check('buildAssigneePayload clears on null and on sentinel strings', () => {
  assert.deepEqual(buildAssigneePayload(null, null), clearAssigneePayload());
  assert.deepEqual(buildAssigneePayload('unassigned', 'Nicht zugewiesen'), clearAssigneePayload());
  assert.deepEqual(buildAssigneePayload('', ''), clearAssigneePayload());
  assert.deepEqual(buildAssigneePayload('nicht-zugewiesen'), clearAssigneePayload());
});

check('normalizeAssigneePatchForWrite treats empty string like null clear', () => {
  const patch = normalizeAssigneePatchForWrite({ agentId: '', agentName: '' });
  assert.ok(patch);
  assert.deepEqual(patch, clearAssigneePayload());
});

check('hasAssignee / resolveTicketAssignee ignore legacy sentinels', () => {
  const legacy = ticket({
    id: 't1',
    status: 'pending',
    agentId: 'unassigned',
    agentName: 'Nicht zugewiesen',
    assignedTo: 'nicht-zugewiesen',
  });
  assert.equal(hasAssignee(legacy), false);
  assert.equal(resolveTicketAssignee(legacy), null);
  assert.equal(isUnassignedTicket(legacy), true);
});

check('assign then clear leaves status unchanged and appears once in unassigned view', () => {
  const status = 'in_progress';
  let current = ticket({
    id: 't2',
    status,
    agentId: null,
    agentName: null,
  });
  assert.equal(isUnassignedTicket(current), true);

  const assigned = { ...current, ...buildAssigneePayload('agent-9', 'Pat') };
  assert.equal(assigned.status, status);
  assert.equal(hasAssignee(assigned), true);
  assert.equal(isUnassignedTicket(assigned), false);

  const cleared = { ...assigned, ...buildAssigneePayload(null, null) };
  assert.equal(cleared.status, status);
  assert.equal(hasAssignee(cleared), false);
  assert.equal(isUnassignedTicket(cleared), true);

  const pool = [
    cleared,
    ticket({ id: 't3', status: 'open', agentId: 'agent-1', agentName: 'A' }),
    ticket({ id: 't4', status: 'resolved', agentId: null }),
  ];
  const view = filterTicketsByView(pool, 'unassigned', emptyCtx);
  assert.deepEqual(
    view.map((t) => t.id),
    ['t2'],
  );
});

check('list unassigned count agrees with hasAssignee predicate', () => {
  const fixtures = [
    ticket({ id: 'a', status: 'open', agentId: 'agent-1', agentName: 'A' }),
    ticket({ id: 'b', status: 'open', agentId: 'unassigned' }),
    ticket({ id: 'c', status: 'pending', agentId: null, agentName: null }),
    ticket({ id: 'd', status: 'open', agentId: '', agentName: 'nicht zugewiesen' }),
    ticket({ id: 'e', status: 'closed', agentId: null }),
  ];
  const viaHas = fixtures.filter((t) => isUnassignedTicket(t));
  const viaView = filterTicketsByView(fixtures, 'unassigned', emptyCtx);
  assert.deepEqual(
    viaHas.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  assert.deepEqual(
    viaView.map((t) => t.id).sort(),
    ['b', 'c', 'd'],
  );
});

check('normalizeTicketAssigneeFields is idempotent and preserves status', () => {
  const raw = {
    id: 'x',
    status: 'open',
    priority: 'high',
    agentId: 'Unassigned',
    agentName: 'nicht-zugewiesen',
    assignedTo: '',
  };
  const once = normalizeTicketAssigneeFields(raw);
  const twice = normalizeTicketAssigneeFields(once);
  assert.equal(once.status, 'open');
  assert.equal(once.priority, 'high');
  assert.equal(once.agentId, null);
  assert.equal(once.agentName, null);
  assert.deepEqual(once, twice);
});

check('dispatch option list would not inject sentinel as agent id', () => {
  // Mimic RedesignedSidebar filter: only real scalar ids
  const catalog = [
    { id: 'unassigned', name: 'Nicht zugewiesen' },
    { id: 'agent-1', name: 'Agent' },
  ].filter((a) => Boolean(scalarAssigneeId(a.id)));
  assert.deepEqual(
    catalog.map((a) => a.id),
    ['agent-1'],
  );
  assert.equal(isUnassignedSentinel('Nicht zugewiesen'), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
