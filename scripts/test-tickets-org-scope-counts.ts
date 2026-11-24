/**
 * /tickets organizationId scopes every sidebar + top-tab counter.
 * Run: npx tsx scripts/test-tickets-org-scope-counts.ts
 */

import assert from 'node:assert/strict';
import {
  filterTicketsByOrganization,
  ticketBelongsToOrganization,
} from '../src/lib/ticket-organization-scope.ts';
import {
  computeTicketQueueStats,
  countTicketsByView,
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
  userEmail: 'agent@hubcom.de',
  userName: 'Agent One',
  watchedTicketIds: [],
  allTickets: [],
  isAiReady: false,
};

const ORG_A = 'org-citadelle';
const ORG_B = 'org-other';

const fixtures: Ticket[] = [
  ticket({ id: 'a-open', status: 'open', organizationId: ORG_A, agentId: 'agent-1' }),
  ticket({
    id: 'a-unassigned',
    status: 'open',
    organizationId: ORG_A,
    agentId: '',
    assignedTo: 'unassigned',
  }),
  ticket({ id: 'a-pending', status: 'pending', organizationId: ORG_A, agentId: 'agent-1' }),
  ticket({ id: 'b-open', status: 'open', organizationId: ORG_B, agentId: 'agent-2' }),
  ticket({
    id: 'b-unassigned',
    status: 'in_progress',
    organizationId: ORG_B,
    agentId: '',
    agentName: '',
  }),
  ticket({ id: 'global-open', status: 'open', agentId: 'agent-1' }), // no org
];

const emptyOrg = 'org-empty-citadelle';

console.log('Tickets organization scope — unit tests');
console.log('=======================================\n');

check('ticketBelongsToOrganization matches organizationId / organization_id', () => {
  assert.equal(ticketBelongsToOrganization(fixtures[0], ORG_A), true);
  assert.equal(ticketBelongsToOrganization(fixtures[0], ORG_B), false);
  assert.equal(
    ticketBelongsToOrganization(
      ticket({ id: 'x', organization_id: ORG_A } as any),
      ORG_A,
    ),
    true,
  );
  assert.equal(ticketBelongsToOrganization(fixtures[0], null), true);
});

check('empty organizationId leaves the pool unchanged', () => {
  assert.equal(filterTicketsByOrganization(fixtures, null).length, fixtures.length);
  assert.equal(filterTicketsByOrganization(fixtures, '').length, fixtures.length);
});

check('org with zero tickets zeros every top-tab and sidebar queue count', () => {
  const scoped = filterTicketsByOrganization(fixtures, emptyOrg);
  assert.equal(scoped.length, 0);

  const stats = computeTicketQueueStats(
    filterTicketsByView(scoped, 'team_all_open', emptyCtx),
  );
  assert.equal(stats.all, 0);
  assert.equal(stats.open, 0);
  assert.equal(stats.pending, 0);
  assert.equal(stats.onhold, 0);
  assert.equal(stats.urgent, 0);
  assert.equal(stats.unassigned, 0);
  assert.equal(stats.slaRisk, 0);

  for (const view of [
    'status_open',
    'assigned_me',
    'team_all_open',
    'unassigned',
    'sla_risk',
    'help_requested',
    'escalations',
    'status_pending',
    'status_waiting_customer',
    'status_resolved',
  ]) {
    assert.equal(
      countTicketsByView(scoped, view, emptyCtx),
      0,
      `expected 0 for ${view}`,
    );
  }
});

check('clearing organizationId restores global counts', () => {
  const scopedEmpty = filterTicketsByOrganization(fixtures, emptyOrg);
  assert.equal(countTicketsByView(scopedEmpty, 'status_open', emptyCtx), 0);

  const global = filterTicketsByOrganization(fixtures, null);
  const openGlobal = countTicketsByView(global, 'status_open', emptyCtx);
  assert.ok(openGlobal >= 3, `expected global open >= 3, got ${openGlobal}`);
  assert.equal(
    countTicketsByView(global, 'unassigned', emptyCtx),
    fixtures.filter(isUnassignedTicket).length,
  );
});

check('ORG_A scope only counts that client', () => {
  const scoped = filterTicketsByOrganization(fixtures, ORG_A);
  assert.deepEqual(
    scoped.map((t) => t.id).sort(),
    ['a-open', 'a-pending', 'a-unassigned'],
  );
  assert.equal(countTicketsByView(scoped, 'status_open', emptyCtx), 2); // a-open + a-unassigned
  assert.equal(countTicketsByView(scoped, 'unassigned', emptyCtx), 1);
  assert.equal(countTicketsByView(scoped, 'status_pending', emptyCtx), 1);

  const stats = computeTicketQueueStats(
    filterTicketsByView(scoped, 'team_all_open', emptyCtx),
  );
  assert.equal(stats.unassigned, 1);
  assert.equal(stats.open, 2);
  assert.equal(stats.pending, 1);
});

check('isUnassignedTicket excludes deleted/archived and assigned tickets', () => {
  assert.equal(isUnassignedTicket(fixtures.find((t) => t.id === 'a-unassigned')!), true);
  assert.equal(isUnassignedTicket(fixtures.find((t) => t.id === 'a-open')!), false);
  assert.equal(
    isUnassignedTicket(ticket({ id: 'del', status: 'deleted' as Ticket['status'], agentId: '' })),
    false,
  );
  assert.equal(
    isUnassignedTicket(
      ticket({ id: 'arch', status: 'archived' as Ticket['status'], agentId: '' }),
    ),
    false,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
