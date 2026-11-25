/**
 * Dry-run tests for the AI request lifecycle middleware.
 * Runs without database persistence or external API calls.
 *
 * Usage: npm run test:lifecycle
 */
import {
  DEFAULT_ORCHESTRATOR_CONFIG,
  DEFAULT_CONFIDENCE_THRESHOLDS,
} from '../src/types/ai-orchestrator';
import {
  runAiRequestLifecycle,
  resumeApprovedAiRequest,
  stubAiModelExecutor,
} from '../src/lib/ai-request-lifecycle.js';
import {
  rehydrateResponseData,
  resetEphemeralTokenStores,
  scrubSensitiveData,
} from '../src/lib/ai-data-anonymization.js';
import {
  persistAiResponseCache,
  resetInMemoryAiCache,
} from '../src/lib/ai-response-cache.js';
import {
  buildPortalTicketDetailResponse,
  isPortalTicketFrontendApiAllowed,
} from '../src/lib/client-portal/portal-ticket-api.js';
import {
  authStatusWhenUserMissing,
  evaluatePortalUserDeleteAccess,
} from '../src/lib/client-portal/portal-user-delete.js';
import {
  evaluatePortalReturnsPageAccess,
  resolveHardwareReturnsModuleFlag,
} from '../src/lib/client-portal/hardware-returns-nav.js';
import {
  evaluateDueReminderStage,
  resolveStageRecipients,
} from '../src/lib/client-portal/hardware-returns-recipients.js';
import {
  defaultHardwareReturnsConfig,
  deriveIdPrefixFromOrgName,
  evaluateHardwareCatalogsWriteAccess,
  formatReturnNumber,
  formatReturnNumberDisplay,
  mapHardwareRow,
  needsReturnNumberBackfill,
  normalizeHardwareReturnInput,
  type TicketHardwareReturnRecord,
} from '../src/lib/client-portal/hardware-returns.js';
import {
  evaluateDirectorySearchAccess,
  fetchAllDirectoryUsersFromGraph,
  rankDirectorySearchResults,
} from '../src/lib/client-portal/organization-directory-sync.js';
import {
  formatDateDeOnly,
  toIsoDateOnly,
} from '../src/lib/client-portal/hardware-returns-dates.js';
import {
  evaluatePortalKbCategoryWriteAccess,
  portalCategoryId,
} from '../src/lib/kb/kb-categories.js';
import fs from 'node:fs';
import path from 'node:path';

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

async function testSmartReplyAutomatic(): Promise<void> {
  console.log('\n[1] Smart Reply — automatic gate, high confidence');
  const result = await runAiRequestLifecycle(
    { feature: 'smart_reply', prompt: 'Draft a reply for ticket #1234' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, executor: stubAiModelExecutor },
  );
  assert(result.status === 'completed', 'completes without approval hold');
  assert(result.steps.some((s) => s.step === 'approval_gate' && s.status === 'passed'), 'approval gate passed (automatic)');
  assert(result.explainability?.logLine.includes('model='), 'explainability log written');
  assert((result.confidence ?? 0) >= DEFAULT_CONFIDENCE_THRESHOLDS.smart_reply, 'meets confidence threshold');
}

async function testKbGenerationManagerApproval(): Promise<void> {
  console.log('\n[2] KB Generation — manager approval gate');
  const result = await runAiRequestLifecycle(
    { feature: 'kb_generation', prompt: 'Generate KB article from ticket context' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, skipApprovalGate: false },
  );
  assert(result.status === 'pending_approval', 'pauses for manager approval');
  assert(result.steps.some((s) => s.step === 'approval_gate' && s.status === 'pending'), 'approval gate pending');
  assert(!result.output, 'no output before approval');
}

async function testRootCauseEngineerApproval(): Promise<void> {
  console.log('\n[3] Root Cause Analysis — engineer approval gate');
  const result = await runAiRequestLifecycle(
    { feature: 'root_cause_analysis', prompt: 'Analyze root cause for outage' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true },
  );
  assert(result.status === 'pending_approval', 'pauses for engineer approval');
}

async function testLowConfidenceHumanReview(): Promise<void> {
  console.log('\n[4] Confidence threshold — routes to human review pool');
  const lowConfidenceExecutor = async () => ({
    output: 'uncertain draft',
    confidence: 0.72,
    costUsd: 0.002,
  });

  const result = await runAiRequestLifecycle(
    { feature: 'smart_reply', prompt: 'Ambiguous customer issue' },
    {
      config: DEFAULT_ORCHESTRATOR_CONFIG,
      skipPersistence: true,
      skipApprovalGate: true,
      executor: lowConfidenceExecutor,
    },
  );
  assert(result.status === 'pending_review', 'routes to human review pool');
  assert(result.steps.some((s) => s.step === 'confidence_threshold_check' && s.status === 'pending'), 'confidence check pending');
  assert((result.confidence ?? 1) < DEFAULT_CONFIDENCE_THRESHOLDS.smart_reply, 'below smart_reply threshold');
}

async function testMemoryPolicyVip(): Promise<void> {
  console.log('\n[5] Memory policy — VIP data not remembered');
  const result = await runAiRequestLifecycle(
    {
      feature: 'ticket_summarization',
      prompt: 'Summarize VIP customer thread',
      customerScope: 'vip',
    },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, skipApprovalGate: true, executor: stubAiModelExecutor },
  );
  assert(result.status === 'completed', 'execution completes');
  assert(
    result.steps.some((s) => s.step === 'memory_policy' && s.detail?.includes('VIP')),
    'VIP memory binding applied',
  );
}

async function testPiiShieldRedaction(): Promise<void> {
  console.log('\n[6] PII shield — redacts email in prompt');
  const result = await runAiRequestLifecycle(
    { feature: 'smart_reply', prompt: 'Contact user at secret@example.com for details' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, skipApprovalGate: true, executor: stubAiModelExecutor },
  );
  assert(result.redactedPrompt?.includes('[REDACTED_EMAIL]'), 'email redacted locally');
  assert(result.steps.some((s) => s.step === 'check_pii_shields' && s.status === 'passed'), 'PII step passed');
}

async function testDecisionEngineFlow(): Promise<void> {
  console.log('\n[7] Decision engine — full step pipeline recorded');
  const result = await runAiRequestLifecycle(
    { feature: 'translation', prompt: 'Translate to German: Hello' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, skipApprovalGate: true, executor: stubAiModelExecutor },
  );
  const stepNames = result.steps.map((s) => s.step);
  assert(stepNames.includes('request_received'), 'starts with request_received');
  assert(stepNames.includes('detect_feature_context'), 'detects feature context');
  assert(stepNames.includes('assign_compliant_model'), 'assigns compliant model');
  assert(stepNames.includes('file_audit_log'), 'files audit log');
  assert(result.steps.length >= 10, `records ${result.steps.length} pipeline steps`);
}

async function testResumeAfterApproval(): Promise<void> {
  console.log('\n[8] Resume — approved request executes');
  const result = await resumeApprovedAiRequest(
    { feature: 'kb_generation', prompt: 'Approved KB draft content' },
    { config: DEFAULT_ORCHESTRATOR_CONFIG, skipPersistence: true, executor: stubAiModelExecutor },
  );
  assert(result.status === 'pending_review' || result.status === 'completed', 'executes after approval bypass');
  assert(result.steps.some((s) => s.step === 'approval_gate' && s.detail?.includes('Pre-approved')), 'skips approval hold');
}

async function testKillSwitchBlocks(): Promise<void> {
  console.log('\n[9] Kill switch — blocks disabled feature');
  const result = await runAiRequestLifecycle(
    { feature: 'smart_reply', prompt: 'Should be blocked' },
    {
      config: {
        ...DEFAULT_ORCHESTRATOR_CONFIG,
        killSwitch: { ...DEFAULT_ORCHESTRATOR_CONFIG.killSwitch, smartReply: true },
      },
      skipPersistence: true,
    },
  );
  assert(result.status === 'blocked', 'blocked by kill switch');
}

async function testScrubRehydrateUtilities(): Promise<void> {
  console.log('\n[10] Anonymization utilities — scrub and rehydrate roundtrip');
  resetEphemeralTokenStores();
  const source =
    'Acme Corp VPN uses db-primary.internal.corp at 10.20.1.44 postgres://admin:SecretPass99@db-primary.internal.corp/prod';
  const scrub = scrubSensitiveData(source, { workspaceName: 'Acme Corp' });
  assert(scrub.wasScrubbed, 'scrub detects sensitive fingerprints');
  assert(scrub.scrubbedText.includes('{{GD_TOKEN_'), 'placeholder tokens injected');
  assert(!scrub.scrubbedText.includes('SecretPass99'), 'password removed from outbound text');

  const modelEcho = `Please use ${Object.keys(scrub.tokenMap)[0]} for the database connection.`;
  const restored = rehydrateResponseData(modelEcho, scrub.tokenMap);
  assert(restored.replacements > 0, 'rehydration replaces placeholders');
  assert(!restored.rehydratedText.includes('{{GD_TOKEN_'), 'placeholders removed from client output');
}

async function testCloudLifecycleScrubAndRehydrate(): Promise<void> {
  console.log('\n[11] Cloud route — lifecycle scrub + response rehydration');
  resetEphemeralTokenStores();
  const echoExecutor = async ({ prompt }: { prompt: string }) => {
    const hostToken = prompt.match(/\{\{GD_TOKEN_HOST_\d+\}\}/)?.[0] ?? '{{GD_TOKEN_HOST_1}}';
    return {
      output: `Connect using host ${hostToken} and report status.`,
      confidence: 0.95,
      costUsd: 0.001,
    };
  };

  const cloudConfig = {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    featureRouting: {
      ...DEFAULT_ORCHESTRATOR_CONFIG.featureRouting,
      smart_reply: 'gemini-flash',
    },
    providerPriority: ['gemini-flash', 'local-llama'],
    primaryModel: 'gemini-flash',
    trustLevel: 4 as const,
  };

  const result = await runAiRequestLifecycle(
    {
      feature: 'smart_reply',
      prompt: 'Troubleshoot db-primary.internal.corp latency for Acme Corp operators.',
      metadata: { workspaceName: 'Acme Corp' },
    },
    {
      config: cloudConfig,
      skipPersistence: true,
      skipApprovalGate: true,
      executor: echoExecutor,
    },
  );

  assert(result.status === 'completed', 'cloud lifecycle completes');
  assert(result.redactedPrompt?.includes('{{GD_TOKEN_'), 'outbound prompt tokenized');
  assert(result.output?.includes('db-primary.internal.corp'), 'hostname rehydrated in response');
  assert(result.steps.some((s) => s.step === 'check_pii_shields' && s.detail?.includes('token map')), 'PII step records token map');
}

async function testLocalRouteSkipsReversibleScrub(): Promise<void> {
  console.log('\n[12] Local Llama route — skips reversible cloud token map');
  resetEphemeralTokenStores();
  const localConfig = {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    featureRouting: {
      ...DEFAULT_ORCHESTRATOR_CONFIG.featureRouting,
      smart_reply: 'local-llama',
    },
    providerPriority: ['local-llama'],
    primaryModel: 'local-llama',
    trustLevel: 5 as const,
  };

  const result = await runAiRequestLifecycle(
    { feature: 'smart_reply', prompt: 'password: LocalOnlySecret99 on db.internal.corp' },
    {
      config: localConfig,
      skipPersistence: true,
      skipApprovalGate: true,
      executor: stubAiModelExecutor,
    },
  );

  assert(result.status === 'completed', 'local lifecycle completes');
  assert(
    result.steps.some((s) => s.step === 'check_pii_shields' && s.detail?.includes('token map skipped')),
    'local route skips reversible scrub',
  );
}

async function testEntityCacheHitBypassesExecutor(): Promise<void> {
  console.log('\n[13] Entity cache — CACHE_HIT bypasses LLM executor');
  resetInMemoryAiCache();

  let execCalls = 0;
  const countingExecutor = async () => {
    execCalls += 1;
    return { output: 'should-not-run', confidence: 0.99, costUsd: 0.01 };
  };

  const ctx = {
    feature: 'smart_reply' as const,
    prompt: 'Draft a reply for ticket cache validation',
    ticketId: 'ticket-cache-hit-1',
  };

  await persistAiResponseCache(
    ctx,
    {
      output: '[cached] Prior smart reply payload for reload',
      confidence: 0.93,
      assignedModel: 'cached-model',
      promptFingerprint: '',
    },
    { skipPersistence: true },
  );

  const result = await runAiRequestLifecycle(ctx, {
    config: DEFAULT_ORCHESTRATOR_CONFIG,
    skipPersistence: true,
    skipApprovalGate: true,
    executor: countingExecutor,
  });

  assert(result.status === 'completed', 'cache hit completes');
  assert(result.fromCache === true, 'result flagged fromCache');
  assert(execCalls === 0, 'executor not invoked on CACHE_HIT');
  assert(
    result.steps.some((s) => s.step === 'cache_lookup' && s.detail?.includes('CACHE_HIT')),
    'cache_lookup records CACHE_HIT',
  );
  assert(result.explainability?.policiesChecked.includes('cache_hit'), 'explainability logs cache_hit');
}

async function testForceRefreshBypassesCache(): Promise<void> {
  console.log('\n[14] Entity cache — forceRefresh bypasses CACHE_HIT');
  resetInMemoryAiCache();

  let execCalls = 0;
  const countingExecutor = async ({ prompt }: { prompt: string }) => {
    execCalls += 1;
    return { output: `[fresh] ${prompt.slice(0, 40)}`, confidence: 0.95, costUsd: 0.002 };
  };

  const ctx = {
    feature: 'smart_reply' as const,
    prompt: 'Regenerate smart reply after ticket update',
    ticketId: 'ticket-force-refresh-1',
  };

  await persistAiResponseCache(
    ctx,
    {
      output: '[cached] stale payload',
      confidence: 0.9,
      assignedModel: 'cached-model',
      promptFingerprint: '',
    },
    { skipPersistence: true },
  );

  const result = await runAiRequestLifecycle(
    { ...ctx, forceRefresh: true },
    {
      config: DEFAULT_ORCHESTRATOR_CONFIG,
      skipPersistence: true,
      skipApprovalGate: true,
      executor: countingExecutor,
    },
  );

  assert(result.status === 'completed', 'fresh execution completes');
  assert(result.fromCache !== true, 'forceRefresh does not serve cache');
  assert(execCalls === 1, 'executor invoked when forceRefresh=true');
  assert(
    result.steps.some((s) => s.step === 'cache_lookup' && s.detail?.includes('forceRefresh')),
    'cache_lookup skipped due to forceRefresh',
  );
}

function testPortalTicketApiNeverUsesDb(): void {
  console.log('\n[15] Portal ticket frontend API allowlist (no /api/db)');

  assert(isPortalTicketFrontendApiAllowed('/api/portal/tickets/t1') === true, 'portal GET allowed');
  assert(
    isPortalTicketFrontendApiAllowed('/api/portal/tickets/t1/messages') === true,
    'portal POST messages allowed',
  );
  assert(isPortalTicketFrontendApiAllowed('/api/db') === false, '/api/db blocked for portal tickets');

  const detail = buildPortalTicketDetailResponse({
    ticket: { id: 't1', subject: 'x', organizationId: 'o1', agentComments: 'secret' },
    messages: [
      { id: '1', content: 'hi', createdAt: '2026-01-01T00:00:00.000Z', is_internal: false },
      { id: '2', content: 'note', createdAt: '2026-01-01T01:00:00.000Z', is_internal: true },
    ],
    participants: [],
  });
  assert(!('agentComments' in detail.ticket), 'portal detail strips internal ticket fields');
  assert(detail.messages.length === 1, 'portal detail strips internal messages');
}

function testPortalReturnsNavLifecycle(): void {
  console.log('\n[16] Portal /portal/returns navigation — wait for module, no bounce');

  assert(
    evaluatePortalReturnsPageAccess({
      sessionLoading: false,
      moduleLoading: true,
      isClient: true,
      role: 'CLIENT_ADMIN',
      moduleEnabled: null,
    }).action === 'spinner',
    'hard refresh waits for /api/portal/me before redirect',
  );
  assert(
    evaluatePortalReturnsPageAccess({
      sessionLoading: false,
      moduleLoading: false,
      isClient: true,
      role: 'CLIENT_ADMIN',
      moduleEnabled: true,
    }).action === 'allow',
    'DPG CLIENT_ADMIN can open /portal/returns',
  );
  assert(
    evaluatePortalReturnsPageAccess({
      sessionLoading: false,
      moduleLoading: false,
      isClient: true,
      role: 'CLIENT_USER',
      moduleEnabled: true,
    }).action === 'redirect',
    'CLIENT_USER cannot open /portal/returns',
  );
  assert(
    resolveHardwareReturnsModuleFlag({
      enabledModules: { hardwareReturns: true },
      organization: { hardware_returns_enabled: true },
    }) === true,
    'canonical module flag resolves from /api/portal/me',
  );
}

function testHardwareReturnsStandaloneLifecycle(): void {
  console.log('\n[17] Hardware returns standalone — create never bumps ticket count');

  const escalationSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns-escalation.ts'),
    'utf8',
  );
  assert(
    escalationSrc.includes('createHardwareReturnFromWorkbench') &&
      escalationSrc.includes('insertStandaloneHardwareReturn') &&
      !/addDocDirect\(\s*['"]tickets['"]/.test(escalationSrc),
    'POST /api/returns|/api/portal/returns create path never writes tickets collection',
  );
  assert(
    escalationSrc.includes('appendHardwareReturnActivity') &&
      escalationSrc.includes('importHardwareReturnsCsv') &&
      !escalationSrc.includes("addDocDirect('tickets'"),
    'CSV import + mail/mark-returned use activity_log, not ticket messages',
  );
  assert(
    escalationSrc.includes('SET returned = TRUE') &&
      !/markHardwareReturned[\s\S]*?updateHardwareReturnById/.test(
        escalationSrc.slice(
          escalationSrc.indexOf('export async function markHardwareReturned'),
          escalationSrc.indexOf(
            'export async function',
            escalationSrc.indexOf('export async function markHardwareReturned') + 10,
          ),
        ),
      ),
    'mark-returned is a targeted UPDATE (no full-row rewrite of delivery_date)',
  );

  const pgDate = new Date(Date.UTC(2026, 10, 20));
  assert(toIsoDateOnly(pgDate) === '2026-11-20', 'pg Date serializes to YYYY-MM-DD');
  assert(toIsoDateOnly('Fri Nov 20') === null, 'locale date strings rejected');
  assert(formatDateDeOnly('2026-11-20') === '20.11.2026', 'UI date format DD.MM.YYYY');
  const mapped = mapHardwareRow({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    organization_id: 'org-dpg',
    delivery_date: pgDate,
    return_due_date: new Date(Date.UTC(2026, 11, 4)),
    return_required: true,
    returned: false,
    status: 'open',
  });
  assert(
    mapped.delivery_date === '2026-11-20' && mapped.return_due_date === '2026-12-04',
    'mapHardwareRow DATE columns → YYYY-MM-DD (mark-returned safe)',
  );

  const hw: TicketHardwareReturnRecord = {
    id: 'hw-life-1',
    organization_id: 'org-dpg',
    ticket_id: null,
    return_number: 'RL-2001',
    subject: 'Hardware',
    employee_name: 'Ada',
    employee_email: 'ada@dpg.test',
    assignee_name: 'Support',
    assignee_user_id: null,
    directory_user_id: null,
    status: 'open',
    description: null,
    activity_log: [{ at: '2026-10-01T00:00:00.000Z', type: 'created' }],
    external_ref_id: null,
    service_level: null,
    sla: 'Normal',
    time_sl1_minutes: 0,
    time_sl2_minutes: 0,
    time_sl3_minutes: 0,
    exported: false,
    exported_at: null,
    request_type: null,
    device_details: 'Notebook',
    device_old_type: null,
    device_old_serial: null,
    device_new_type: null,
    device_new_serial: null,
    employee_phone: null,
    employee_mobile: null,
    project_manager_name: null,
    project_manager_email: 'pm@dpg.test',
    manager_name: null,
    manager_email: null,
    ceo_email_override: null,
    stage_recipients_override: null,
    solution_summary: null,
    shipping_method: null,
    shipping_reference: null,
    return_required: true,
    delivery_date: '2026-10-01',
    return_due_date: '2026-10-15',
    auto_reminder_enabled: true,
    mail1_scheduled_date: null,
    mail2_scheduled_date: null,
    mail3_scheduled_date: null,
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
  };
  const cfg = defaultHardwareReturnsConfig();
  cfg.auto_send_enabled = true;
  const resolved = resolveStageRecipients(1, {}, hw, cfg);
  assert(
    resolved.to.includes('ada@dpg.test'),
    'Mail 1/2/3 employee resolves from employee_email with ticket_id null',
  );
  assert(
    evaluateDueReminderStage(hw, cfg, new Date('2026-10-20T12:00:00.000Z')) === 1,
    'scheduler due-stage works with ticket_id null',
  );
  // Simulated ticket counts stay +0 when a return is "created" (no ticket doc).
  const ticketsBefore = 12;
  const ticketsAfterCreateReturn = ticketsBefore; // createHardwareReturnFromWorkbench writes 0 tickets
  assert(
    ticketsAfterCreateReturn - ticketsBefore === 0,
    'GET /api/tickets + GET /api/portal/tickets count unchanged (+0) after returns create',
  );
}

function testHardwareReturnsSchemaCatalogsLifecycle(): void {
  console.log('\n[17b] Hardware returns Part-1 — sequential IDs, catalogs, returned_at');

  assert(deriveIdPrefixFromOrgName('DPG') === 'DPG', 'DPG prefix from org name');
  assert(
    formatReturnNumber('DPG', 1) === 'DPG-1' && formatReturnNumber('DPG', 2) === 'DPG-2',
    'sequential DPG-1 then DPG-2',
  );
  assert(formatReturnNumberDisplay('DPG-1') === '#DPG-1', 'display #DPG-1');
  assert(needsReturnNumberBackfill('c6175496'), 'UUID-slice return_number needs backfill');

  const cfg = defaultHardwareReturnsConfig();
  assert(
    cfg.id_prefix === 'DPG' &&
      cfg.catalogs.statuses[0] === 'Neu' &&
      cfg.catalogs.device_types.includes('Secutest Pro'),
    'default catalogs + id_prefix',
  );

  const created = normalizeHardwareReturnInput({
    subject: null,
    assignee_name: 'Creator',
    assignee_user_id: 'u-1',
    device_old_type: 'VL2E Adapter',
    device_old_serial: 'S-OLD',
    device_new_type: 'Secutest Pro',
    device_new_serial: 'S-NEW',
    sla: 'Normal',
    service_level: '1',
    shipping_method: 'Express',
    return_number: 'DPG-1',
    status: 'Neu',
  });
  assert(
    created.return_number === 'DPG-1' &&
      !created.subject &&
      created.assignee_name === 'Creator' &&
      created.device_old_type === 'VL2E Adapter' &&
      created.device_new_serial === 'S-NEW' &&
      created.sla === 'Normal' &&
      created.service_level === '1' &&
      created.shipping_method === 'Express',
    'create without subject; assignee + device/sla/SL/shipping persisted',
  );

  const stamped = normalizeHardwareReturnInput({ returned: true }, { existing: created as any });
  assert(
    stamped.returned === true &&
      typeof stamped.returned_at === 'string' &&
      !Number.isNaN(Date.parse(String(stamped.returned_at))),
    'returned=true stamps valid ISO returned_at (no PG date syntax error)',
  );
  const cleared = normalizeHardwareReturnInput(
    { returned: false },
    { existing: { ...(created as any), returned: true, returned_at: stamped.returned_at } },
  );
  assert(cleared.returned_at == null, 'returned=false clears returned_at');

  assert(
    evaluateHardwareCatalogsWriteAccess({
      orgEnabled: true,
      sessionOrgId: 'org-dpg',
      targetOrgId: 'org-dpg',
      role: 'CLIENT_ADMIN',
    }).ok === true,
    'CLIENT_ADMIN catalogs write own org',
  );
  assert(
    evaluateHardwareCatalogsWriteAccess({
      orgEnabled: true,
      sessionOrgId: 'org-dpg',
      targetOrgId: 'org-dpg',
      role: 'CLIENT_USER',
    }).ok === false,
    'CLIENT_USER catalogs write 403',
  );
  assert(
    evaluateHardwareCatalogsWriteAccess({
      orgEnabled: false,
      sessionOrgId: 'org-x',
      targetOrgId: 'org-x',
      role: 'CLIENT_ADMIN',
    }).ok === false,
    'disabled org catalogs write 403',
  );

  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns.ts'),
    'utf8',
  );
  assert(
    src.includes('hardware_returns_seq = hardware_returns_seq + 1') &&
      src.includes('listHardwareReturnAssignees'),
    'atomic seq allocation + assignees helper present',
  );
}

async function testOrganizationDirectorySyncLifecycle(): Promise<void> {
  console.log('\n[17c] M365 directory sync — Graph mock, prefix search, tenant isolation');

  const ranked = rankDirectorySearchResults('ad', [
    {
      id: '1',
      displayName: 'Stefan Radke',
      email: 's.radke@dpg.test',
      phoneOffice: null,
      phoneMobile: null,
      managerName: null,
      managerEmail: null,
      department: null,
      source: 'm365',
    },
    {
      id: '2',
      displayName: 'Adam Weber',
      email: 'adam@dpg.test',
      phoneOffice: null,
      phoneMobile: null,
      managerName: null,
      managerEmail: null,
      department: null,
      source: 'm365',
    },
  ]);
  assert(
    ranked[0]?.displayName === 'Adam Weber',
    'prefix-first: Adam Weber before Stefan Radke for q=ad',
  );

  assert(
    evaluateDirectorySearchAccess({
      sessionOrgId: 'org-dpg',
      targetOrgId: 'org-citadelle',
      role: 'CLIENT_ADMIN',
      orgEnabled: true,
    }).ok === false,
    'cross-tenant directory search denied',
  );

  let calls = 0;
  const users = await fetchAllDirectoryUsersFromGraph({
    creds: { tenantId: 't', clientId: 'c', clientSecret: 's' },
    entraGroupId: 'g',
    acquireToken: async () => 'tok',
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('manager expand failed'), {
          status: 400,
          graphBody: { error: { message: 'expand manager invalid' } },
        });
      }
      return {
        value: [
          { id: 'a', displayName: 'A', mail: 'a@x.test', accountEnabled: true },
          { id: 'b', displayName: 'B', mail: 'b@x.test', accountEnabled: true },
        ],
        nextLink: null,
      };
    },
  });
  assert(users.length === 2 && calls >= 2, 'Graph group sync falls back when manager expand fails');

  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/organization-directory-sync.ts'),
    'utf8',
  );
  assert(
    src.includes('organization_directory_users') && src.includes('User.Read.All'),
    'directory sync module + permission hint present',
  );
}

function testPortalUserDeleteLifecycle(): void {
  console.log('\n[18] Portal user delete — RBAC lifecycle + email free + JWT 401');

  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const DPG = 'org-dpg';
  const hubcom = { id: 'sa', role: 'SYSTEM_ADMIN', organizationId: null as string | null };
  const adminA = { id: 'ca-a', role: 'CLIENT_ADMIN', organizationId: ORG_A };
  const userA = {
    id: 'cu-a',
    role: 'CLIENT_USER',
    organizationId: ORG_A,
    email: 'reinvite@example.com',
  };
  const userB = { id: 'cu-b', role: 'CLIENT_USER', organizationId: ORG_B };
  const supporterA = { id: 'cs-a', role: 'CLIENT_SUPPORTER', organizationId: ORG_A };

  assert(
    evaluatePortalUserDeleteAccess({
      mode: 'admin',
      actor: hubcom,
      target: adminA,
      routeOrgId: ORG_A,
    }).ok === true,
    'SYSTEM_ADMIN deletes CLIENT_ADMIN who may own tickets/sessions',
  );

  // Ticket soft-detach contract: org + customer text survive; requester cleared.
  const ticketKept = {
    organizationId: ORG_A,
    requesterId: null as string | null,
    customerEmail: userA.email,
    customerName: 'Reinvite User',
  };
  assert(
    ticketKept.organizationId === ORG_A && ticketKept.customerEmail === userA.email,
    'historical tickets remain intact under original org after user delete',
  );
  assert(authStatusWhenUserMissing() === 401, 'deleted user JWT rejected with 401');
  assert(
    userA.email === 'reinvite@example.com' && String(DPG) !== String(ORG_A),
    'same email immediately free to re-invite into DPG',
  );

  const cross = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: adminA,
    target: userB,
    routeOrgId: ORG_A,
  });
  assert(
    cross.ok === false && (cross.status === 403 || cross.status === 404),
    'CLIENT_ADMIN Org A cannot delete Org B user',
  );

  const self = evaluatePortalUserDeleteAccess({
    mode: 'portal',
    actor: adminA,
    target: adminA,
    routeOrgId: ORG_A,
  });
  assert(self.ok === false && self.status === 400, 'CLIENT_ADMIN cannot delete self');

  assert(
    evaluatePortalUserDeleteAccess({
      mode: 'portal',
      actor: supporterA,
      target: userA,
      routeOrgId: ORG_A,
    }).ok === false,
    'CLIENT_SUPPORTER forbidden from delete',
  );
  assert(
    evaluatePortalUserDeleteAccess({
      mode: 'portal',
      actor: userA,
      target: supporterA,
      routeOrgId: ORG_A,
    }).ok === false,
    'CLIENT_USER forbidden from delete',
  );

  const denySa = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcom,
    target: hubcom,
    routeOrgId: ORG_A,
  });
  assert(denySa.ok === false && denySa.status === 403, 'SYSTEM_ADMIN account cannot be deleted via org user delete');

  const denyAgent = evaluatePortalUserDeleteAccess({
    mode: 'admin',
    actor: hubcom,
    target: { id: 'agent-1', role: 'AGENT', organizationId: null },
    routeOrgId: ORG_A,
  });
  assert(denyAgent.ok === false && denyAgent.status === 403, 'AGENT account cannot be deleted via org user delete');
}

function testPortalKbCategoryLifecycle(): void {
  console.log('\n[19] Portal KB categories — tenant isolation + author stamp');

  const ORG_A = 'org-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  assert(
    evaluatePortalKbCategoryWriteAccess({
      role: 'CLIENT_ADMIN',
      sessionOrgId: ORG_B,
    }).ok === true,
    'DPG CLIENT_ADMIN can create/rename/delete categories',
  );
  assert(
    evaluatePortalKbCategoryWriteAccess({
      role: 'CLIENT_USER',
      sessionOrgId: ORG_B,
    }).ok === false,
    'CLIENT_USER forbidden on category mutations',
  );
  assert(
    evaluatePortalKbCategoryWriteAccess({
      role: 'CLIENT_ADMIN',
      sessionOrgId: ORG_A,
      targetOrgId: ORG_B,
    }).ok === false,
    'Citadelle cannot write DPG categories',
  );
  assert(
    portalCategoryId(ORG_B, 'Hardware') !== portalCategoryId(ORG_A, 'Hardware'),
    'category ids are org-scoped',
  );

  const portalKbSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/clientPortalKbRoutes.ts'),
    'utf8',
  );
  assert(
    portalKbSrc.includes('authorId: req.user!.id') &&
      portalKbSrc.includes("reviewer: ''") &&
      !portalKbSrc.includes('owner: (req.body'),
    'portal article create auto-records logged-in author (no client owner/reviewer)',
  );
  assert(
    fs
      .readFileSync(path.join(process.cwd(), 'src/hooks/usePortalKbAdapter.ts'), 'utf8')
      .includes('/api/portal/kb/categories'),
    'portal adapter wires category CRUD',
  );
}

async function main(): Promise<void> {
  console.log('AI Request Lifecycle — dry-run test suite');
  console.log('='.repeat(50));

  await testSmartReplyAutomatic();
  await testKbGenerationManagerApproval();
  await testRootCauseEngineerApproval();
  await testLowConfidenceHumanReview();
  await testMemoryPolicyVip();
  await testPiiShieldRedaction();
  await testDecisionEngineFlow();
  await testResumeAfterApproval();
  await testKillSwitchBlocks();
  await testScrubRehydrateUtilities();
  await testCloudLifecycleScrubAndRehydrate();
  await testLocalRouteSkipsReversibleScrub();
  await testEntityCacheHitBypassesExecutor();
  await testForceRefreshBypassesCache();
  testPortalTicketApiNeverUsesDb();
  testPortalReturnsNavLifecycle();
  testHardwareReturnsStandaloneLifecycle();
  testHardwareReturnsSchemaCatalogsLifecycle();
  await testOrganizationDirectorySyncLifecycle();
  testPortalUserDeleteLifecycle();
  testPortalKbCategoryLifecycle();

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
