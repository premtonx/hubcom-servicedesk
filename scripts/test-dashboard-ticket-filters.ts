/**
 * Dashboard ↔ ticket-list filter parity and navigation.
 * Run: npx tsx scripts/test-dashboard-ticket-filters.ts
 */

import assert from 'node:assert/strict';
import {
  buildTicketsListUrl,
  parseResolvedWithinDays,
  resolveTicketsViewParam,
  TICKETS_DEEP_LINK_VIEWS,
} from '../src/lib/dashboard-ticket-nav.ts';
import {
  filterTicketsByView,
  isOpenInProgressTicket,
  isOverdueTicket,
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
const hour = 60 * 60 * 1000;
const day = 24 * hour;

const fixtures: Ticket[] = [
  ticket({ id: 'u1', status: 'open', agentId: '', assignedTo: 'unassigned' }),
  ticket({ id: 'u2', status: 'pending', agentId: 'nicht-zugewiesen', agentName: '' }),
  ticket({
    id: 'u3-resolved',
    status: 'resolved',
    agentId: '',
    resolvedAt: new Date(now - 2 * day).toISOString(),
  }),
  ticket({ id: 'a1', status: 'open', agentId: 'agent-1', agentName: 'Agent One' }),
  ticket({ id: 'a2', status: 'in_progress', assigneeId: 'agent-2', agentName: 'Other' }),
  ticket({
    id: 'o1',
    status: 'open',
    agentId: 'agent-1',
    slaDueAt: new Date(now - hour).toISOString(),
  }),
  ticket({
    id: 'o2-closed',
    status: 'closed',
    agentId: 'agent-1',
    slaDueAt: new Date(now - hour).toISOString(),
  }),
  ticket({
    id: 'r-in',
    status: 'resolved',
    agentId: 'agent-1',
    resolvedAt: new Date(now - 3 * day).toISOString(),
  }),
  ticket({
    id: 'r-out',
    status: 'resolved',
    agentId: 'agent-1',
    resolvedAt: new Date(now - 20 * day).toISOString(),
  }),
  ticket({
    id: 'org-dpg',
    status: 'open',
    agentId: 'agent-9',
    organizationId: 'org-dpg',
  }),
  ticket({
    id: 'org-other',
    status: 'open',
    agentId: '',
    organizationId: 'org-other',
  }),
];

console.log('Dashboard ticket filters — unit tests');
console.log('=====================================\n');

check('unassigned predicate excludes sentinels-only and terminals', () => {
  assert.equal(isUnassignedTicket(fixtures[0]), true);
  assert.equal(isUnassignedTicket(fixtures[1]), true);
  assert.equal(isUnassignedTicket(fixtures[2]), false); // resolved
  assert.equal(isUnassignedTicket(fixtures[3]), false); // assigned
});

check('dashboard unassigned count matches ticket-list view filter', () => {
  const viaPredicate = fixtures.filter(isUnassignedTicket);
  const viaView = filterTicketsByView(fixtures, 'unassigned', emptyCtx);
  assert.deepEqual(
    viaPredicate.map((t) => t.id).sort(),
    viaView.map((t) => t.id).sort(),
  );
  // u1, u2, org-other — empty assignee + open; resolved empty-assignee excluded
  assert.deepEqual(
    viaView.map((t) => t.id).sort(),
    ['org-other', 'u1', 'u2'],
  );
});

check('sentinel agentId alone does not count as assigned when other fields empty', () => {
  const t = ticket({
    id: 'sentinel',
    status: 'open',
    agentId: 'Unassigned',
    assignedTo: '',
    assigneeId: null,
    agentName: 'nicht zugewiesen',
  });
  assert.equal(isUnassignedTicket(t), true);
});

check('overdue matches SLA due timestamps and excludes terminals', () => {
  assert.equal(isOverdueTicket(fixtures.find((t) => t.id === 'o1')!, now), true);
  assert.equal(isOverdueTicket(fixtures.find((t) => t.id === 'o2-closed')!, now), false);
  assert.equal(isOverdueTicket(fixtures.find((t) => t.id === 'a1')!, now), false);
  const viaView = filterTicketsByView(fixtures, 'overdue', emptyCtx);
  assert.deepEqual(
    viaView.map((t) => t.id),
    ['o1'],
  );
});

check('open_in_progress includes open, pending, in_progress', () => {
  const ids = fixtures.filter(isOpenInProgressTicket).map((t) => t.id).sort();
  assert.ok(ids.includes('u1'));
  assert.ok(ids.includes('u2'));
  assert.ok(ids.includes('a1'));
  assert.ok(ids.includes('a2'));
  assert.ok(!ids.includes('r-in'));
  const viaView = filterTicketsByView(fixtures, 'open_in_progress', emptyCtx);
  assert.deepEqual(
    viaView.map((t) => t.id).sort(),
    fixtures.filter(isOpenInProgressTicket).map((t) => t.id).sort(),
  );
});

check('resolved in period respects date window', () => {
  const from = now - 7 * day;
  assert.equal(isResolvedInPeriodTicket(fixtures.find((t) => t.id === 'r-in')!, from, now), true);
  assert.equal(isResolvedInPeriodTicket(fixtures.find((t) => t.id === 'r-out')!, from, now), false);
  assert.equal(isResolvedInPeriodTicket(fixtures.find((t) => t.id === 'a1')!, from, now), false);
});

check('KPI card destinations use distinct ticket-list views', () => {
  assert.equal(
    buildTicketsListUrl({ kind: 'view', view: 'unassigned' }),
    '/tickets?view=unassigned',
  );
  assert.equal(
    buildTicketsListUrl({ kind: 'view', view: 'overdue' }),
    '/tickets?view=overdue',
  );
  assert.equal(
    buildTicketsListUrl({ kind: 'view', view: 'open_in_progress' }),
    '/tickets?view=open_in_progress',
  );
  assert.equal(
    buildTicketsListUrl({
      kind: 'view',
      view: 'status_resolved',
      resolvedWithinDays: 7,
    }),
    '/tickets?view=status_resolved&resolvedWithin=7d',
  );
});

check('legacy dashboard aliases resolve to real views', () => {
  assert.equal(resolveTicketsViewParam('open'), 'open_in_progress');
  assert.equal(resolveTicketsViewParam('resolved'), 'status_resolved');
  assert.equal(resolveTicketsViewParam('unassigned'), 'unassigned');
  assert.equal(resolveTicketsViewParam('overdue'), 'overdue');
  assert.equal(parseResolvedWithinDays('7d'), 7);
  assert.equal(parseResolvedWithinDays('7'), 7);
  assert.equal(parseResolvedWithinDays(''), null);
});

check('customer row navigates by organization, not unassigned', () => {
  const url = buildTicketsListUrl({ kind: 'organization', organizationId: 'org-dpg' });
  assert.equal(url, '/tickets?organizationId=org-dpg&view=team_all_open');
  assert.ok(!url.includes('unassigned'));
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('organizationId'), 'org-dpg');
  assert.equal(params.get('view'), 'team_all_open');

  const orgTickets = fixtures.filter(
    (t) => String(t.organizationId || '').trim() === 'org-dpg',
  );
  assert.deepEqual(
    orgTickets.map((t) => t.id),
    ['org-dpg'],
  );
  assert.equal(isUnassignedTicket(orgTickets[0]), false);
});

check('deep-link views are allow-listed', () => {
  for (const id of [
    'unassigned',
    'overdue',
    'open_in_progress',
    'status_resolved',
    'team_all_open',
  ]) {
    assert.ok(TICKETS_DEEP_LINK_VIEWS.has(id), `missing ${id}`);
  }
});

check('organization filter + team_all_open does not force unassigned', () => {
  const pool = filterTicketsByView(fixtures, 'team_all_open', emptyCtx).filter(
    (t) => String(t.organizationId || '').trim() === 'org-dpg',
  );
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, 'org-dpg');
  assert.ok(pool[0].agentId);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
