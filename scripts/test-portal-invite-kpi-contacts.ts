/**
 * Portal invite mail channel, contact sync, KPI isolation, password policy.
 * Usage: npx tsx scripts/test-portal-invite-kpi-contacts.ts
 */

import {
  buildCompanyKpiMetrics,
  FORBIDDEN_COMPANY_KPI_FIXTURES,
} from '../src/lib/company-kpi-metrics.js';
import { assertPortalPasswordPolicy } from '../src/lib/client-portal/team-service.js';
import { deriveInvitationStatus } from '../src/lib/client-portal/invitation-status.js';
import { hydrateCompany } from '../src/components/pages/companies/utils.js';
import type { Ticket } from '../src/types/index.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n1) Invitation mail no longer requires MAIL_DISPATCH_URL alone');
{
  // Source contract: sendPortalTeamEmail must import trySendTransactionalEmail
  const fs = await import('fs');
  const src = fs.readFileSync('src/lib/client-portal/team-service.ts', 'utf8');
  assert(
    src.includes('trySendTransactionalEmail'),
    'sendPortalTeamEmail uses trySendTransactionalEmail',
  );
  assert(
    !src.includes("MAIL_DISPATCH_URL not configured"),
    'hard MAIL_DISPATCH_URL failure message removed from team-service',
  );
  const outbound = fs.readFileSync('src/lib/outbound-mail.ts', 'utf8');
  assert(
    outbound.includes('export async function trySendTransactionalEmail'),
    'trySendTransactionalEmail exported',
  );
  assert(
    outbound.includes('findOrganizationEmailChannel') &&
      outbound.includes('listGlobalEmailChannels'),
    'transactional send resolves org + Hubcom Graph channels',
  );
}

console.log('\n2) KPI metrics are company-scoped and fixture-free');
{
  const ticketsA: Ticket[] = [
    { id: 't1', subject: 'A', status: 'open', priority: 'high' } as Ticket,
    { id: 't2', subject: 'B', status: 'resolved', priority: 'low' } as Ticket,
  ];
  const ticketsB: Ticket[] = [
    { id: 't3', subject: 'C', status: 'open', priority: 'urgent' } as Ticket,
    { id: 't4', subject: 'D', status: 'open', priority: 'urgent' } as Ticket,
    { id: 't5', subject: 'E', status: 'open', priority: 'medium' } as Ticket,
  ];

  const kpiA = buildCompanyKpiMetrics({
    contactsCount: 1,
    ticketHistory: ticketsA,
  });
  const kpiB = buildCompanyKpiMetrics({
    contactsCount: 5,
    ticketHistory: ticketsB,
  });

  assert(kpiA.contactsCount === 1, 'company A contacts = 1');
  assert(kpiB.contactsCount === 5, 'company B contacts = 5');
  assert(kpiA.openTicketsCount === 1, 'company A open tickets = 1');
  assert(kpiB.openTicketsCount === 3, 'company B open tickets = 3');
  assert(kpiA.slaRisksCount === 0, 'company A sla risks = 0');
  assert(kpiB.slaRisksCount === 2, 'company B sla risks = 2');
  assert(kpiA.slaPerformance === null, 'no fabricated SLA %');
  assert(kpiA.monthlySpend === null, 'no fabricated spend');
  assert(kpiA.assetsCount === 0 && kpiA.vaultEntriesCount === 0, 'empty inventory → 0');

  const blob = JSON.stringify(kpiA);
  for (const f of FORBIDDEN_COMPANY_KPI_FIXTURES) {
    if (f === '142' || f === '87' || f === '23') {
      // numeric zeros/ones are fine; fixture strings like 142 must not appear as KPI values
      assert(
        kpiA.contactsCount !== 142 &&
          kpiA.assetsCount !== 87 &&
          kpiA.vaultEntriesCount !== 23,
        `KPI must not use fixture ${f}`,
      );
    } else {
      assert(!blob.includes(f), `KPI blob must not contain “${f}”`);
    }
  }
}

console.log('\n3) hydrateCompany strips stored demo KPI fields');
{
  const hydrated = hydrateCompany(
    {
      id: 'co-x',
      name: 'Fresh GmbH',
      domain: 'fresh.test',
      website: '',
      logoUrl: '',
      branche: 'Tech',
      wartungsvertragStatus: 'Active',
      phoneNumbers: [],
      usersCount: 142,
      assetsCount: 87,
      vaultEntriesCount: 23,
      slaPerformance: '99.8%',
      monthlySpend: '€4,520',
      healthScore: 85,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    [],
  );
  assert(hydrated!.usersCount === null, 'stored usersCount ignored');
  assert(hydrated!.assetsCount === null, 'stored assetsCount ignored');
  assert(hydrated!.vaultEntriesCount === null, 'stored vaultEntriesCount ignored');
  assert(hydrated!.slaPerformance === '', 'stored slaPerformance ignored');
  assert(hydrated!.monthlySpend === '', 'stored monthlySpend ignored');
  assert(hydrated!.healthScore === null, 'stored healthScore ignored');
}

console.log('\n4) Password policy + invitation status');
{
  let threw = false;
  try {
    assertPortalPasswordPolicy('short');
  } catch {
    threw = true;
  }
  assert(threw, 'short password rejected');
  threw = false;
  try {
    assertPortalPasswordPolicy('long-enough-password');
  } catch {
    threw = true;
  }
  assert(!threw, 'valid password accepted');

  assert(
    deriveInvitationStatus({
      activationToken: 'act-x',
      activationTokenExpires: new Date(Date.now() + 60_000).toISOString(),
      invitationEmailSent: true,
    }) === 'sent',
    'sent status',
  );
  assert(
    deriveInvitationStatus({ passwordHash: 'x', activationToken: null }) === 'accepted',
    'accepted after password',
  );
}

console.log('\n5) Contact sync uses flat metadata (source check)');
{
  const fs = await import('fs');
  const src = fs.readFileSync('src/lib/client-portal/org-company-sync.ts', 'utf8');
  assert(
    src.includes('hit.metadata') && !src.includes('hit.data as any'),
    'ensureContactForPortalUser reads flat hit.metadata',
  );
  assert(src.includes('invitationStatus'), 'contact sync stores invitationStatus');
  assert(src.includes('sameCompany'), 'dedupe scoped to companyId');
}

console.log(`\n${'─'.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
