/**
 * Unit tests: Admin-Hub section resolution + sub-route parent mapping.
 * Run: npx tsx scripts/test-admin-hub-layout.ts
 */

import assert from 'node:assert/strict';
import {
  findAdminHubSubRoute,
  resolveActiveAdminHubSection,
  resolveAdminHubTab,
} from '../src/components/admin/hub/adminHubConfig.ts';

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

console.log('Admin-Hub layout — unit tests');
console.log('==============================\n');

check('hub index tab from ?tab=', () => {
  const params = new URLSearchParams('tab=integrations');
  assert.equal(resolveActiveAdminHubSection('/admin', params), 'integrations');
  assert.equal(resolveActiveAdminHubSection('/admin/', params), 'integrations');
});

check('default hub index is uebersicht', () => {
  assert.equal(resolveActiveAdminHubSection('/admin', new URLSearchParams()), 'uebersicht');
  assert.equal(resolveAdminHubTab(null), 'uebersicht');
});

check('email-channels maps to Mail & Schnittstellen', () => {
  assert.equal(resolveActiveAdminHubSection('/admin/email-channels'), 'integrations');
  assert.equal(findAdminHubSubRoute('/admin/email-channels')?.label, 'E-Mail-Kanäle');
});

check('integrations / notifications keep parent highlight', () => {
  assert.equal(resolveActiveAdminHubSection('/admin/integrations'), 'integrations');
  assert.equal(resolveActiveAdminHubSection('/admin/notifications'), 'integrations');
});

check('users / roles / categories map to Infrastruktur', () => {
  assert.equal(resolveActiveAdminHubSection('/admin/users'), 'system');
  assert.equal(resolveActiveAdminHubSection('/admin/roles'), 'system');
  assert.equal(resolveActiveAdminHubSection('/admin/ticket-categories'), 'system');
  assert.equal(resolveActiveAdminHubSection('/admin/customers'), 'system');
});

check('pii / legal map to PII & Compliance', () => {
  assert.equal(resolveActiveAdminHubSection('/admin/pii'), 'governance');
  assert.equal(resolveActiveAdminHubSection('/admin/legal'), 'governance');
});

check('time-tracking/overview prefers longest prefix', () => {
  const meta = findAdminHubSubRoute('/admin/time-tracking/overview');
  assert.equal(meta?.label, 'Zeiterfassung Gesamt');
  assert.equal(resolveActiveAdminHubSection('/admin/time-tracking/overview'), 'system');
});

check('only one section active — uebersicht not sticky', () => {
  assert.notEqual(resolveActiveAdminHubSection('/admin/email-channels'), 'uebersicht');
  assert.equal(resolveActiveAdminHubSection('/admin/email-channels'), 'integrations');
});

console.log('\n==============================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK: admin hub layout suite passed.\n');
