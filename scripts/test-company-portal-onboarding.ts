/**
 * Company onboarding + portal invite security / listing regressions.
 * Usage: npx tsx scripts/test-company-portal-onboarding.ts
 */

import {
  blankNewCompanyForm,
  FORBIDDEN_NEW_COMPANY_FIXTURES,
} from '../src/lib/company-form-defaults.js';
import { deriveInvitationStatus } from '../src/lib/client-portal/invitation-status.js';
import { parseAndValidateLogoDataUrl } from '../src/lib/client-portal/org-branding.js';
import { isHubcomStaffRole, isClientPortalRole } from '../src/lib/client-portal/roles.js';
import { hydrateCompany } from '../src/components/pages/companies/utils.js';
import { buildSetupToken } from '../src/lib/client-portal/team-service.js';

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

console.log('\n1) Blank new-company defaults (no fixtures)');
{
  const form = blankNewCompanyForm();
  const blob = JSON.stringify(form);
  for (const fixture of FORBIDDEN_NEW_COMPANY_FIXTURES) {
    assert(!blob.includes(fixture), `default form must not contain “${fixture}”`);
  }
  assert(form.name === '', 'name empty');
  assert(form.domain === '', 'domain empty');
  assert(form.accountOwner === '', 'accountOwner empty');
  assert(form.accountOwnerId === '', 'accountOwnerId empty');
  assert(form.primaryContactName === '', 'primaryContactName empty');
  assert(form.primaryContactEmail === '', 'primaryContactEmail empty');
  assert(form.logoUrl === '', 'logoUrl empty');
  assert(form.tier === '', 'tier empty (not Enterprise fixture)');
}

console.log('\n2) Account-manager eligibility');
{
  assert(isHubcomStaffRole('SYSTEM_ADMIN'), 'SYSTEM_ADMIN is Hubcom staff');
  assert(isHubcomStaffRole('agent'), 'agent is Hubcom staff');
  assert(!isHubcomStaffRole('CLIENT_ADMIN'), 'CLIENT_ADMIN is not Hubcom staff');
  assert(!isHubcomStaffRole('CLIENT_USER'), 'CLIENT_USER is not Hubcom staff');
  assert(isClientPortalRole('CLIENT_ADMIN'), 'CLIENT_ADMIN is portal role');
}

console.log('\n3) Logo validation policy');
{
  const pngTiny =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const ok = parseAndValidateLogoDataUrl(pngTiny);
  assert(ok.ok === true, 'tiny PNG data URL accepted');

  const svg = 'data:image/svg+xml;base64,PHN2Zy8+';
  const badSvg = parseAndValidateLogoDataUrl(svg);
  assert(badSvg.ok === false, 'SVG rejected');

  const empty = parseAndValidateLogoDataUrl('');
  assert(empty.ok === false, 'empty logo rejected');
}

console.log('\n4) hydrateCompany does not invent Sarah James / fake SLA');
{
  const hydrated = hydrateCompany(
    {
      id: 'co-1',
      name: 'Real GmbH',
      domain: 'real.example',
      website: '',
      logoUrl: 'data:image/png;base64,abc',
      branche: 'Tech',
      wartungsvertragStatus: 'Active',
      phoneNumbers: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any,
    [],
  );
  assert(hydrated !== null, 'hydrated company');
  assert(hydrated!.accountOwner === '', 'no invented accountOwner');
  assert(!String(hydrated!.accountOwner).includes('Sarah'), 'no Sarah James');
  assert(hydrated!.slaPerformance === '', 'no invented slaPerformance');
  assert(hydrated!.usersCount === null, 'no invented usersCount');
  assert(hydrated!.logoUrl.startsWith('data:image/png'), 'logoUrl preserved');
}

console.log('\n5) Invitation status derivation');
{
  assert(
    deriveInvitationStatus({
      activationToken: 'act-abc',
      activationTokenExpires: new Date(Date.now() + 3600_000).toISOString(),
      invitationEmailSent: true,
    }) === 'sent',
    'sent when mail succeeded + token live',
  );
  assert(
    deriveInvitationStatus({
      activationToken: 'act-abc',
      activationTokenExpires: new Date(Date.now() - 1000).toISOString(),
    }) === 'expired',
    'expired token',
  );
  assert(
    deriveInvitationStatus({
      passwordHash: 'argon2…',
      activationToken: null,
    }) === 'accepted',
    'accepted after password set',
  );
  assert(
    deriveInvitationStatus({
      activationToken: 'act-abc',
      activationTokenExpires: new Date(Date.now() + 3600_000).toISOString(),
      invitationEmailFailed: true,
    }) === 'failed',
    'failed mail',
  );
}

console.log('\n6) Setup token shape');
{
  const { token, expiresAt } = buildSetupToken();
  assert(token.startsWith('act-'), 'token prefix act-');
  assert(token.length > 20, 'token entropy');
  assert(new Date(expiresAt).getTime() > Date.now(), 'expires in future');
}

console.log('\n7) Portal user list flattening (regression)');
{
  // Simulates the bug: spreading u.data on already-flat getDocsDirect rows.
  const flatUser = {
    id: 'u1',
    email: 'a@client.test',
    role: 'CLIENT_ADMIN',
    organizationId: 'org-1',
  };
  const buggy = { id: flatUser.id, ...(flatUser as any).data };
  assert(
    !(buggy as any).organizationId,
    'bug reproduction: spreading missing .data drops organizationId',
  );
  const fixed = { id: flatUser.id, ...flatUser };
  assert(
    fixed.organizationId === 'org-1' && isClientPortalRole(fixed.role),
    'flat doc retains organizationId + CLIENT_ role',
  );
}

console.log(`\n${'─'.repeat(48)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
