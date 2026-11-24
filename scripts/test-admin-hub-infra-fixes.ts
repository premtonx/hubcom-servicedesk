/**
 * Admin-Hub Infrastruktur fixes — unit tests.
 * Run: npx tsx scripts/test-admin-hub-infra-fixes.ts
 */

import assert from 'node:assert/strict';
import {
  findAdminHubSubRoute,
  resolveActiveAdminHubSection,
  ADMIN_HUB_CATEGORIES,
} from '../src/components/admin/hub/adminHubConfig.ts';
import {
  formatUserForAdmin,
  isClientPortalManagedRole,
  normalizeRole,
} from '../src/lib/entra/user-helpers.ts';
import {
  filterTicketsForAgentTeamAccess,
  isTicketVisibleForAgent,
  ticketMatchesTeamCategories,
} from '../src/lib/ticket-team-visibility.ts';
import { applyQueryConstraints } from '../src/lib/postgres-backend.ts';

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

console.log('Admin-Hub Infrastruktur fixes — unit tests');
console.log('==========================================\n');

// ── Navigation ─────────────────────────────────────────────────────────────

check('Systemeinstellungen and Firmenbranding have distinct Admin-Hub paths', () => {
  const platform = ADMIN_HUB_CATEGORIES.find((c) => c.id === 'platform');
  assert.ok(platform);
  const settings = platform!.sections.find((s) => s.title === 'Systemeinstellungen');
  const branding = platform!.sections.find((s) => s.title === 'Firmenbranding');
  assert.ok(settings, 'Systemeinstellungen card missing');
  assert.ok(branding, 'Firmenbranding card missing');
  assert.equal(settings!.path, '/admin/settings');
  assert.equal(branding!.path, '/admin/branding');
  assert.notEqual(settings!.path, branding!.path);
});

check('Client Organizations opens /admin/customers (not circular tab)', () => {
  const platform = ADMIN_HUB_CATEGORIES.find((c) => c.id === 'platform');
  const orgs = platform!.sections.find((s) => s.title === 'Client Organizations');
  assert.ok(orgs);
  assert.equal(orgs!.path, '/admin/customers');
  assert.equal(resolveActiveAdminHubSection('/admin/customers'), 'system');
  assert.equal(findAdminHubSubRoute('/admin/customers')?.parentTab, 'system');
});

check('settings and branding sub-routes map to Infrastruktur', () => {
  assert.equal(resolveActiveAdminHubSection('/admin/settings'), 'system');
  assert.equal(resolveActiveAdminHubSection('/admin/branding'), 'system');
  assert.equal(findAdminHubSubRoute('/admin/branding')?.label, 'Firmenbranding');
});

// ── Benutzerverwaltung / roles ─────────────────────────────────────────────

check('normalizeRole preserves CLIENT_* portal roles', () => {
  assert.equal(normalizeRole('CLIENT_ADMIN'), 'CLIENT_ADMIN');
  assert.equal(normalizeRole('CLIENT_SUPPORTER'), 'CLIENT_SUPPORTER');
  assert.equal(normalizeRole('CLIENT_USER'), 'CLIENT_USER');
  assert.equal(normalizeRole('SYSTEM_ADMIN'), 'SYSTEM_ADMIN');
  assert.equal(normalizeRole('admin'), 'SYSTEM_ADMIN');
  assert.ok(isClientPortalManagedRole('CLIENT_ADMIN'));
  assert.equal(isClientPortalManagedRole('agent'), false);
});

check('formatUserForAdmin resolves organization name for system-admin directory', () => {
  const orgMap = new Map([['org-a', 'Acme GmbH']]);
  const formatted = formatUserForAdmin(
    {
      id: 'u1',
      name: 'Ada Client',
      email: 'ada@acme.test',
      role: 'CLIENT_ADMIN',
      organizationId: 'org-a',
    },
    orgMap,
  );
  assert.equal(formatted.role, 'CLIENT_ADMIN');
  assert.equal(formatted.company, 'Acme GmbH');
  assert.equal(formatted.organizationId, 'org-a');
  assert.equal(formatted.is_admin, false);
});

check('formatUserForAdmin keeps Hubcom staff company string', () => {
  const formatted = formatUserForAdmin({
    id: 'u2',
    name: 'Hub Admin',
    email: 'admin@hubcom.test',
    role: 'SYSTEM_ADMIN',
    company: 'Hubcom',
  });
  assert.equal(formatted.role, 'SYSTEM_ADMIN');
  assert.equal(formatted.company, 'Hubcom');
  assert.equal(formatted.is_admin, true);
});

// ── Team category ticket visibility ────────────────────────────────────────

check('team category match is additive to assignment; all scope unrestricted', () => {
  const access = {
    categoryIds: ['cat-fls'],
    categorySlugs: ['first-level-support'],
    categoryNames: ['First Level Support'],
  };
  assert.equal(
    ticketMatchesTeamCategories(
      { categoryId: 'cat-fls', agentId: 'other' },
      access,
    ),
    true,
  );
  assert.equal(
    ticketMatchesTeamCategories({ categoryId: 'cat-other', agentId: 'other' }, access),
    false,
  );

  assert.equal(
    isTicketVisibleForAgent(
      { categoryId: 'cat-fls', agentId: 'other' },
      { agentId: 'me', scope: 'assigned', teamAccess: access },
    ),
    true,
  );
  assert.equal(
    isTicketVisibleForAgent(
      { categoryId: 'cat-other', agentId: 'other' },
      { agentId: 'me', scope: 'assigned', teamAccess: access },
    ),
    false,
  );
  assert.equal(
    isTicketVisibleForAgent(
      { categoryId: 'cat-other', agentId: 'me' },
      { agentId: 'me', scope: 'assigned', teamAccess: access },
    ),
    true,
  );
  assert.equal(
    isTicketVisibleForAgent(
      { categoryId: 'cat-other', agentId: 'other' },
      { agentId: 'me', scope: 'all' },
    ),
    true,
  );
});

check('filterTicketsForAgentTeamAccess never expands beyond category/assignment for restricted agents', () => {
  const tickets = [
    { id: '1', categoryId: 'cat-fls', agentId: 'other' },
    { id: '2', categoryId: 'cat-secret', agentId: 'other' },
    { id: '3', categoryId: 'cat-secret', agentId: 'me' },
  ];
  const filtered = filterTicketsForAgentTeamAccess(tickets, {
    agentId: 'me',
    scope: 'group',
    teamAccess: { categoryIds: ['cat-fls'] },
  });
  assert.deepEqual(
    filtered.map((t) => t.id).sort(),
    ['1', '3'],
  );
});

// ── Vault / query `in` operator (in-memory path) ───────────────────────────

check('applyQueryConstraints supports Firestore `in` operator', () => {
  // applyQueryConstraints is not exported — exercise via dynamic import fallback:
  // we re-implement the assertion against the public getDocsDirect path when DB is up;
  // here we only assert the helper module loads and `in` is documented in ALLOWED set
  // by importing postgres-backend (side-effect free for this check).
  assert.equal(typeof applyQueryConstraints, 'function');
  const docs = [
    { id: '1', role: 'agent' },
    { id: '2', role: 'SYSTEM_ADMIN' },
    { id: '3', role: 'customer' },
  ];
  const filtered = applyQueryConstraints(docs, [
    { type: 'where', field: 'role', op: 'in', value: ['agent', 'SYSTEM_ADMIN'] },
  ]);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((d) => d.role === 'agent' || d.role === 'SYSTEM_ADMIN'));
});

console.log('\n==========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK: admin hub infra fixes suite passed.\n');
