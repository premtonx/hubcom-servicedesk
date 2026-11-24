/**
 * Phase 5 — Multi-tenant Client Portal isolation & RBAC test suite.
 *
 * Fixtures:
 *   Hubcom SYSTEM_ADMIN
 *   Org A: CLIENT_ADMIN, CLIENT_SUPPORTER, CLIENT_USER
 *   Org B: CLIENT_ADMIN, CLIENT_USER
 *
 * Usage: npm run test:portal-isolation
 */

import {
  evaluateClientTicketVisibility,
  filterMessagesForClient,
  filterTicketsForClient,
  isInternalMessage,
  sanitizeTicketForClient,
  stripClientSpoofFields,
  ticketOrganizationId,
} from '../src/lib/client-portal/ticket-visibility.js';
import {
  enforceClientDbTicketAccess,
  postFilterClientDbResult,
} from '../src/lib/client-portal/db-ticket-guard.js';
import {
  encryptEmailChannelSecret,
  decryptEmailChannelSecret,
  isEncryptedEmailSecret,
} from '../src/lib/email-ingestion/channel-secret-crypto.js';
import {
  channelBelongsToOrgOrGlobal,
  isHealthySendAsGraph,
  redactChannelSecrets,
} from '../src/lib/email-ingestion/channel-store.js';
import type { EmailChannelConfig } from '../src/lib/email-ingestion/types.js';
import { redactSecrets } from '../src/lib/safe-log.js';
import { isClientPortalRole } from '../src/lib/client-portal/roles.js';
import {
  assertPortalDashboardTenantIsolation,
  buildPortalDashboardPayload,
} from '../src/lib/client-portal/portal-dashboard-service.js';
import {
  buildClientPortalUserProfile,
  buildClientPortalUserRole,
  shouldFetchRolesCollection,
} from '../src/lib/client-portal/portal-role-from-session.js';
import { assertDbCollectionAccess } from '../src/lib/db-access-policy.js';
import {
  applyTicketOrganizationStamp,
  matchOrganizationByEmailDomain,
  matchOrganizationByName,
} from '../src/lib/client-portal/stamp-ticket-organization.js';
import type { OrganizationRecord } from '../src/lib/client-portal/organizations.js';

process.env.EMAIL_CHANNEL_SECRET_KEY =
  process.env.EMAIL_CHANNEL_SECRET_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const ORG_A = 'org-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ORG_B = 'org-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const hubcomAdmin = {
  id: 'user-hubcom-admin',
  role: 'SYSTEM_ADMIN',
  organizationId: null as string | null,
};

const orgAAdmin = {
  id: 'user-a-admin',
  role: 'CLIENT_ADMIN',
  organizationId: ORG_A,
};

const orgASupporter = {
  id: 'user-a-supporter',
  role: 'CLIENT_SUPPORTER',
  organizationId: ORG_A,
};

const orgAUser = {
  id: 'user-a-user',
  role: 'CLIENT_USER',
  organizationId: ORG_A,
};

const orgAColleague = {
  id: 'user-a-colleague',
  role: 'CLIENT_USER',
  organizationId: ORG_A,
};

const orgBAdmin = {
  id: 'user-b-admin',
  role: 'CLIENT_ADMIN',
  organizationId: ORG_B,
};

const orgBUser = {
  id: 'user-b-user',
  role: 'CLIENT_USER',
  organizationId: ORG_B,
};

const ticketOrgA = {
  id: 'ticket-a-1',
  subject: 'Org A printer',
  organizationId: ORG_A,
  organization_id: ORG_A,
  requesterId: orgAUser.id,
  agentComments: [{ text: 'Hubcom internal note — never leak' }],
  internalNotes: 'private hubcom thread',
  aiSummary: 'secret diagnosis',
  aiInsights: ['do not show'],
  aiRootCause: 'hidden',
  aiChecklist: [{ task: 'x', completed: false }],
  aiSentiment: 'Angry',
  status: 'open',
};

const ticketOrgAColleague = {
  id: 'ticket-a-2',
  subject: 'Colleague only',
  organizationId: ORG_A,
  requesterId: orgAColleague.id,
  status: 'open',
};

const ticketOrgB = {
  id: 'ticket-b-1',
  subject: 'Org B VPN',
  organizationId: ORG_B,
  organization_id: ORG_B,
  requesterId: orgBUser.id,
  agentComments: [{ text: 'Org B hubcom note' }],
  internalNotes: 'b-internal',
  status: 'open',
};

const publicMsg = {
  id: 'm1',
  content: 'Hello from customer',
  is_internal: false,
  senderType: 'customer',
};

const internalMsg = {
  id: 'm2',
  content: 'Hubcom private note',
  is_internal: true,
  isInternal: true,
  senderType: 'agent',
};

const visibilityInternal = {
  id: 'm3',
  content: 'also internal',
  visibility: 'internal',
};

// ── Tests ─────────────────────────────────────────────────────────────────

function testCrossTenantBlock(): void {
  console.log('\n[1] Cross-tenant block (Org A ↔ Org B)');

  for (const actor of [orgAAdmin, orgASupporter, orgAUser]) {
    assert(
      evaluateClientTicketVisibility(actor, ticketOrgB) === false,
      `${actor.role} cannot view Org B ticket`,
    );
    assert(
      evaluateClientTicketVisibility(actor, ticketOrgB, { isParticipant: true }) === false,
      `${actor.role} cannot view Org B ticket even if participant flag spoofed`,
    );
  }

  assert(
    evaluateClientTicketVisibility(orgBAdmin, ticketOrgA) === false,
    'Org B CLIENT_ADMIN cannot view Org A ticket',
  );
  assert(
    evaluateClientTicketVisibility(orgAAdmin, ticketOrgA) === true,
    'Org A CLIENT_ADMIN can view Org A ticket',
  );
  assert(
    evaluateClientTicketVisibility(orgASupporter, ticketOrgA) === true,
    'Org A CLIENT_SUPPORTER can view Org A ticket',
  );
}

function testInternalNotesBlock(): void {
  console.log('\n[2] Internal notes never returned to CLIENT_* roles');

  const sanitized = sanitizeTicketForClient({ ...ticketOrgA });
  assert(!('agentComments' in sanitized), 'agentComments stripped');
  assert(!('internalNotes' in sanitized), 'internalNotes stripped');
  assert(!('aiSummary' in sanitized), 'aiSummary stripped');
  assert(!('aiInsights' in sanitized), 'aiInsights stripped');
  assert(!('aiRootCause' in sanitized), 'aiRootCause stripped');
  assert(!('aiChecklist' in sanitized), 'aiChecklist stripped');
  assert(!('aiSentiment' in sanitized), 'aiSentiment stripped');
  assert(sanitized.subject === ticketOrgA.subject, 'public subject preserved');

  assert(isInternalMessage(internalMsg) === true, 'is_internal detected');
  assert(isInternalMessage(visibilityInternal) === true, 'visibility=internal detected');
  assert(isInternalMessage(publicMsg) === false, 'public message not flagged');

  const filtered = filterMessagesForClient([
    publicMsg as any,
    internalMsg as any,
    visibilityInternal as any,
  ]);
  assert(filtered.length === 1 && filtered[0].id === 'm1', 'only public message remains');

  for (const role of ['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER']) {
    assert(isClientPortalRole(role), `${role} is a portal role`);
  }
}

async function testClientUserScoping(): Promise<void> {
  console.log('\n[3] CLIENT_USER scoping (requester ∪ participants)');

  assert(
    evaluateClientTicketVisibility(orgAUser, ticketOrgA) === true,
    'CLIENT_USER sees own requester ticket',
  );
  assert(
    evaluateClientTicketVisibility(orgAUser, ticketOrgAColleague) === false,
    'CLIENT_USER cannot see colleague ticket without participant',
  );
  assert(
    evaluateClientTicketVisibility(orgAUser, ticketOrgAColleague, {
      isParticipant: true,
    }) === true,
    'CLIENT_USER sees colleague ticket when in ticket_participants',
  );

  // filterTicketsForClient needs DB for participants — exercise org-wide path + requester.
  const filteredAdmin = await filterTicketsForClient(orgAAdmin, [
    ticketOrgA,
    ticketOrgAColleague,
    ticketOrgB,
  ] as any);
  assert(
    filteredAdmin.length === 2 &&
      filteredAdmin.every((t) => ticketOrganizationId(t) === ORG_A),
    'CLIENT_ADMIN list is org-scoped (no Org B)',
  );
  assert(
    filteredAdmin.every((t) => !('agentComments' in t) && !('internalNotes' in t)),
    'list sanitize strips Hubcom notes',
  );
}

async function testPrivilegeEscalation(): Promise<void> {
  console.log('\n[4] Privilege escalation & organization_id spoof block');

  const spoof = stripClientSpoofFields({
    organizationId: ORG_B,
    organization_id: ORG_B,
    role: 'SYSTEM_ADMIN',
    roleId: 'role-system-admin',
    is_admin: true,
    isAdmin: true,
    is_internal: true,
    status: 'closed',
    agentComments: [{ text: 'inject' }],
  });
  assert(spoof.organizationId === undefined, 'organizationId stripped');
  assert(spoof.organization_id === undefined, 'organization_id stripped');
  assert(spoof.role === undefined, 'role stripped');
  assert(spoof.is_admin === undefined, 'is_admin stripped');
  assert(spoof.is_internal === undefined, 'is_internal stripped');
  assert(spoof.agentComments === undefined, 'agentComments stripped from spoof');
  assert(spoof.status === 'closed', 'legitimate status preserved');

  const denyOtherUser = await enforceClientDbTicketAccess({
    user: { id: orgAAdmin.id, role: 'CLIENT_ADMIN', organizationId: ORG_A } as any,
    collection: 'users',
    action: 'update_doc',
    id: orgBAdmin.id,
    data: { role: 'SYSTEM_ADMIN', organizationId: ORG_A },
  });
  assert(denyOtherUser.ok === false, 'CLIENT_ADMIN cannot update Org B / other users via /api/db');

  const selfUpdate = await enforceClientDbTicketAccess({
    user: { id: orgAAdmin.id, role: 'CLIENT_ADMIN', organizationId: ORG_A } as any,
    collection: 'users',
    action: 'update_doc',
    id: orgAAdmin.id,
    data: { role: 'SYSTEM_ADMIN', organizationId: ORG_B, name: 'Hacker' },
  });
  assert(selfUpdate.ok === true, 'self update allowed after strip');
  assert(
    selfUpdate.ok === true &&
      selfUpdate.data &&
      selfUpdate.data.role === undefined &&
      selfUpdate.data.organizationId === undefined,
    'self update cannot set role or organizationId',
  );

  const crossTicketMutate = await enforceClientDbTicketAccess({
    user: { id: orgAAdmin.id, role: 'CLIENT_ADMIN', organizationId: ORG_A } as any,
    collection: 'tickets',
    action: 'update_doc',
    id: ticketOrgB.id,
    data: { status: 'closed', organizationId: ORG_A },
  });
  assert(
    crossTicketMutate.ok === true && crossTicketMutate.requireMutate === true,
    'ticket update signals requireMutate (router enforces live visibility)',
  );
  assert(
    crossTicketMutate.ok === true &&
      crossTicketMutate.data &&
      crossTicketMutate.data.organizationId === undefined,
    'ticket update cannot overwrite organizationId',
  );

  const denyDelete = await enforceClientDbTicketAccess({
    user: { id: orgAAdmin.id, role: 'CLIENT_ADMIN', organizationId: ORG_A } as any,
    collection: 'tickets',
    action: 'delete_doc',
    id: ticketOrgA.id,
  });
  assert(denyDelete.ok === false, 'CLIENT_ADMIN cannot delete tickets via /api/db');
}

function testSecretProtection(): void {
  console.log('\n[5] M365 client_secret encryption & API redaction');

  const plaintext = 'SuperSecret-ClientValue-9f3a';
  const encrypted = encryptEmailChannelSecret(plaintext);
  assert(isEncryptedEmailSecret(encrypted), 'secret encrypted with enc:v1 prefix');
  assert(!encrypted.includes(plaintext), 'ciphertext does not contain plaintext');
  assert(decryptEmailChannelSecret(encrypted) === plaintext, 'decrypt roundtrip');

  const channel = {
    id: 'ch-1',
    name: 'Org A Graph',
    email: 'it@kunde-a.de',
    connectionType: 'microsoft_graph',
    enabled: true,
    status: 'connected',
    clientSecret: encrypted,
    tenantId: 'tenant-a',
    clientId: 'client-a',
    organizationId: ORG_A,
    sendAsEnabled: true,
  } as EmailChannelConfig;

  const redacted = redactChannelSecrets(channel);
  assert(redacted.clientSecret === '••••••••', 'API returns masked secret');
  assert(redacted.hasClientSecret === true, 'hasClientSecret indicator set');
  assert(
    JSON.stringify(redacted).includes(plaintext) === false,
    'redacted payload has no plaintext secret',
  );
  assert(
    JSON.stringify(redacted).includes(encrypted) === false,
    'redacted payload has no ciphertext either',
  );

  const logLine = redactSecrets(
    `Graph auth failed client_secret=${plaintext} clientSecret=${plaintext}`,
  );
  assert(!logLine.includes(plaintext), 'safe-log redacts client_secret / clientSecret');
}

function testOutboundFallback(): void {
  console.log('\n[6] Outbound Send-As routing (org vs Hubcom fallback)');

  const orgAChannel: EmailChannelConfig = {
    id: 'ch-org-a',
    name: 'Org A',
    email: 'it@kunde-a.de',
    mailbox: 'it@kunde-a.de',
    connectionType: 'microsoft_graph',
    enabled: true,
    status: 'connected',
    organizationId: ORG_A,
    sendAsEnabled: true,
    lastTestOk: true,
  };

  const orgADisabled: EmailChannelConfig = {
    ...orgAChannel,
    id: 'ch-org-a-off',
    sendAsEnabled: false,
    status: 'failed',
  };

  const orgBChannel: EmailChannelConfig = {
    id: 'ch-org-b',
    name: 'Org B',
    email: 'it@kunde-b.de',
    mailbox: 'it@kunde-b.de',
    connectionType: 'microsoft_graph',
    enabled: true,
    status: 'connected',
    organizationId: ORG_B,
    sendAsEnabled: true,
    lastTestOk: true,
  };

  const hubcomGlobal: EmailChannelConfig = {
    id: 'ch-hubcom',
    name: 'Hubcom Support',
    email: 'hubcom.support@hubcom.de',
    mailbox: 'hubcom.support@hubcom.de',
    connectionType: 'microsoft_graph',
    enabled: true,
    status: 'connected',
    organizationId: null,
    lastTestOk: true,
  };

  assert(isHealthySendAsGraph(orgAChannel) === true, 'healthy org Send-As accepted');
  assert(isHealthySendAsGraph(orgADisabled) === false, 'disabled/failed org channel rejected');
  assert(isHealthySendAsGraph(hubcomGlobal) === true, 'Hubcom global Graph healthy');

  assert(
    channelBelongsToOrgOrGlobal(orgAChannel, ORG_A) === true,
    'Org A channel belongs to Org A',
  );
  assert(
    channelBelongsToOrgOrGlobal(orgBChannel, ORG_A) === false,
    'Org B channel must NOT be selected for Org A ticket',
  );
  assert(
    channelBelongsToOrgOrGlobal(hubcomGlobal, ORG_A) === true,
    'Hubcom global allowed as Org A fallback',
  );
  assert(
    channelBelongsToOrgOrGlobal(orgAChannel, null) === false,
    'Org channel not used for unscoped/global tickets',
  );
  assert(
    channelBelongsToOrgOrGlobal(hubcomGlobal, null) === true,
    'Hubcom global used for unscoped tickets',
  );

  // Simulate selection preference: healthy org → else hubcom → never foreign org.
  const candidatesForOrgA = [orgADisabled, orgBChannel, hubcomGlobal, orgAChannel];
  const preferred =
    candidatesForOrgA.find(
      (c) =>
        channelBelongsToOrgOrGlobal(c, ORG_A) &&
        isHealthySendAsGraph(c) &&
        (c.organizationId || c.organization_id) === ORG_A &&
        c.sendAsEnabled === true,
    ) ||
    candidatesForOrgA.find(
      (c) => channelBelongsToOrgOrGlobal(c, ORG_A) && !(c.organizationId || c.organization_id),
    );
  assert(preferred?.id === 'ch-org-a', 'Org A ticket prefers Org A Send-As channel');

  const whenOrgDisabled = [orgADisabled, orgBChannel, hubcomGlobal];
  const fallback =
    whenOrgDisabled.find(
      (c) =>
        channelBelongsToOrgOrGlobal(c, ORG_A) &&
        isHealthySendAsGraph(c) &&
        (c.organizationId || c.organization_id) === ORG_A &&
        c.sendAsEnabled === true,
    ) ||
    whenOrgDisabled.find(
      (c) =>
        channelBelongsToOrgOrGlobal(c, ORG_A) &&
        !(c.organizationId || c.organization_id) &&
        isHealthySendAsGraph(c),
    );
  assert(fallback?.id === 'ch-hubcom', 'falls back to Hubcom when Org A Send-As disabled');
  assert(fallback?.id !== 'ch-org-b', 'never falls back to Org B channel');
}

function testHubcomStaffBypass(): void {
  console.log('\n[7] Hubcom staff vs portal role helpers');
  assert(isClientPortalRole(hubcomAdmin.role) === false, 'SYSTEM_ADMIN is not a portal role');
  assert(
    evaluateClientTicketVisibility(
      { id: hubcomAdmin.id, role: hubcomAdmin.role, organizationId: null },
      ticketOrgA,
    ) === false,
    'evaluateClientTicketVisibility is portal-only (staff use other paths)',
  );
}

function testPortalDashboardIsolation(): void {
  console.log('\n[8] Portal dashboard scoping (GET /api/portal/dashboard)');

  const mixedTickets = [
    ticketOrgA,
    ticketOrgAColleague,
    ticketOrgB,
    {
      id: 'ticket-a-waiting',
      subject: 'Waiting customer',
      organizationId: ORG_A,
      requesterId: orgAUser.id,
      status: 'waiting_customer',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'ticket-a-resolved',
      subject: 'Resolved recently',
      organizationId: ORG_A,
      requesterId: orgAUser.id,
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const adminDash = buildPortalDashboardPayload({
    role: 'CLIENT_ADMIN',
    userId: orgAAdmin.id,
    userName: 'Admin A',
    organizationId: ORG_A,
    organization: { id: ORG_A, name: 'Org A', portalTitle: 'Org A ServiceDesk' },
    tickets: mixedTickets,
    teamSummary: {
      totalActive: 3,
      clientAdmins: 1,
      clientSupporters: 1,
      clientUsers: 1,
    },
    emailStatus: {
      configured: true,
      healthy: true,
      mailbox: 'it@orga.test',
      status: 'connected',
      sendAsEnabled: true,
    },
  });

  assert(adminDash.role === 'CLIENT_ADMIN', 'admin dashboard role');
  assert(
    Number(adminDash.kpis.openCompanyTickets) >= 2,
    'CLIENT_ADMIN sees org-wide open tickets',
  );
  assert(
    adminDash.tickets.every((t) => !String(t.id).includes('ticket-b')),
    'CLIENT_ADMIN dashboard never includes Org B tickets',
  );
  assert(adminDash.team?.clientAdmins === 1, 'CLIENT_ADMIN receives team summary');
  assert(adminDash.email?.mailbox === 'it@orga.test', 'CLIENT_ADMIN receives email status');
  assert(
    !JSON.stringify(adminDash).includes('Hubcom internal'),
    'dashboard payload strips internal notes',
  );
  assert(
    !JSON.stringify(adminDash).includes('secret diagnosis'),
    'dashboard payload strips AI internal fields',
  );

  const isolation = assertPortalDashboardTenantIsolation(adminDash, ORG_A, mixedTickets);
  assert(isolation.ok, `tenant isolation helper: ${isolation.reason || 'ok'}`);

  const supporterDash = buildPortalDashboardPayload({
    role: 'CLIENT_SUPPORTER',
    userId: orgASupporter.id,
    userName: 'Supporter A',
    organizationId: ORG_A,
    organization: { id: ORG_A, name: 'Org A' },
    tickets: mixedTickets,
  });
  assert(supporterDash.team == null, 'CLIENT_SUPPORTER has no team admin card data');
  assert(supporterDash.email == null, 'CLIENT_SUPPORTER has no M365 config card data');
  assert(
    Number(supporterDash.kpis.openCompanyTickets) >= 2,
    'CLIENT_SUPPORTER sees org-wide open tickets',
  );
  assert(
    supporterDash.tickets.every((t) => t.id !== 'ticket-b-1'),
    'CLIENT_SUPPORTER cannot see Org B',
  );

  const userDash = buildPortalDashboardPayload({
    role: 'CLIENT_USER',
    userId: orgAUser.id,
    userName: 'User A',
    organizationId: ORG_A,
    organization: { id: ORG_A, name: 'Org A' },
    tickets: mixedTickets,
    participantTicketIds: [],
  });
  assert(userDash.team == null && userDash.email == null, 'CLIENT_USER has no admin widgets');
  assert(
    (userDash.myOpenTickets || []).every(
      (t) => t.id === 'ticket-a-1' || t.id === 'ticket-a-waiting',
    ),
    'CLIENT_USER only sees own open tickets (not colleague)',
  );
  assert(
    !(userDash.myOpenTickets || []).some((t) => t.id === 'ticket-a-2'),
    'CLIENT_USER cannot see colleague ticket without participation',
  );
  assert(
    !(userDash.myOpenTickets || []).some((t) => t.id === 'ticket-b-1'),
    'CLIENT_USER cannot see Org B tickets',
  );

  const participantDash = buildPortalDashboardPayload({
    role: 'CLIENT_USER',
    userId: orgAUser.id,
    userName: 'User A',
    organizationId: ORG_A,
    organization: { id: ORG_A, name: 'Org A' },
    tickets: mixedTickets,
    participantTicketIds: ['ticket-a-2'],
  });
  assert(
    (participantDash.myOpenTickets || []).some((t) => t.id === 'ticket-a-2'),
    'CLIENT_USER can see tickets where they are a participant',
  );

  let threw = false;
  try {
    buildPortalDashboardPayload({
      role: 'SYSTEM_ADMIN',
      userId: hubcomAdmin.id,
      userName: 'Staff',
      organizationId: ORG_A,
      organization: { id: ORG_A, name: 'Org A' },
      tickets: mixedTickets,
    });
  } catch (err: any) {
    threw = err?.status === 403 || /portal role/i.test(String(err?.message || ''));
  }
  assert(threw, 'non-portal roles are rejected with 403 semantics');
}

function testPortalSessionBootstrapWithoutRolesDb(): void {
  console.log('\n[9] Portal session bootstrap never needs /api/db "roles"');

  for (const role of ['CLIENT_ADMIN', 'CLIENT_SUPPORTER', 'CLIENT_USER'] as const) {
    assert(
      shouldFetchRolesCollection(role) === false,
      `${role} must not fetch /api/db collection "roles"`,
    );
    const deny = assertDbCollectionAccess({
      collection: 'roles',
      action: 'get_doc',
      userIsAdmin: false,
      userRole: role,
      userId: `user-${role}`,
      docId: 'role-client-admin',
    });
    assert(deny.allowed === false, `${role} get_doc roles remains 403`);
    assert(
      deny.allowed === false && deny.status === 403,
      `${role} roles denial status is 403`,
    );

    const profile = buildClientPortalUserProfile(
      {
        id: `uid-${role}`,
        name: 'Portal User',
        email: `${role.toLowerCase()}@orga.test`,
        role,
        organizationId: ORG_A,
      },
      { uid: `uid-${role}`, email: `${role.toLowerCase()}@orga.test` },
    );
    assert(!!profile, `${role} profile builds from session`);
    assert(profile!.role === role, `${role} profile role matches`);
    assert(profile!.organizationId === ORG_A, `${role} profile org matches`);

    const rbac = buildClientPortalUserRole(role);
    assert(rbac.name === role, `${role} in-memory RBAC name`);
    assert(rbac.permissions.tickets?.view === true, `${role} ticket view from seed`);
  }

  assert(
    shouldFetchRolesCollection('SYSTEM_ADMIN') === true,
    'Hubcom SYSTEM_ADMIN may still load roles docs',
  );
  assert(
    shouldFetchRolesCollection('agent') === true,
    'Hubcom agent may still load roles docs',
  );
}

/**
 * Staff-created tickets must carry organizationId so CLIENT_ADMIN
 * "Alle Firmen-Tickets" sees them — with or without requesterId.
 */
async function testStaffTicketOrgStampAndPortalVisibility(): Promise<void> {
  console.log('\n[10] Staff ticket → organizationId stamp → portal Alle Firmen-Tickets');

  const CITADELLE = ORG_A;
  const DPG = ORG_B;

  // Simulate Hubcom SYSTEM_ADMIN create payload that only had companyId historically.
  const stampedWithRequester = applyTicketOrganizationStamp(
    {
      id: 'ticket-staff-with-requester',
      subject: 'Staff ticket with contact',
      companyId: 'crm-citadelle',
      company: 'Citadelle AG',
      customerName: 'Premton Xhafa',
      customerEmail: 'premton@citadelle.test',
      customerId: 'user-a-user',
      requesterId: orgAUser.id,
      status: 'open',
    },
    { organizationId: CITADELLE, companyName: 'Citadelle AG', companyId: 'crm-citadelle' },
  );

  assert(
    stampedWithRequester.organizationId === CITADELLE,
    'staff create stamps organizationId (with requester)',
  );
  assert(
    stampedWithRequester.organization_id === CITADELLE,
    'staff create stamps organization_id alias',
  );
  assert(
    stampedWithRequester.company === 'Citadelle AG',
    'staff create persists company display name',
  );
  assert(
    stampedWithRequester.customerEmail === 'premton@citadelle.test',
    'staff create persists customerEmail',
  );
  assert(
    ticketOrganizationId(stampedWithRequester) === CITADELLE,
    'ticketOrganizationId reads stamped org',
  );

  const stampedOrgOnly = applyTicketOrganizationStamp(
    {
      id: 'ticket-staff-org-only',
      subject: 'Org-level staff ticket (no contact)',
      companyId: 'crm-citadelle',
      status: 'open',
    },
    { organizationId: CITADELLE, companyName: 'Citadelle AG', companyId: 'crm-citadelle' },
  );
  assert(
    ticketOrganizationId(stampedOrgOnly) === CITADELLE,
    'org-level staff ticket (no requester) still gets organizationId',
  );
  assert(
    !stampedOrgOnly.requesterId,
    'org-level staff ticket may omit requesterId',
  );

  // Legacy ticket without organizationId must NOT appear in portal lists.
  const legacyUnscoped = {
    id: 'ticket-legacy-tkt-53',
    subject: 'Legacy #TKT-53',
    companyId: 'crm-citadelle',
    company: 'Citadelle AG',
    status: 'open',
  };
  assert(
    evaluateClientTicketVisibility(orgAAdmin, legacyUnscoped as any) === false,
    'CLIENT_ADMIN cannot see ticket without organizationId (pre-fix)',
  );

  // After stamp / backfill — Citadelle ADMIN/SUPPORTER see it; DPG does not.
  for (const actor of [orgAAdmin, orgASupporter]) {
    assert(
      evaluateClientTicketVisibility(actor, stampedOrgOnly as any) === true,
      `${actor.role} sees staff org ticket in Alle Firmen-Tickets (no requester)`,
    );
    assert(
      evaluateClientTicketVisibility(actor, stampedWithRequester as any) === true,
      `${actor.role} sees staff ticket with requester`,
    );
  }

  assert(
    evaluateClientTicketVisibility(orgBAdmin, stampedOrgOnly as any) === false,
    'DPG CLIENT_ADMIN does NOT see Citadelle staff ticket',
  );
  assert(
    evaluateClientTicketVisibility(orgBAdmin, stampedWithRequester as any) === false,
    'DPG CLIENT_ADMIN does NOT see Citadelle ticket with requester',
  );

  const filtered = await filterTicketsForClient(orgAAdmin, [
    stampedOrgOnly,
    stampedWithRequester,
    { ...stampedOrgOnly, id: 'other-dpg', organizationId: DPG, organization_id: DPG },
    legacyUnscoped,
  ] as any);
  const ids = new Set(filtered.map((t: any) => String(t.id)));
  assert(ids.has('ticket-staff-org-only'), 'filter includes org-only staff ticket');
  assert(ids.has('ticket-staff-with-requester'), 'filter includes requester staff ticket');
  assert(!ids.has('other-dpg'), 'filter excludes DPG tickets for Citadelle admin');
  assert(!ids.has('ticket-legacy-tkt-53'), 'filter excludes unscoped legacy tickets');

  // CLIENT_USER with requester sees Meine Tickets; without requester does not.
  assert(
    evaluateClientTicketVisibility(orgAUser, stampedWithRequester as any) === true,
    'CLIENT_USER sees staff ticket when requesterId matches',
  );
  assert(
    evaluateClientTicketVisibility(orgAUser, stampedOrgOnly as any) === false,
    'CLIENT_USER does not see org-level ticket without requester/participation',
  );

  // Empty customerId must not become @domain.com via stamp helper.
  const emptyCustomer = applyTicketOrganizationStamp(
    { subject: 'x', companyId: 'c1', customerId: '', customerEmail: '' },
    { organizationId: CITADELLE, companyName: 'Citadelle AG' },
  );
  assert(
    emptyCustomer.customerId !== '@domain.com',
    'stamp never invents @domain.com customerId',
  );

  // #TKT-9 style: company name + contact email, then stamp organizations.id.
  const tkt9Payload = applyTicketOrganizationStamp(
    {
      id: 'TKT-9',
      subject: 'Staff create → portal visibility',
      company: 'Citadelle AG',
      companyId: 'crm-citadelle',
      customerName: 'Premton Xhafa',
      customerEmail: 'premton@citadelle.test',
      requesterId: orgAUser.id,
      requester_id: orgAUser.id,
      status: 'open',
    },
    { organizationId: CITADELLE, companyName: 'Citadelle AG', companyId: 'crm-citadelle' },
  );
  assert(
    ticketOrganizationId(tkt9Payload) === CITADELLE,
    '#TKT-9 style payload stamps Citadelle organizations.id',
  );
  assert(
    tkt9Payload.customerName === 'Premton Xhafa' &&
      tkt9Payload.customerEmail === 'premton@citadelle.test' &&
      tkt9Payload.requesterId === orgAUser.id,
    '#TKT-9 style payload keeps requester + customer email',
  );
  assert(
    evaluateClientTicketVisibility(orgAAdmin, tkt9Payload as any) === true,
    'Citadelle CLIENT_ADMIN sees #TKT-9 in Alle Firmen-Tickets',
  );
  assert(
    evaluateClientTicketVisibility(orgBAdmin, tkt9Payload as any) === false,
    'DPG CLIENT_ADMIN receives 0 visibility for #TKT-9',
  );

  // Direct ID lookup guard — DPG must not read Citadelle ticket (403/404 semantics).
  const dpgDenied = await postFilterClientDbResult({
    user: {
      id: orgBAdmin.id,
      role: orgBAdmin.role,
      organizationId: orgBAdmin.organizationId,
    } as any,
    collection: 'tickets',
    action: 'get_doc',
    doc: tkt9Payload as any,
  });
  assert(
    dpgDenied.denied === true,
    'DPG CLIENT_ADMIN denied on direct #TKT-9 lookup (403/404)',
  );

  const citadelleList = await postFilterClientDbResult({
    user: {
      id: orgAAdmin.id,
      role: orgAAdmin.role,
      organizationId: orgAAdmin.organizationId,
    } as any,
    collection: 'tickets',
    action: 'get_docs',
    docs: [
      tkt9Payload as any,
      { ...tkt9Payload, id: 'other-dpg', organizationId: DPG, organization_id: DPG },
    ],
  });
  const allowedIds = new Set(
    ((citadelleList.docs || []) as any[]).map((t) => String(t.id)),
  );
  assert(allowedIds.has('TKT-9'), 'Citadelle CLIENT_ADMIN list includes #TKT-9');
  assert(!allowedIds.has('other-dpg'), 'Citadelle CLIENT_ADMIN list excludes DPG tickets');

  const dpgList = await postFilterClientDbResult({
    user: {
      id: orgBAdmin.id,
      role: orgBAdmin.role,
      organizationId: orgBAdmin.organizationId,
    } as any,
    collection: 'tickets',
    action: 'get_docs',
    docs: [tkt9Payload as any],
  });
  assert(
    Array.isArray(dpgList.docs) && dpgList.docs.length === 0,
    'DPG CLIENT_ADMIN Alle Firmen-Tickets returns 0 for Citadelle #TKT-9',
  );

  // Email-domain / name matching helpers (inbound + backfill).
  const orgFixtures = [
    {
      id: CITADELLE,
      name: 'Citadelle AG',
      domain: 'citadelle.test',
      slug: 'citadelle',
    },
    {
      id: DPG,
      name: 'DPG',
      domain: 'dpg.test',
      slug: 'dpg',
    },
  ] as OrganizationRecord[];
  assert(
    matchOrganizationByEmailDomain(orgFixtures, 'premton@citadelle.test')?.id === CITADELLE,
    'email domain maps to Citadelle organization',
  );
  assert(
    matchOrganizationByName(orgFixtures, 'Citadelle AG')?.id === CITADELLE,
    'company name maps to Citadelle organization',
  );
  assert(
    matchOrganizationByEmailDomain(orgFixtures, 'other@dpg.test')?.id === DPG,
    'email domain maps to DPG organization',
  );
}

async function main(): Promise<void> {
  console.log('=== Client Portal Isolation & RBAC Suite (Phase 5) ===');
  testCrossTenantBlock();
  testInternalNotesBlock();
  await testClientUserScoping();
  await testPrivilegeEscalation();
  testSecretProtection();
  testOutboundFallback();
  testHubcomStaffBypass();
  testPortalDashboardIsolation();
  testPortalSessionBootstrapWithoutRolesDb();
  await testStaffTicketOrgStampAndPortalVisibility();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('OK: client portal isolation suite passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
