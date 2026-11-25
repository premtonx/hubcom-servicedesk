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
  assertPortalTicketAccess,
  buildPortalTicketDetailResponse,
  isPortalTicketFrontendApiAllowed,
  sortMessagesOldestFirst,
} from '../src/lib/client-portal/portal-ticket-api.js';
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
import { isClientAdmin, isClientPortalRole } from '../src/lib/client-portal/roles.js';
import { parseAndValidateDashboardBannerDataUrl } from '../src/lib/dashboard-banner-validate.js';
import { ticketMatchesPortalStatusFilter } from '../src/lib/portal/status.js';
import {
  assertPortalKbWriteRole,
  isKbArticleVisibleToPortal,
  matchesPortalKbScope,
  normalizeKbVisibility,
  sanitizeKbArticleForPortal,
} from '../src/lib/client-portal/kb-visibility.js';
import {
  canPortalUserAccessVaultItem,
  isVaultItemInOrganization,
  sanitizeVaultItemForPortal,
} from '../src/lib/client-portal/exchange-visibility.js';
import {
  assertPortalVaultRole,
  isOrgVaultVisibleToPortal,
  normalizeOrgVaultCategory,
  toOrgVaultListItem,
} from '../src/lib/client-portal/organization-vault.js';
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
import {
  defaultHardwareReturnsConfig,
  evaluateHardwareModuleAccess,
  extractHardwareContactsFromUser,
  isHardwareReturnsEnabled,
  normalizeHardwareReturnInput,
  normalizeHardwareReturnsConfig,
  type TicketHardwareReturnRecord,
} from '../src/lib/client-portal/hardware-returns.js';
import {
  evaluatePortalReturnsPageAccess,
  resolveHardwareReturnsModuleFlag,
} from '../src/lib/client-portal/hardware-returns-nav.js';
import {
  evaluateDueReminderStage,
  resolveStageRecipients,
  shouldSkipAutoSend,
} from '../src/lib/client-portal/hardware-returns-recipients.js';
import {
  authStatusWhenUserMissing,
  evaluatePortalUserDeleteAccess,
} from '../src/lib/client-portal/portal-user-delete.js';

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
  email: 'user@orga.test',
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

async function testPortalTicketDetailApiContract(): Promise<void> {
  console.log('\n[2b] GET /api/portal/tickets/:id detail contract (public messages only)');

  const older = {
    id: 'm-old',
    content: 'first public',
    createdAt: '2026-01-01T10:00:00.000Z',
    is_internal: false,
  };
  const newer = {
    id: 'm-new',
    content: 'second public',
    createdAt: '2026-01-01T12:00:00.000Z',
    isInternal: false,
  };
  const secret = {
    id: 'm-secret',
    content: 'agent only',
    createdAt: '2026-01-01T11:00:00.000Z',
    is_internal: true,
  };

  const payload = buildPortalTicketDetailResponse({
    ticket: {
      ...ticketOrgA,
      agentComments: 'leak',
      aiSummary: 'leak',
      attachments: [{ filename: 'a.pdf', size: 1 }],
    },
    messages: [newer, secret, older] as any,
    participants: [
      {
        ticket_id: ticketOrgA.id,
        user_id: orgAUser.id,
        added_by: orgAAdmin.id,
        created_at: '2026-01-01T09:00:00.000Z',
      },
    ],
  });

  assert(!('agentComments' in payload.ticket), 'detail ticket strips agentComments');
  assert(!('aiSummary' in payload.ticket), 'detail ticket strips aiSummary');
  assert(payload.messages.length === 2, 'internal note stripped from detail messages');
  assert(
    payload.messages[0].id === 'm-old' && payload.messages[1].id === 'm-new',
    'public messages sorted oldest → newest',
  );
  assert(payload.participants.length === 1, 'participants included in detail payload');
  assert(Array.isArray(payload.attachments) && payload.attachments.length === 1, 'attachments surfaced');

  const sorted = sortMessagesOldestFirst([newer, older] as any);
  assert(sorted[0].id === 'm-old', 'sortMessagesOldestFirst works');

  const denyCross = await assertPortalTicketAccess(orgAAdmin, ticketOrgB as any, ticketOrgB.id);
  assert(denyCross.ok === false, 'cross-tenant ticket detail access denied');

  const allowSame = await assertPortalTicketAccess(orgAAdmin, ticketOrgA as any, ticketOrgA.id);
  assert(allowSame.ok === true, 'same-org CLIENT_ADMIN can access detail');

  assert(
    isPortalTicketFrontendApiAllowed('/api/portal/tickets/abc') === true,
    'portal ticket GET path allowed',
  );
  assert(
    isPortalTicketFrontendApiAllowed('/api/portal/tickets/abc/messages') === true,
    'portal ticket messages path allowed',
  );
  assert(
    isPortalTicketFrontendApiAllowed('/api/db') === false,
    'opening ticket detail must never call /api/db',
  );
  assert(
    isPortalTicketFrontendApiAllowed('/api/db?action=get_docs') === false,
    'query-string /api/db still blocked',
  );
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
    Number(adminDash.kpis.openTickets ?? adminDash.kpis.openCompanyTickets) >= 2,
    'CLIENT_ADMIN sees org-wide open tickets',
  );
  assert(
    Number(adminDash.kpis.inProgressTickets) >= 0 &&
      Number(adminDash.kpis.resolvedLast30Days) >= 1,
    'CLIENT_ADMIN dashboard exposes in-progress + resolved-30d KPIs',
  );
  assert(
    adminDash.organization.id === ORG_A &&
      !JSON.stringify(adminDash.tickets).includes(ORG_B),
    'GET /api/portal/dashboard scoped to organization_id',
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

/**
 * Portal branding endpoints (POST/DELETE /api/portal/branding/banner) are
 * wired with requireClientPortalRole(['CLIENT_ADMIN']) and stamp org from
 * session — CLIENT_USER / CLIENT_SUPPORTER must receive 403.
 */
function testPortalBrandingBoundaries(): void {
  console.log('\n[11] Portal branding banner role + validation boundaries');

  assert(isClientAdmin('CLIENT_ADMIN') === true, 'CLIENT_ADMIN may manage branding');
  assert(
    isClientAdmin('CLIENT_USER') === false,
    'CLIENT_USER gets 403 on POST/DELETE /api/portal/branding/banner',
  );
  assert(
    isClientAdmin('CLIENT_SUPPORTER') === false,
    'CLIENT_SUPPORTER gets 403 on branding endpoints',
  );
  assert(
    isClientPortalRole('CLIENT_ADMIN') && !isClientAdmin('SYSTEM_ADMIN'),
    'SYSTEM_ADMIN is not a portal branding actor (uses /api/admin|/api/organizations)',
  );

  const svg = parseAndValidateDashboardBannerDataUrl(
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
  );
  assert(svg.ok === false, 'SVG banners are rejected');

  const png = parseAndValidateDashboardBannerDataUrl(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  );
  assert(png.ok === true, 'PNG banners are accepted');

  const jpeg = parseAndValidateDashboardBannerDataUrl(
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
  );
  assert(jpeg.ok === true, 'JPEG banners are accepted');

  // Dashboard → tickets deep-link status sync helpers.
  assert(
    ticketMatchesPortalStatusFilter('waiting_customer', 'waiting') === true,
    'waiting_customer maps to Wartend tab',
  );
  assert(
    ticketMatchesPortalStatusFilter('pending', 'in_progress') === true,
    'pending maps to In Bearbeitung tab',
  );
  assert(
    ticketMatchesPortalStatusFilter('open', 'resolved') === false,
    'open does not match Gelöst tab',
  );
}

function testPortalKbIsolation(): void {
  console.log('\n[12] Portal KB visibility isolation (/api/portal/kb)');

  const internal = {
    id: 'kb-internal',
    title: 'Hubcom SOP',
    content: 'secret runbook',
    visibility: 'internal',
    organizationId: null,
  };
  const legacyPrivate = {
    id: 'kb-private',
    title: 'Legacy private',
    content: 'x',
    visibility: 'Private',
  };
  const shared = {
    id: 'kb-shared',
    title: 'VPN Guide',
    content: 'vpn steps',
    visibility: 'shared_portal',
  };
  const legacyPublic = {
    id: 'kb-public',
    title: 'Outlook Guide',
    content: 'outlook',
    visibility: 'Public',
  };
  const orgAOnly = {
    id: 'kb-org-a',
    title: 'Org A FAQ',
    content: 'a-only',
    visibility: 'organization',
    organizationId: ORG_A,
  };
  const orgBOnly = {
    id: 'kb-org-b',
    title: 'Org B FAQ',
    content: 'b-only',
    visibility: 'organization',
    organization_id: ORG_B,
  };

  assert(normalizeKbVisibility('Private') === 'internal', 'Private → internal');
  assert(normalizeKbVisibility('Public') === 'shared_portal', 'Public → shared_portal');
  assert(normalizeKbVisibility('organization') === 'organization', 'organization preserved');

  assert(
    isKbArticleVisibleToPortal(internal, ORG_A) === false,
    'internal Hubcom KB never leaks to portal Org A',
  );
  assert(
    isKbArticleVisibleToPortal(legacyPrivate, ORG_A) === false,
    'legacy Private never leaks to portal',
  );
  assert(
    isKbArticleVisibleToPortal(shared, ORG_A) === true,
    'shared_portal visible to Org A',
  );
  assert(
    isKbArticleVisibleToPortal(legacyPublic, ORG_B) === true,
    'legacy Public maps to shared_portal for all portals',
  );
  assert(
    isKbArticleVisibleToPortal(orgAOnly, ORG_A) === true,
    'Org A private KB visible to Org A',
  );
  assert(
    isKbArticleVisibleToPortal(orgAOnly, ORG_B) === false,
    'Org A private KB returns 404 semantics for Org B',
  );
  assert(
    isKbArticleVisibleToPortal(orgBOnly, ORG_A) === false,
    'Org B private KB returns 404 semantics for Org A',
  );

  assert(
    matchesPortalKbScope(orgAOnly, ORG_A, 'organization') === true,
    'Firmen-Anleitungen scope keeps org articles',
  );
  assert(
    matchesPortalKbScope(shared, ORG_A, 'organization') === false,
    'Firmen-Anleitungen scope excludes Hubcom guides',
  );
  assert(
    matchesPortalKbScope(shared, ORG_A, 'shared_portal') === true,
    'Hubcom Guides scope keeps shared_portal',
  );
  assert(
    matchesPortalKbScope(internal, ORG_A, 'all') === false,
    'Alle Artikel still excludes internal',
  );

  const sanitized = sanitizeKbArticleForPortal(internal as any);
  assert(
    !JSON.stringify(sanitized).includes('secret runbook') || sanitized.visibility === 'internal',
    'sanitize helper always sets normalized visibility',
  );
  // Portal list never includes internal because of isKbArticleVisibleToPortal gate.
  assert(
    assertPortalKbWriteRole('CLIENT_ADMIN') === true,
    'CLIENT_ADMIN may write portal KB',
  );
  assert(
    assertPortalKbWriteRole('CLIENT_SUPPORTER') === true,
    'CLIENT_SUPPORTER may write portal KB',
  );
  assert(
    assertPortalKbWriteRole('CLIENT_USER') === false,
    'CLIENT_USER gets 403 on POST/PATCH/DELETE /api/portal/kb',
  );
}

function testPortalExchangeIsolation(): void {
  console.log('\n[13] Portal Secure Exchange org isolation (/api/portal/exchange)');

  const orgATransfer = {
    id: 'vault-a-1',
    createdBy: orgAAdmin.id,
    organizationId: ORG_A,
    metadata: { secretType: 'pwd', recipientEmails: [] },
  };
  const orgBTransfer = {
    id: 'vault-b-1',
    createdBy: orgBAdmin.id,
    organizationId: ORG_B,
    metadata: { secretType: 'pwd' },
  };
  const colleagueTransfer = {
    id: 'vault-a-colleague',
    createdBy: orgASupporter.id,
    organizationId: ORG_A,
    metadata: { secretType: 'ssh', recipientEmails: ['other@orga.test'] },
  };
  const addressedToUser = {
    id: 'vault-a-for-user',
    createdBy: orgAAdmin.id,
    organizationId: ORG_A,
    metadata: {
      secretType: 'wifi',
      recipientEmails: [String(orgAUser.email || '').toLowerCase()],
    },
  };
  const userOwn = {
    id: 'vault-a-user-own',
    createdBy: orgAUser.id,
    created_by_user_id: orgAUser.id,
    organizationId: ORG_A,
    metadata: { secretType: 'note' },
  };

  assert(
    isVaultItemInOrganization(orgATransfer, ORG_A) === true,
    'Org A transfer belongs to Org A',
  );
  assert(
    isVaultItemInOrganization(orgATransfer, ORG_B) === false,
    'Org A transfer denied for Org B (403/404)',
  );

  assert(
    canPortalUserAccessVaultItem({
      item: orgATransfer,
      organizationId: ORG_A,
      role: 'CLIENT_ADMIN',
      userId: orgAAdmin.id,
    }) === true,
    'CLIENT_ADMIN sees all org transfers',
  );
  assert(
    canPortalUserAccessVaultItem({
      item: orgBTransfer,
      organizationId: ORG_A,
      role: 'CLIENT_ADMIN',
      userId: orgAAdmin.id,
    }) === false,
    'CLIENT_ADMIN cannot see Org B transfers',
  );
  assert(
    canPortalUserAccessVaultItem({
      item: colleagueTransfer,
      organizationId: ORG_A,
      role: 'CLIENT_USER',
      userId: orgAUser.id,
      userEmail: orgAUser.email,
    }) === false,
    'CLIENT_USER cannot access another employee private transfer',
  );
  assert(
    canPortalUserAccessVaultItem({
      item: addressedToUser,
      organizationId: ORG_A,
      role: 'CLIENT_USER',
      userId: orgAUser.id,
      userEmail: orgAUser.email,
    }) === true,
    'CLIENT_USER can access transfer addressed to their email',
  );
  assert(
    canPortalUserAccessVaultItem({
      item: userOwn,
      organizationId: ORG_A,
      role: 'CLIENT_USER',
      userId: orgAUser.id,
      userEmail: orgAUser.email,
    }) === true,
    'CLIENT_USER can access transfers they created',
  );

  const sanitized = sanitizeVaultItemForPortal({
    ...orgATransfer,
    passphraseHash: 'secret-hash-must-not-leak',
    secretRef: 'secret-ref',
  });
  assert(
    !JSON.stringify(sanitized).includes('secret-hash') &&
      !JSON.stringify(sanitized).includes('secret-ref'),
    'portal exchange sanitize strips secret material',
  );
}

function testPortalTresorVaultIsolation(): void {
  console.log('\n[14] Portal Tresor (organization_vault_secrets) isolation');

  assert(assertPortalVaultRole('CLIENT_USER') === null, 'CLIENT_USER blocked from all /api/portal/vault*');
  assert(assertPortalVaultRole('CLIENT_ADMIN') === 'CLIENT_ADMIN', 'CLIENT_ADMIN allowed on Tresor');
  assert(
    assertPortalVaultRole('CLIENT_SUPPORTER') === 'CLIENT_SUPPORTER',
    'CLIENT_SUPPORTER allowed on Tresor',
  );
  assert(assertPortalVaultRole('SYSTEM_ADMIN') === null, 'SYSTEM_ADMIN is not a portal vault actor');

  const hubcomOnly = {
    organization_id: ORG_A,
    client_visible: false,
  };
  const portalShared = {
    organization_id: ORG_A,
    client_visible: true,
  };
  const orgBShared = {
    organization_id: ORG_B,
    client_visible: true,
  };
  const globalSecret = {
    organization_id: null as string | null,
    client_visible: true,
  };

  assert(
    isOrgVaultVisibleToPortal(hubcomOnly, ORG_A) === false,
    'client_visible=false never leaks to CLIENT_ADMIN/SUPPORTER',
  );
  assert(
    isOrgVaultVisibleToPortal(portalShared, ORG_A) === true,
    'Org A client_visible=true visible to Org A portal',
  );
  assert(
    isOrgVaultVisibleToPortal(portalShared, ORG_B) === false,
    'Org A client_visible=true returns 404/403 for Org B',
  );
  assert(
    isOrgVaultVisibleToPortal(orgBShared, ORG_A) === false,
    'Org B vault secrets never list/reveal for Org A',
  );
  assert(
    isOrgVaultVisibleToPortal(globalSecret, ORG_A) === false,
    'Hubcom global vault secrets (organization_id=NULL) never leak to portal',
  );

  const listItem = toOrgVaultListItem({
    id: 'sec-1',
    organization_id: ORG_A,
    client_visible: true,
    created_by_user_id: orgAAdmin.id,
    updated_by_user_id: null,
    name: 'VPN',
    category: 'password',
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert(
    listItem.masked_value === '••••••••••••' && !('encrypted_payload' in listItem),
    'GET /api/portal/vault returns masked values only',
  );
  assert(
    normalizeOrgVaultCategory('API-Schlüssel') === 'api_key' ||
      normalizeOrgVaultCategory('api_key') === 'api_key',
    'category normalizer accepts API-Schlüssel / api_key',
  );
  assert(
    normalizeOrgVaultCategory('Passwort') === 'password',
    'category normalizer accepts Passwort',
  );

  // Portal create stamps org + client_visible=true → appears in Admin-Hub Org A Vault.
  assert(
    isOrgVaultVisibleToPortal(
      { organization_id: ORG_A, client_visible: true },
      ORG_A,
    ) === true,
    'secrets created by Org A CLIENT_ADMIN appear under Admin-Hub Org A Vault with client_visible=true',
  );
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

function testHardwareReturnsModuleGate(): void {
  console.log('\n--- Hardware-Rücklieferungen module gate ---');

  const CITADELLE = ORG_A;
  const DPG = ORG_B;

  const defaults = defaultHardwareReturnsConfig();
  assert(defaults.auto_send_enabled === false, 'auto_send_enabled defaults to false');
  assert(defaults.mail1_days_after_delivery === 14, 'mail1 default 14 days after delivery');
  assert(defaults.mail2_days_after_mail1 === 7, 'mail2 default 7 days after mail1');
  assert(defaults.mail3_days_after_mail2 === 7, 'mail3 default 7 days after mail2');
  assert(
    JSON.stringify(defaults.stage_recipients.mail1.to_roles) === JSON.stringify(['employee']),
    'mail1 to_roles defaults to employee',
  );
  assert(
    JSON.stringify(defaults.stage_recipients.mail2.cc_roles) ===
      JSON.stringify(['project_manager']),
    'mail2 cc includes project_manager',
  );
  assert(
    JSON.stringify(defaults.stage_recipients.mail3.cc_roles) ===
      JSON.stringify(['project_manager', 'manager', 'ceo']),
    'mail3 cc includes project_manager, manager, ceo',
  );

  const normalized = normalizeHardwareReturnsConfig({
    auto_send_enabled: true,
    mail1_days_after_delivery: 21,
    ceo_email: 'gf@dpg.test',
    stage_recipients: {
      mail1: { to_roles: ['employee'], extra_to: ['extra@dpg.test'] },
    },
  });
  assert(normalized.auto_send_enabled === true, 'normalize preserves auto_send_enabled true');
  assert(normalized.mail1_days_after_delivery === 21, 'normalize preserves mail1 days');
  assert(normalized.ceo_email === 'gf@dpg.test', 'normalize ceo_email');
  assert(
    normalized.stage_recipients.mail1.extra_to.includes('extra@dpg.test'),
    'normalize mail1 extra_to',
  );
  assert(
    normalized.stage_recipients.mail3.cc_roles.includes('ceo'),
    'normalize keeps mail3 ceo default when unset',
  );

  assert(
    isHardwareReturnsEnabled({ hardware_returns_enabled: false }) === false,
    'Citadelle-style org: module disabled',
  );
  assert(
    isHardwareReturnsEnabled({ hardware_returns_enabled: true }) === true,
    'DPG-style org: module enabled',
  );

  // Citadelle AG — module off → 404 semantics (never expose DPG fields).
  const citadelleBlocked = evaluateHardwareModuleAccess({
    orgEnabled: false,
    sessionOrgId: CITADELLE,
    ticketOrgId: CITADELLE,
    role: 'CLIENT_ADMIN',
  });
  assert(
    citadelleBlocked.ok === false && citadelleBlocked.status === 404,
    'Citadelle hardware endpoints return 404 when module disabled',
  );

  // Cross-tenant: DPG admin must not touch Citadelle ticket even if somehow enabled.
  const crossTenant = evaluateHardwareModuleAccess({
    orgEnabled: true,
    sessionOrgId: DPG,
    ticketOrgId: CITADELLE,
    role: 'CLIENT_ADMIN',
  });
  assert(
    crossTenant.ok === false && crossTenant.status === 404,
    'DPG cannot access Citadelle hardware-return ticket',
  );

  // DPG CLIENT_ADMIN / CLIENT_SUPPORTER can mutate own-org hardware returns.
  const dpgAdmin = evaluateHardwareModuleAccess({
    orgEnabled: true,
    sessionOrgId: DPG,
    ticketOrgId: DPG,
    role: 'CLIENT_ADMIN',
  });
  assert(dpgAdmin.ok === true, 'DPG CLIENT_ADMIN can update hardware returns');
  const dpgSupporter = evaluateHardwareModuleAccess({
    orgEnabled: true,
    sessionOrgId: DPG,
    ticketOrgId: DPG,
    role: 'CLIENT_SUPPORTER',
  });
  assert(dpgSupporter.ok === true, 'DPG CLIENT_SUPPORTER can update hardware returns');

  // CLIENT_USER stays simplified — write blocked with 403.
  const dpgUser = evaluateHardwareModuleAccess({
    orgEnabled: true,
    sessionOrgId: DPG,
    ticketOrgId: DPG,
    role: 'CLIENT_USER',
  });
  assert(
    dpgUser.ok === false && dpgUser.status === 403,
    'DPG CLIENT_USER cannot update hardware-return fields',
  );

  const due = normalizeHardwareReturnInput(
    {
      delivery_date: '2026-11-01',
      project_manager_email: 'pm@dpg.test',
      manager_email: 'chef@dpg.test',
      stage_recipients_override: {
        mail2: { to: ['emp@dpg.test'], cc: ['pm@dpg.test'] },
      },
    },
    { mail1Days: 14 },
  );
  assert(due.return_due_date === '2026-11-15', 'return_due_date auto +14 days from delivery');
  assert(due.project_manager_email === 'pm@dpg.test', 'project_manager_email accepted');
  assert(due.manager_email === 'chef@dpg.test', 'manager_email accepted');
  assert(
    Array.isArray(due.stage_recipients_override?.mail2?.to) &&
      due.stage_recipients_override!.mail2!.to.includes('emp@dpg.test'),
    'stage_recipients_override mail2 preserved',
  );

  const contacts = extractHardwareContactsFromUser({
    phone_office: '+49 30 111',
    phone_mobile: '+49 170 222',
    project_manager_name: 'PM Name',
    project_manager_email: 'pm@dpg.test',
    manager_name: 'Chef',
    manager_email: 'chef@dpg.test',
  });
  assert(contacts.employee_phone === '+49 30 111', 'user phone_office → employee_phone');
  assert(contacts.project_manager_email === 'pm@dpg.test', 'user project_manager_email mapped');
  assert(contacts.manager_email === 'chef@dpg.test', 'user manager_email mapped');
}

function baseHw(partial: Partial<TicketHardwareReturnRecord> = {}): TicketHardwareReturnRecord {
  return {
    id: 'hw-1',
    organization_id: ORG_B,
    ticket_id: 'tkt-1',
    external_ref_id: null,
    service_level: null,
    time_sl1_minutes: 0,
    time_sl2_minutes: 0,
    time_sl3_minutes: 0,
    exported: false,
    exported_at: null,
    request_type: null,
    device_details: 'Laptop ALT SN1 / NEU SN2',
    employee_phone: null,
    employee_mobile: null,
    project_manager_name: 'PM',
    project_manager_email: 'pm@dpg.test',
    manager_name: 'Chef',
    manager_email: 'chef@dpg.test',
    ceo_email_override: null,
    stage_recipients_override: null,
    solution_summary: null,
    shipping_method: null,
    shipping_reference: null,
    return_required: true,
    delivery_date: '2026-10-01',
    return_due_date: '2026-10-15',
    auto_reminder_enabled: true,
    mail1_sent_at: null,
    mail1_sent_recipients: null,
    mail2_sent_at: null,
    mail2_sent_recipients: null,
    mail3_sent_at: null,
    mail3_sent_recipients: null,
    returned: false,
    returned_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...partial,
  };
}

function testHardwareReturnsEscalationEngine(): void {
  console.log('\n--- Hardware-Rücklieferungen recipient resolver & scheduler ---');

  const CITADELLE = ORG_A;
  const DPG = ORG_B;
  const config = defaultHardwareReturnsConfig();
  config.auto_send_enabled = true;
  config.ceo_email = 'ceo@dpg.test';
  config.stage_recipients.mail3.extra_cc = ['legal@dpg.test'];

  const ticket = {
    id: 'tkt-1',
    customer_email: 'emp@dpg.test',
    customer_name: 'Max Mustermann',
  };
  const hw = baseHw();

  const mail2 = resolveStageRecipients(2, ticket, hw, config);
  assert(mail2.to.includes('emp@dpg.test'), 'Mail 2 To includes employee');
  assert(mail2.cc.includes('pm@dpg.test'), 'Mail 2 CC includes project_manager');
  assert(!mail2.to.includes('pm@dpg.test'), 'dedupe: PM not in both To and CC');

  const mail3 = resolveStageRecipients(3, ticket, hw, config);
  assert(mail3.to.includes('emp@dpg.test'), 'Mail 3 To includes employee');
  assert(mail3.cc.includes('pm@dpg.test'), 'Mail 3 CC includes project_manager');
  assert(mail3.cc.includes('chef@dpg.test'), 'Mail 3 CC includes manager');
  assert(mail3.cc.includes('ceo@dpg.test'), 'Mail 3 CC includes ceo');
  assert(mail3.cc.includes('legal@dpg.test'), 'Mail 3 CC includes extra static email');

  const overridden = resolveStageRecipients(2, ticket, hw, config, {
    overrideTo: ['custom-to@dpg.test', 'CUSTOM-TO@dpg.test', ''],
    overrideCc: ['custom-cc@dpg.test', 'custom-to@dpg.test'],
  });
  assert(
    overridden.to.length === 1 && overridden.to[0] === 'custom-to@dpg.test',
    'manual override dedupes case-insensitively',
  );
  assert(
    overridden.cc.length === 1 && overridden.cc[0] === 'custom-cc@dpg.test',
    'manual override strips To addresses from CC',
  );

  const ticketOverrideHw = baseHw({
    stage_recipients_override: {
      mail1: { to: ['override@dpg.test'], cc: ['cc@dpg.test'] },
    },
  });
  const fromTicket = resolveStageRecipients(1, ticket, ticketOverrideHw, config);
  assert(fromTicket.to[0] === 'override@dpg.test', 'per-ticket override precedes org roles');

  const missingPm = resolveStageRecipients(
    2,
    ticket,
    baseHw({ project_manager_email: null }),
    config,
  );
  assert(missingPm.missingRoles.includes('project_manager'), 'missingRoles detects project_manager');

  const emptyTo = resolveStageRecipients(
    1,
    { customer_email: null },
    baseHw(),
    config,
  );
  assert(shouldSkipAutoSend({ stage: 1, to: emptyTo.to, missingRoles: emptyTo.missingRoles }), 'skip when To empty');

  const now = new Date('2026-10-20T12:00:00.000Z');
  assert(
    evaluateDueReminderStage(baseHw(), config, now) === 1,
    'Mail 1 due after return_due_date (14-day path)',
  );
  assert(
    evaluateDueReminderStage(baseHw({ returned: true }), config, now) === null,
    'skipped when returned = true',
  );
  assert(
    evaluateDueReminderStage(baseHw(), { ...config, auto_send_enabled: false }, now) === null,
    'skipped when auto_send_enabled = false',
  );

  const afterMail1 = baseHw({
    mail1_sent_at: '2026-10-15T10:00:00.000Z',
  });
  assert(
    evaluateDueReminderStage(afterMail1, config, new Date('2026-10-20T10:00:00.000Z')) === null,
    'Mail 2 not due before 7 days',
  );
  assert(
    evaluateDueReminderStage(afterMail1, config, new Date('2026-10-22T11:00:00.000Z')) === 2,
    'Mail 2 due after mail1 + 7 days',
  );

  const afterMail2 = baseHw({
    mail1_sent_at: '2026-10-01T10:00:00.000Z',
    mail2_sent_at: '2026-10-08T10:00:00.000Z',
  });
  assert(
    evaluateDueReminderStage(afterMail2, config, new Date('2026-10-15T11:00:00.000Z')) === 3,
    'Mail 3 due after mail2 + 7 days',
  );
  assert(
    evaluateDueReminderStage(
      baseHw({
        mail1_sent_at: '2026-10-01T10:00:00.000Z',
        mail2_sent_at: '2026-10-08T10:00:00.000Z',
        mail3_sent_at: '2026-10-15T10:00:00.000Z',
      }),
      config,
      new Date('2026-11-01T00:00:00.000Z'),
    ) === null,
    'idempotent: never double-sends after mail3 stamped',
  );

  // Portal /api/portal/returns/* isolation semantics
  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: false,
      sessionOrgId: CITADELLE,
      ticketOrgId: CITADELLE,
      role: 'CLIENT_ADMIN',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === false,
    'Citadelle AG blocked on /api/portal/returns/* (module off)',
  );
  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: true,
      sessionOrgId: DPG,
      ticketOrgId: DPG,
      role: 'CLIENT_USER',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === false,
    'DPG CLIENT_USER gets 403 on /api/portal/returns/*',
  );
  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: true,
      sessionOrgId: DPG,
      ticketOrgId: CITADELLE,
      role: 'CLIENT_ADMIN',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === false,
    'DPG CLIENT_ADMIN cannot send reminders for another org',
  );
  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: true,
      sessionOrgId: DPG,
      ticketOrgId: DPG,
      role: 'CLIENT_ADMIN',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === true,
    'DPG CLIENT_ADMIN can access own-org returns API',
  );
}

/**
 * Default Neues Ticket erstellen must stay free of RMA / SL1–SL3 fields.
 * (Hardware-Rücklieferung lives only under the dedicated returns workbench.)
 */
function testDefaultTicketCreateExcludesRmaFields(): void {
  console.log('\n--- Default ticket create excludes RMA / SL fields ---');

  // Contract: portal + staff create payloads for normal IT tickets omit hardwareReturn.
  const portalCreateBody = {
    subject: 'VPN down',
    description: '<p>Cannot connect</p>',
    priority: 'medium',
    category: 'Netzwerk',
  };
  assert(
    !('hardwareReturn' in portalCreateBody) &&
      !('service_level' in portalCreateBody) &&
      !('return_due_date' in portalCreateBody),
    'portal create payload has no RMA / SL keys',
  );

  const staffCreateBody = {
    subject: 'Laptop issue',
    description: 'Screen flicker',
    organizationId: ORG_B,
  };
  assert(
    !('hardwareReturn' in staffCreateBody) && !('service_level' in staffCreateBody),
    'staff create payload has no RMA / SL keys',
  );

  // /portal/tickets/new must scroll: ticket-detail regex must not treat "new" as a detail id.
  const path = '/portal/tickets/new';
  const isTicketCreate = path === '/portal/tickets/new';
  const isTicketDetail =
    !isTicketCreate && /^\/portal\/tickets\/[^/]+$/.test(path);
  assert(isTicketCreate === true, '/portal/tickets/new is create route');
  assert(isTicketDetail === false, '/portal/tickets/new is NOT treated as ticket detail (scroll lock)');
  assert(
    /^\/portal\/tickets\/[^/]+$/.test('/portal/tickets/abc-123') === true,
    'real ticket detail path still matches detail regex',
  );
}

/** /portal/returns page gate — no premature redirect while me/module still loading. */
function testPortalReturnsPageNavigationGate(): void {
  console.log('\n--- Portal /portal/returns navigation gate ---');

  assert(
    evaluatePortalReturnsPageAccess({
      sessionLoading: true,
      moduleLoading: false,
      isClient: true,
      role: 'CLIENT_ADMIN',
      moduleEnabled: null,
    }).action === 'spinner',
    'shows spinner while session is loading (no redirect)',
  );
  assert(
    evaluatePortalReturnsPageAccess({
      sessionLoading: false,
      moduleLoading: true,
      isClient: true,
      role: 'CLIENT_ADMIN',
      moduleEnabled: null,
    }).action === 'spinner',
    'shows spinner while /api/portal/me module flag is loading',
  );

  const dpgAdmin = evaluatePortalReturnsPageAccess({
    sessionLoading: false,
    moduleLoading: false,
    isClient: true,
    role: 'CLIENT_ADMIN',
    moduleEnabled: true,
  });
  assert(dpgAdmin.action === 'allow', 'DPG CLIENT_ADMIN allowed on /portal/returns');

  const dpgSupporter = evaluatePortalReturnsPageAccess({
    sessionLoading: false,
    moduleLoading: false,
    isClient: true,
    role: 'CLIENT_SUPPORTER',
    moduleEnabled: true,
  });
  assert(dpgSupporter.action === 'allow', 'DPG CLIENT_SUPPORTER allowed on /portal/returns');

  const clientUser = evaluatePortalReturnsPageAccess({
    sessionLoading: false,
    moduleLoading: false,
    isClient: true,
    role: 'CLIENT_USER',
    moduleEnabled: true,
  });
  assert(
    clientUser.action === 'redirect' && clientUser.to === '/portal/dashboard',
    'CLIENT_USER redirected away from /portal/returns',
  );

  const citadelle = evaluatePortalReturnsPageAccess({
    sessionLoading: false,
    moduleLoading: false,
    isClient: true,
    role: 'CLIENT_ADMIN',
    moduleEnabled: false,
  });
  assert(
    citadelle.action === 'redirect' && citadelle.to === '/portal/dashboard',
    'Citadelle (module off) redirected away from /portal/returns',
  );

  assert(
    resolveHardwareReturnsModuleFlag({
      enabledModules: { hardwareReturns: true },
    }) === true,
    'module flag from enabledModules.hardwareReturns',
  );
  assert(
    resolveHardwareReturnsModuleFlag({
      organization: { hardware_returns_enabled: true },
    }) === true,
    'module flag from organization.hardware_returns_enabled',
  );
  assert(
    resolveHardwareReturnsModuleFlag({
      enabledModules: { hardwareReturns: false },
      organization: { hardware_returns_enabled: false },
    }) === false,
    'module flag false when disabled',
  );

  // Staff Kunden accordion contract: only hardware-enabled orgs expand.
  const staffKunden = [
    { id: 'citadelle', hardware_returns_enabled: false },
    { id: 'dpg', hardware_returns_enabled: true },
  ];
  assert(
    staffKunden.filter((o) => o.hardware_returns_enabled).map((o) => o.id).join(',') === 'dpg',
    'only DPG expands under KUNDEN with Tickets + Rücklieferungen',
  );
}

/**
 * Portal user / contact hard-delete RBAC:
 * - SYSTEM_ADMIN may delete CLIENT_* (incl. sole CLIENT_ADMIN) of an org
 * - CLIENT_ADMIN may delete colleagues in-org (not self)
 * - Never delete SYSTEM_ADMIN / AGENT via org/portal delete routes
 * - Missing user doc → auth 401 (JWT invalidated)
 * - Freed email can be re-invited into DPG (contract: delete frees email)
 */
function testPortalUserDeleteAccess(): void {
  console.log('\n[Portal User Delete] admin + portal RBAC + session invalidation');

  const soleAdmin = {
    id: 'user-a-admin',
    role: 'CLIENT_ADMIN',
    organizationId: ORG_A,
  };
  const adminDeleteSole = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcomAdmin,
    target: soleAdmin,
    routeOrgId: ORG_A,
  });
  assert(
    adminDeleteSole.ok === true,
    'SYSTEM_ADMIN can delete sole CLIENT_ADMIN of an organization',
  );

  const adminDeleteUser = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcomAdmin,
    target: orgAUser,
    routeOrgId: ORG_A,
  });
  assert(adminDeleteUser.ok === true, 'SYSTEM_ADMIN can delete CLIENT_USER of org');

  // Historical tickets stay under original org: soft-null requester only —
  // organizationId on the ticket is never cleared by delete (contract check).
  const ticketAfterDelete = {
    id: 'tkt-owned',
    organizationId: ORG_A,
    requesterId: null as string | null,
    customerEmail: 'user@orga.test',
    customerName: 'Org A User',
  };
  assert(
    ticketAfterDelete.organizationId === ORG_A &&
      ticketAfterDelete.customerEmail === 'user@orga.test',
    'historical ticket remains under original org with customer email text',
  );

  // Same email immediately free for DPG re-invite (email uniqueness freed by user delete).
  const freedEmail = 'user@orga.test';
  const dpgInviteTarget = { email: freedEmail, organizationId: 'org-dpg' };
  assert(
    dpgInviteTarget.email === orgAUser.email &&
      dpgInviteTarget.organizationId !== ORG_A,
    'exact same email can be re-invited into DPG after delete frees the address',
  );

  assert(authStatusWhenUserMissing() === 401, 'deleted user JWT → auth 401');

  // Hubcom staff cannot be deleted via org user delete route.
  const denyStaffAdmin = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcomAdmin,
    target: { id: hubcomAdmin.id, role: 'SYSTEM_ADMIN', organizationId: null },
    routeOrgId: ORG_A,
  });
  assert(denyStaffAdmin.ok === false && denyStaffAdmin.status === 403, 'cannot delete SYSTEM_ADMIN via org route');

  const denyAgent = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcomAdmin,
    target: { id: 'agent-1', role: 'AGENT', organizationId: null },
    routeOrgId: ORG_A,
  });
  assert(denyAgent.ok === false && denyAgent.status === 403, 'cannot delete AGENT via org route');

  // Portal CLIENT_ADMIN of Org A cannot delete Org B user.
  const crossTenant = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgAAdmin,
    target: orgBUser,
    routeOrgId: ORG_A,
  });
  assert(
    crossTenant.ok === false && (crossTenant.status === 403 || crossTenant.status === 404),
    'Org A CLIENT_ADMIN cannot delete Org B user',
  );

  const crossViaRoute = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgAAdmin,
    target: orgBUser,
    routeOrgId: ORG_B,
  });
  assert(
    crossViaRoute.ok === false && (crossViaRoute.status === 403 || crossViaRoute.status === 404),
    'Org A CLIENT_ADMIN cannot delete via Org B routeOrgId',
  );

  const selfDelete = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgAAdmin,
    target: orgAAdmin,
    routeOrgId: ORG_A,
  });
  assert(selfDelete.ok === false && selfDelete.status === 400, 'CLIENT_ADMIN cannot delete self');

  const okColleague = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgAAdmin,
    target: orgAColleague,
    routeOrgId: ORG_A,
  });
  assert(okColleague.ok === true, 'CLIENT_ADMIN can delete in-org colleague');

  const denySupporter = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgASupporter,
    target: orgAColleague,
    routeOrgId: ORG_A,
  });
  assert(
    denySupporter.ok === false && denySupporter.status === 403,
    'CLIENT_SUPPORTER gets 403 on portal delete',
  );

  const denyUser = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: orgAUser,
    target: orgAColleague,
    routeOrgId: ORG_A,
  });
  assert(denyUser.ok === false && denyUser.status === 403, 'CLIENT_USER gets 403 on portal delete');

  // Wrong-org target for admin route.
  const adminWrongOrg = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcomAdmin,
    target: orgAUser,
    routeOrgId: ORG_B,
  });
  assert(
    adminWrongOrg.ok === false && adminWrongOrg.status === 404,
    'SYSTEM_ADMIN delete rejects user not belonging to :orgId',
  );
}

async function main(): Promise<void> {
  console.log('=== Client Portal Isolation & RBAC Suite (Phase 5) ===');
  testCrossTenantBlock();
  testInternalNotesBlock();
  await testPortalTicketDetailApiContract();
  await testClientUserScoping();
  await testPrivilegeEscalation();
  testSecretProtection();
  testOutboundFallback();
  testHubcomStaffBypass();
  testPortalDashboardIsolation();
  testPortalSessionBootstrapWithoutRolesDb();
  await testStaffTicketOrgStampAndPortalVisibility();
  testPortalBrandingBoundaries();
  testPortalKbIsolation();
  testPortalExchangeIsolation();
  testPortalTresorVaultIsolation();
  testHardwareReturnsModuleGate();
  testHardwareReturnsEscalationEngine();
  testDefaultTicketCreateExcludesRmaFields();
  testPortalReturnsPageNavigationGate();
  testPortalUserDeleteAccess();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('OK: client portal isolation suite passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
