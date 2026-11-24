/**
 * Dashboard KPI counts must match /tickets filtered list lengths 1:1.
 * Run: npx tsx scripts/test-dashboard-kpi-parity.ts
 */

import assert from 'node:assert/strict';
import {
  buildTicketsListUrl,
  resolveTicketsListDeepLink,
  TICKETS_DEEP_LINK_VIEWS,
} from '../src/lib/dashboard-ticket-nav.ts';
import {
  isInProgressQueueTicket,
  isOpenQueueTicket,
  isResolvedQueueTicket,
  resolveTicketsStatusParam,
} from '../src/lib/ticket-status-groups.ts';
import {
  filterTicketsByView,
  isResolvedInPeriodTicket,
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
  userEmail: 'agent@hubcom.de',
  userName: 'Agent One',
  watchedTicketIds: [],
  allTickets: [],
  isAiReady: false,
};

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const fixtures: Ticket[] = [
  ticket({ id: 'open-1', status: 'open', agentId: 'a1' }),
  ticket({ id: 'open-2', status: 'open', agentId: '' }),
  ticket({ id: 'new-1', status: 'new' as Ticket['status'], agentId: 'a1' }),
  ticket({ id: 'pending-1', status: 'pending', agentId: 'a1' }),
  ticket({ id: 'inprog-1', status: 'in_progress', agentId: 'a2' }),
  ticket({ id: 'inprog-hyphen', status: 'in-progress' as Ticket['status'], agentId: 'a2' }),
  ticket({
    id: 'resolved-recent',
    status: 'resolved',
    agentId: 'a1',
    resolvedAt: new Date(now - 3 * day).toISOString(),
  }),
  ticket({
    id: 'closed-recent',
    status: 'closed',
    agentId: 'a1',
    closedAt: new Date(now - 5 * day).toISOString(),
  }),
  ticket({
    id: 'resolved-old',
    status: 'resolved',
    agentId: 'a1',
    resolvedAt: new Date(now - 45 * day).toISOString(),
  }),
  ticket({ id: 'trash-1', status: 'trash', agentId: '' }),
  ticket({ id: 'merged-1', status: 'merged', agentId: '' }),
  ticket({ id: 'unassigned-1', status: 'open', agentId: '', assignedTo: 'unassigned' }),
];

console.log('Dashboard KPI ↔ /tickets parity');
console.log('================================\n');

check('status=open deep-link maps to status_open view', () => {
  assert.equal(resolveTicketsStatusParam('open'), 'status_open');
  assert.equal(
    resolveTicketsListDeepLink({ status: 'open', view: null }),
    'status_open',
  );
  assert.equal(
    buildTicketsListUrl({ kind: 'status', status: 'open' }),
    '/tickets?status=open',
  );
});

check('status=in_progress deep-link maps to status_in_progress', () => {
  assert.equal(resolveTicketsStatusParam('in_progress'), 'status_in_progress');
  assert.equal(
    buildTicketsListUrl({ kind: 'status', status: 'in_progress' }),
    '/tickets?status=in_progress',
  );
});

check('status=resolved deep-link includes period window', () => {
  assert.equal(resolveTicketsStatusParam('resolved'), 'status_resolved');
  assert.equal(
    buildTicketsListUrl({
      kind: 'status',
      status: 'resolved',
      resolvedWithinDays: 30,
    }),
    '/tickets?status=resolved&resolvedWithin=30d',
  );
});

check('open KPI count matches /tickets status_open filter', () => {
  const viaPredicate = fixtures.filter(isOpenQueueTicket);
  const viaView = filterTicketsByView(fixtures, 'status_open', emptyCtx);
  assert.deepEqual(
    viaPredicate.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  // open-1, open-2, new-1, unassigned-1
  assert.equal(viaView.length, 4);
  assert.ok(!viaView.some((t) => t.status === 'trash' || t.status === 'merged'));
});

check('in_progress KPI count matches status_in_progress / status_pending', () => {
  const viaPredicate = fixtures.filter(isInProgressQueueTicket);
  const viaView = filterTicketsByView(fixtures, 'status_in_progress', emptyCtx);
  const viaPendingAlias = filterTicketsByView(fixtures, 'status_pending', emptyCtx);
  assert.deepEqual(
    viaPredicate.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  assert.deepEqual(
    viaView.map((t) => t.id).sort(),
    viaPendingAlias.map((t) => t.id).sort(),
  );
  // pending-1, inprog-1, inprog-hyphen
  assert.equal(viaView.length, 3);
});

check('resolved KPI queue includes resolved + closed (never empty when count > 0)', () => {
  const viaPredicate = fixtures.filter(isResolvedQueueTicket);
  const viaView = filterTicketsByView(fixtures, 'status_resolved', emptyCtx);
  assert.deepEqual(
    viaPredicate.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  assert.ok(viaView.some((t) => t.status === 'resolved'));
  assert.ok(viaView.some((t) => t.status === 'closed'));
  assert.equal(viaView.length, 3); // resolved-recent, closed-recent, resolved-old
});

check('resolved-in-30d KPI subset matches list period filter', () => {
  const from = now - 30 * day;
  const kpiIds = fixtures
    .filter((t) => isResolvedInPeriodTicket(t, from, now))
    .map((t) => t.id)
    .sort();
  const listIds = filterTicketsByView(fixtures, 'status_resolved', emptyCtx)
    .filter((t) => isResolvedInPeriodTicket(t, from, now))
    .map((t) => t.id)
    .sort();
  assert.deepEqual(kpiIds, listIds);
  assert.deepEqual(kpiIds, ['closed-recent', 'resolved-recent']);
  assert.ok(kpiIds.length > 0);
});

check('unassigned KPI matches /tickets unassigned view', () => {
  const viaPredicate = fixtures.filter(isUnassignedTicket);
  const viaView = filterTicketsByView(fixtures, 'unassigned', emptyCtx);
  assert.deepEqual(
    viaPredicate.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  assert.ok(viaView.map((t) => t.id).includes('unassigned-1'));
  assert.ok(viaView.map((t) => t.id).includes('open-2'));
});

check('SLA deep-link resolves to sla_risk', () => {
  assert.equal(resolveTicketsListDeepLink({ status: null, view: 'sla' }), 'sla_risk');
  assert.ok(TICKETS_DEEP_LINK_VIEWS.has('sla_risk'));
  assert.equal(
    buildTicketsListUrl({ kind: 'view', view: 'sla' }),
    '/tickets?view=sla',
  );
});

check('status query wins over view when both present', () => {
  assert.equal(
    resolveTicketsListDeepLink({ status: 'open', view: 'unassigned' }),
    'status_open',
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
