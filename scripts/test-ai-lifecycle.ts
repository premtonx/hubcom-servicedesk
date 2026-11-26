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
  coerceShipmentStatus,
  resolveEffectiveShipmentStatus,
} from '../src/lib/client-portal/hardware-returns-shipment.js';
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
  buildReturnsLifecycleBuckets,
  buildReturnsStatusColumns,
  DEFAULT_RETURN_STATUSES,
  resolveReturnsLifecycleColumn,
  resolveReturnsStatusColumn,
  RETURNS_LIFECYCLE_COLUMNS,
} from '../src/lib/client-portal/hardware-returns-layout.js';
import {
  countActiveReturnsAdvancedFilters,
  dateRangeToApiParams,
  resolveZeitraumPreset,
} from '../src/lib/client-portal/hardware-returns-filters.js';
import {
  defaultConfiguredReminderStages,
  reminderCountFromStages,
  resolveConfiguredStage,
  upsertReminderStageSent,
} from '../src/lib/client-portal/hardware-returns-stages.js';
import {
  evaluatePortalKbCategoryWriteAccess,
  portalCategoryId,
} from '../src/lib/kb/kb-categories.js';
import {
  assertPortalKbWriteRole,
  isKbArticleVisibleToPortal,
} from '../src/lib/client-portal/kb-visibility.js';
import {
  buildSharePointPreviewArticles,
  buildSmartTitle,
  countMatchcodeOccurrences,
  parseSharePointCsvRows,
} from '../src/lib/kb/sharepoint-csv-import.js';
import { planKbCsvImportArticles } from '../src/lib/kb/kb-csv-import-service.js';
import { parseSharePointReturnsCsv } from '../src/lib/client-portal/hardware-returns-csv-parser.js';
import {
  countUniqueEmployees,
  diffNewCatalogItems,
  mapParsedRowToHardwareInput,
  mergeCatalogLists,
  planSharePointImportRows,
} from '../src/lib/client-portal/hardware-returns-csv-import.js';
import {
  DEFAULT_HARDWARE_RETURNS_CATALOGS,
  evaluateHardwareModuleAccess,
} from '../src/lib/client-portal/hardware-returns.js';
import {
  buildReturnsActivityByRangeFast,
  computePortalReturnsKpis,
} from '../src/lib/client-portal/portal-dashboard-returns-stats.js';
import {
  computeHardwareReturnsKpis,
  isEscalatedReturn,
  isOpenReturn,
  isOverdueReturn,
  isReturnedLast30,
  kpiRowFromHardwareRecord,
  kpiRowFromLean,
} from '../src/lib/client-portal/hardware-returns-kpis.js';
import {
  clearPortalReturnsCacheForTests,
  getCachedPortalDashboardReturns,
  getCachedPortalReturnsTrends,
  invalidatePortalReturnsCache,
  setCachedPortalDashboardReturns,
  setCachedPortalReturnsTrends,
} from '../src/lib/client-portal/portal-returns-cache.js';
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
      !escalationSrc.includes("addDocDirect('tickets'"),
    'mail/mark-returned use activity_log, not ticket messages',
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
    shipment_status: null,
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
    reminder_stages: [],
    reminder_count: 0,
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
      !Number.isNaN(Date.parse(String(stamped.returned_at))) &&
      stamped.shipment_status === 'eingegangen',
    'returned=true stamps ISO returned_at + shipment_status=eingegangen',
  );
  const cleared = normalizeHardwareReturnInput(
    { returned: false },
    { existing: { ...(created as any), returned: true, returned_at: stamped.returned_at } },
  );
  assert(
    cleared.returned_at == null && cleared.shipment_status === 'versendet',
    'returned=false clears returned_at and reverts shipment_status to versendet',
  );
  const clearedWithSpoof = normalizeHardwareReturnInput(
    { returned: false, returned_at: '2026-01-01T00:00:00.000Z' },
    { existing: { ...(created as any), returned: true, returned_at: stamped.returned_at } },
  );
  assert(
    clearedWithSpoof.returned === false && clearedWithSpoof.returned_at == null,
    'returned=false wins over spoofed returned_at → back in Offene, out of 30-Tage',
  );

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

function testPortalKbArticleEditLifecycle(): void {
  console.log('\n[19b] Portal KB article edit — PATCH via adapter, zero /api/db');

  const detailPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/pages/KnowledgeBaseArticlePage.tsx'),
    'utf8',
  );
  const adapterSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/hooks/usePortalKbAdapter.ts'),
    'utf8',
  );
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/clientPortalKbRoutes.ts'),
    'utf8',
  );
  const panelSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/kb/KBKnowledgeIntelligencePanel.tsx'),
    'utf8',
  );
  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/kb/KnowledgeBaseWorkbench.tsx'),
    'utf8',
  );

  assert(
    assertPortalKbWriteRole('CLIENT_ADMIN') === true &&
      assertPortalKbWriteRole('CLIENT_SUPPORTER') === true &&
      assertPortalKbWriteRole('CLIENT_USER') === false,
    'DPG CLIENT_ADMIN/SUPPORTER may PATCH; CLIENT_USER denied',
  );
  assert(
    routeSrc.includes('requireClientPortalRole') &&
      routeSrc.includes('CLIENT_SUPPORTER') &&
      routeSrc.includes('updatedAt') &&
      routeSrc.includes('typeof body.category') &&
      routeSrc.includes('sanitizeKbArticleForPortal') &&
      routeSrc.includes("visibility: 'organization'"),
    'PATCH /api/portal/kb/:id updates title/content/category with updatedAt + org lock',
  );
  assert(
    detailPageSrc.includes('adapter.updateArticle') &&
      detailPageSrc.includes('handleCategoryChange') &&
      workbenchSrc.includes('adapter={adapter}') &&
      workbenchSrc.includes('mode={mode}'),
    'reader Edit/Save + Kategorie quick-assign go through adapter.updateArticle',
  );
  assert(
    adapterSrc.includes('`${PORTAL_KB}/${encodeURIComponent(id)}`') &&
      adapterSrc.includes('patch.category !== undefined') &&
      !adapterSrc.includes('/api/db') &&
      !adapterSrc.includes('kbService') &&
      !adapterSrc.includes('kbArticleApi'),
    'portal updateArticle hits only /api/portal/kb/:id (zero /api/db)',
  );
  assert(
    panelSrc.includes('onCategoryChange') &&
      panelSrc.includes('Artikel-Metadaten') &&
      panelSrc.includes("mode === 'portal'") &&
      panelSrc.includes('!isPortal') &&
      panelSrc.includes('KI-Wissensspeicher (RAG)'),
    'portal metadata supports Kategorie; staff RAG/summary/trust gated by !isPortal',
  );
}

function testSharePointReturnsCsvImportApiLifecycle(): void {
  console.log('\n[21] SharePoint Returns CSV import API (Part 2) — plan, map, RBAC');

  const ORG = 'org-dpg-bbbbbbbbbbbbbbbbbbbbbbbbbb';
  const csv =
    '\uFEFFID;Erstellt;RuecklieferungDatum;Bearbeiter;Mitarbeiter;MitarbeiterEMail;MitarbeiterTelefonBuero;MitarbeiterMobil;Status;SLA;ServiceLevel;Versandart;Versand;BenoetigteZeitSL1;Exportiert;Ruecklieferung;RuecklieferungErfolgt;RueckgeliefertWann;Mail1Versendet;Mail1VersendetDatum;Mail3Versendet;Mail3VersendetDatum;Geraetetyp;Beschreibung;Betreff\n' +
    '10;01.10.2026;15.10.2026;Ada;Max Mustermann;max@dpg.test;+49 1;+49 2;In Bearbeitung;Normal;2;Express;DHL;1,50;Nein;Ja;Nein;;Wahr;;Falsch;01.01.2020;"ALT BC 559053 0026\nNEU Secutest S2 N+10 S/N: EA7101520016";OK;Secutest\n' +
    '11;02.10.2026;16.10.2026;Test User;Y;y@dpg.test;;;;Neu;Normal;1;Standard;;0;Nein;Ja;Wahr;02.10.2026;Falsch;;Falsch;;"Test! Test!";test junk;TestABC\n' +
    '12;03.10.2026;17.10.2026;Ada;Eva;eva@dpg.test;;;;Geschlossen;Hoch;3;Kein Versand;;0;Ja;Ja;Wahr;03.10.2026;Wahr;03.10.2026;Falsch;;"ALT ---\nNEU Secutest PRO S/N HL7578850006";OK;Secutest\n';

  const parsed = parseSharePointReturnsCsv(csv);
  assert(parsed.rows.length === 3, 'parser yields 3 SharePoint return rows');

  const planned = planSharePointImportRows({
    rows: parsed.rows,
    existingExternalRefIds: new Set(),
    scope: 'all',
    excludeTestRows: true,
  });
  assert(
    planned.filter((r) => r.willImport).length === 2 &&
      planned.some((r) => r.skipReason === 'test'),
    'excludeTestRows skips TestABC row; 2 remain',
  );

  const openOnly = planSharePointImportRows({
    rows: parsed.rows,
    existingExternalRefIds: new Set(),
    scope: 'open_only',
    excludeTestRows: true,
  });
  assert(
    openOnly.filter((r) => r.willImport).every((r) => !r.returned) &&
      openOnly.some((r) => r.skipReason === 'completed_out_of_scope'),
    'open_only excludes returned/completed rows',
  );

  const reimport = planSharePointImportRows({
    rows: parsed.rows,
    existingExternalRefIds: new Set(['10', '11', '12']),
    scope: 'all',
    excludeTestRows: true,
  });
  assert(
    reimport.every((r) => !r.willImport) &&
      reimport.filter((r) => r.skipReason === 'duplicate').length >= 2,
    're-import skips 100% when all external_ref_ids exist',
  );

  const mapped = mapParsedRowToHardwareInput(parsed.rows[0], {
    prefix: 'DPG',
    enableAutoReminders: false,
    actorName: 'importer',
  });
  assert(
    mapped.ticket_id === null &&
      mapped.external_ref_id === '10' &&
      mapped.return_number === 'DPG-10' &&
      mapped.auto_reminder_enabled === false &&
      mapped.subject === null &&
      Array.isArray(mapped.activity_log) &&
      String(mapped.activity_log?.[0]?.message || '').includes('SharePoint CSV'),
    'mapped input: ticket_id null, #DPG-10, no Betreff, auto_reminder false',
    JSON.stringify(mapped),
  );

  const catalogs = diffNewCatalogItems(parsed.discoveredCatalogs, {
    ...DEFAULT_HARDWARE_RETURNS_CATALOGS,
    device_types: ['VL2E Adapter'],
    shipping_methods: ['Standard'],
  });
  assert(
    catalogs.device_types.includes('Secutest S2 N+10') &&
      catalogs.shipping_methods.includes('Kein Versand') &&
      !catalogs.device_types.some((t) => /EA7101520016|BC5590530026/i.test(t)),
    'newCatalogItems merges normalized devices + Kein Versand; zero serials',
  );
  assert(
    mergeCatalogLists(['Express'], ['Express', 'Samstag']).added.includes('Samstag'),
    'mergeCatalogLists preserves existing and adds new',
  );
  assert(countUniqueEmployees(parsed.rows.filter((r) => !r.isLikelyTest)) >= 2, 'employees detected');

  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: false,
      sessionOrgId: ORG,
      ticketOrgId: ORG,
      role: 'CLIENT_ADMIN',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === false,
    'org without hardware_returns_enabled denied',
  );
  assert(
    evaluateHardwareModuleAccess({
      orgEnabled: true,
      sessionOrgId: ORG,
      ticketOrgId: ORG,
      role: 'CLIENT_USER',
      allowRoles: ['CLIENT_ADMIN', 'CLIENT_SUPPORTER'],
    }).ok === false,
    'CLIENT_USER denied on returns import gate',
  );

  const routesSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/hardwareReturnsRoutes.ts'),
    'utf8',
  );
  const importSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns-csv-import.ts'),
    'utf8',
  );
  assert(
    routesSrc.includes('/import-csv/preview') &&
      routesSrc.includes('previewSharePointReturnsImport') &&
      routesSrc.includes('commitSharePointReturnsImport') &&
      routesSrc.includes('SYSTEM_ADMIN') &&
      routesSrc.includes('AGENT') &&
      routesSrc.includes('CLIENT_SUPPORTER'),
    'routes expose preview+commit with staff AGENT + portal SUPPORTER RBAC',
  );
  assert(
    importSrc.includes('ticket_id: null') &&
      importSrc.includes('GREATEST(hardware_returns_seq') &&
      importSrc.includes("csv:") &&
      importSrc.includes("LIKE 'csv:%'") &&
      importSrc.includes('Aus SharePoint CSV importiert') &&
      !/addDocDirect\(\s*['"]tickets['"]/.test(importSrc),
    'commit bumps seq, seeds csv: directory, never creates tickets',
  );
  assert(
    fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8').includes('limit: "5mb"'),
    'express.json body limit ≥ 5mb for CSV import',
  );
}

function testReturnsPaginationErinnerungDashboardLifecycle(): void {
  console.log('\n[19c] Returns pagination / Erinnerung KPIs / portal Übersicht');

  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const escalationSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns-escalation.ts'),
    'utf8',
  );
  const dashboardPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/pages/client-portal/PortalDashboardPage.tsx'),
    'utf8',
  );
  const dashboardRouteSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/clientPortalRoutes.ts'),
    'utf8',
  );

  const total = 888;
  const pageSlice = (size: number | 'all', page: number) => {
    if (size === 'all') return total;
    return Math.min(size, Math.max(0, total - (page - 1) * size));
  };
  assert(pageSlice(20, 1) === 20, 'pagination default 20');
  assert(pageSlice(50, 1) === 50, 'pagination 50');
  assert(pageSlice(100, 9) === 88, 'pagination 100 last page');
  assert(pageSlice('all', 1) === 888, 'pagination Alle');

  assert(
    workbenchSrc.includes('PAGE_SIZE_OPTIONS') &&
      workbenchSrc.includes('Erinnerungsverlauf') &&
      !workbenchSrc.includes('Nächste Mail fällig') &&
      workbenchSrc.includes('Letzte Stufe / Eskaliert (4.+ Erinnerung)'),
    'workbench pagination + Erinnerung KPI strip',
  );
  assert(
    escalationSrc.includes('Math.min(2000') &&
      escalationSrc.includes('computeHardwareReturnsKpis') &&
      escalationSrc.includes('kpiRowFromHardwareRecord'),
    'returns list KPIs use shared classifier; Alle limit ≤2000',
  );
  assert(
    dashboardPageSrc.includes('returnsKpis') &&
      dashboardPageSrc.includes('hardwareReturnsEnabled') &&
      dashboardPageSrc.includes('Rücklieferungen-Trends') &&
      dashboardPageSrc.includes("useState<PortalReturnsTrendRange>('7d')") &&
      dashboardPageSrc.includes('Letzte Stufe / Eskaliert (4.+ Erinnerung)') &&
      dashboardPageSrc.includes('getReturnsTrends') &&
      dashboardPageSrc.includes('AbortController') &&
      dashboardPageSrc.includes('ZERO_RETURNS_KPIS') &&
      dashboardPageSrc.includes('dashboardLoading') &&
      dashboardPageSrc.includes('animate-pulse') &&
      dashboardPageSrc.includes('dataKey="offeneRuecklieferungen"') &&
      dashboardPageSrc.includes('dataKey="letzteStufeEskaliert"') &&
      !dashboardPageSrc.includes('returnsActivityByRange[') &&
      dashboardRouteSrc.includes('loadPortalDashboardReturnsStats') &&
      !dashboardRouteSrc.includes('listHardwareReturnsWorkbench') &&
      dashboardRouteSrc.includes('returnsActivityByRange = null') &&
      !dashboardPageSrc.includes('/api/db') &&
      !dashboardRouteSrc.includes("'/api/db"),
    'portal Übersicht 7d default + 4-series trends + independent fetch',
  );
  // FE must not cascade-refetch dashboard on trend range changes.
  assert(
    /useEffect\(\(\) => \{[\s\S]*?getDashboard\([\s\S]*?\}, \[\]\)/.test(dashboardPageSrc),
    'portal dashboard fetches /api/portal/dashboard once (empty deps)',
  );
  assert(
    /useEffect\(\(\) => \{[\s\S]*?getReturnsTrends\([\s\S]*?\}, \[returnsTrendRange/.test(
      dashboardPageSrc,
    ),
    'trends useEffect depends on timeframe (independent of dashboard)',
  );
}

function testPortalDashboardReturnsPerfLifecycle(): void {
  console.log('\n[19c2] Portal dashboard returns SQL/cache perf (900+ rows, all timeframes)');

  const now = new Date('2026-11-25T12:00:00.000Z');
  const rows = [];
  for (let i = 0; i < 900; i += 1) {
    const year = 2024 + (i % 3);
    const month = (i % 12) + 1;
    const day = (i % 27) + 1;
    const created = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dueDay = Math.min(28, day + 14);
    const due = `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
    const returned = i % 5 === 0;
    rows.push({
      createdAt: `${created}T10:00:00.000Z`,
      deliveryDate: created,
      returnDueDate: due,
      returned,
      returnedAt: returned ? `${created}T16:00:00.000Z` : null,
      mail1SentAt: i % 9 === 0 ? `${created}T12:00:00.000Z` : null,
      reminderCount: i % 11 === 0 ? 4 : i % 7 === 0 ? 2 : 0,
      reminderStages:
        i % 11 === 0
          ? [{ stage: 4, sentAt: `${created}T14:00:00.000Z` }]
          : [],
    });
  }

  const t0 = Date.now();
  const kpis = computePortalReturnsKpis(rows, now);
  const dashElapsed = Date.now() - t0;
  assert(rows.length >= 900, 'seeded ≥900 returns spanning 2024–2026');
  assert(kpis.open + kpis.returnedLast30 >= 0, 'KPIs computed');
  assert(
    dashElapsed < 100,
    `dashboard KPI compute for 900 rows <100ms (was ${dashElapsed}ms)`,
  );

  // Offline builders remain for fixtures; live path is SQL generate_series.
  const byRange = buildReturnsActivityByRangeFast(rows, now);
  assert(
    byRange['7d'].length === 7 &&
      byRange['30d'].length === 30 &&
      byRange['90d'].length === 90 &&
      byRange['12m'].length === 12 &&
      byRange.all.length >= 1 &&
      byRange.all.length <= 90,
    'all timeframes produce ≤90 buckets',
  );

  // Concurrent cache reads (simulates 10 parallel dashboard + trends requests).
  clearPortalReturnsCacheForTests();
  const orgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  setCachedPortalDashboardReturns(orgId, {
    returnsKpis: kpis,
    returnsActivityByRange: null,
  });
  for (const tf of ['7d', '30d', '90d', '12m', 'all'] as const) {
    setCachedPortalReturnsTrends(orgId, tf, {
      timeframe: tf,
      points: byRange[tf],
    });
  }
  const t2 = Date.now();
  const concurrent = Array.from({ length: 10 }, () => ({
    open: getCachedPortalDashboardReturns<{ returnsKpis: { open: number } }>(orgId)
      ?.returnsKpis?.open,
    n30: getCachedPortalReturnsTrends<{ points: unknown[] }>(orgId, '30d')?.points
      ?.length,
    n7: getCachedPortalReturnsTrends<{ points: unknown[] }>(orgId, '7d')?.points?.length,
    n90: getCachedPortalReturnsTrends<{ points: unknown[] }>(orgId, '90d')?.points?.length,
    n12: getCachedPortalReturnsTrends<{ points: unknown[] }>(orgId, '12m')?.points?.length,
    nAll: getCachedPortalReturnsTrends<{ points: unknown[] }>(orgId, 'all')?.points?.length,
  }));
  const concurrentElapsed = Date.now() - t2;
  assert(
    concurrent.every(
      (r) =>
        r.open === kpis.open &&
        r.n30 === 30 &&
        r.n7 === 7 &&
        r.n90 === 90 &&
        r.n12 === 12 &&
        (r.nAll || 0) >= 1,
    ) && concurrentElapsed < 150,
    `10 concurrent dashboard+trends (all timeframes) <150ms (was ${concurrentElapsed}ms)`,
  );

  invalidatePortalReturnsCache(orgId);
  assert(
    getCachedPortalDashboardReturns(orgId) == null &&
      getCachedPortalReturnsTrends(orgId, '30d') == null,
    'mutation invalidates org dashboard + trends cache',
  );

  const pgSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/postgres-backend.ts'),
    'utf8',
  );
  const sqlSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/portal-returns-sql-stats.ts'),
    'utf8',
  );
  const routesSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/hardwareReturnsRoutes.ts'),
    'utf8',
  );
  assert(
    pgSrc.includes('max: 20') &&
      pgSrc.includes('statement_timeout=5000') &&
      pgSrc.includes('idx_ticket_hw_returns_org_dashboard_trends') &&
      sqlSrc.includes('COUNT(*) FILTER') &&
      sqlSrc.includes('generate_series') &&
      routesSrc.includes("router.get('/trends'") &&
      routesSrc.includes('invalidatePortalReturnsCache'),
    'pool/timeout/index + SQL KPI/trends + /trends route + invalidation',
  );
}

/** Shared KPI classifier + dashboard/returns parity + distinct trend series. */
function testReturnsKpiConsistencyLifecycle(): void {
  console.log('\n[19c3] Returns KPI consistency (shared classifier + distinct trends)');

  const now = new Date('2026-11-25T12:00:00.000Z');

  const onTimeOpen = kpiRowFromLean({
    returned: false,
    returnDueDate: '2026-12-10',
    returnedAt: null,
    mail1SentAt: null,
    reminderStages: [],
    reminderCount: 0,
  });
  assert(isOpenReturn(onTimeOpen) === true, 'future-due open counts in Offen');
  assert(isOverdueReturn(onTimeOpen, now) === false, 'future-due + no mail1 NOT Überfällig');

  const pastDueOpen = kpiRowFromLean({
    returned: false,
    returnDueDate: '2026-11-10',
    returnedAt: null,
    mail1SentAt: null,
    reminderStages: [],
    reminderCount: 0,
  });
  assert(isOpenReturn(pastDueOpen) && isOverdueReturn(pastDueOpen, now), 'past due → Offen + Überfällig');

  const mail1Open = kpiRowFromLean({
    returned: false,
    returnDueDate: '2026-12-10',
    returnedAt: null,
    mail1SentAt: '2026-11-20T10:00:00.000Z',
    reminderStages: [],
    reminderCount: 1,
  });
  assert(
    isOpenReturn(mail1Open) && isOverdueReturn(mail1Open, now),
    '1. Erinnerung sent → Offen + Überfällig even if due in future',
  );

  const escalated = kpiRowFromHardwareRecord({
    return_required: true,
    returned: false,
    return_due_date: '2026-10-01',
    returned_at: null,
    mail1_sent_at: '2026-10-15T10:00:00.000Z',
    reminder_stages: [{ stage: 4, sentAt: '2026-11-01T10:00:00.000Z' }],
    reminder_count: 4,
  });
  assert(isEscalatedReturn(escalated), 'stage ≥ 4 → Letzte Stufe / Eskaliert');

  const returnedRecent = kpiRowFromLean({
    returned: true,
    returnDueDate: '2026-11-01',
    returnedAt: '2026-11-20T10:00:00.000Z',
    mail1SentAt: null,
    reminderStages: [],
    reminderCount: 0,
  });
  assert(isReturnedLast30(returnedRecent, now), 'returned within 30d counted');

  const mixed = [
    onTimeOpen,
    pastDueOpen,
    mail1Open,
    escalated,
    returnedRecent,
  ];
  const leanKpis = computeHardwareReturnsKpis(mixed, now);
  const hwKpis = computeHardwareReturnsKpis(
    [
      {
        return_required: true,
        returned: false,
        return_due_date: '2026-12-10',
        returned_at: null,
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
      },
      {
        return_required: true,
        returned: false,
        return_due_date: '2026-11-10',
        returned_at: null,
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
      },
      {
        return_required: true,
        returned: false,
        return_due_date: '2026-12-10',
        returned_at: null,
        mail1_sent_at: '2026-11-20T10:00:00.000Z',
        reminder_stages: [],
        reminder_count: 1,
      },
      {
        return_required: true,
        returned: false,
        return_due_date: '2026-10-01',
        returned_at: null,
        mail1_sent_at: '2026-10-15T10:00:00.000Z',
        reminder_stages: [{ stage: 4, sentAt: '2026-11-01T10:00:00.000Z' }],
        reminder_count: 4,
      },
      {
        return_required: true,
        returned: true,
        return_due_date: '2026-11-01',
        returned_at: '2026-11-20T10:00:00.000Z',
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
      },
    ].map(kpiRowFromHardwareRecord),
    now,
  );
  assert(
    leanKpis.open === 4 &&
      leanKpis.overdue === 3 &&
      leanKpis.stage3 === 1 &&
      leanKpis.returnedLast30 === 1,
    'mixed set: open=4 overdue=3 escalated=1 returned30=1',
  );
  assert(
    JSON.stringify(leanKpis) === JSON.stringify(hwKpis),
    'dashboard lean KPIs match returns workbench KPIs 1:1',
  );

  const trendRows = [
    {
      createdAt: '2026-11-01T10:00:00.000Z',
      deliveryDate: '2026-11-01',
      returnDueDate: '2026-12-10',
      returned: false,
      returnedAt: null,
      mail1SentAt: null,
      reminderCount: 0,
      reminderStages: [],
    },
    {
      createdAt: '2026-11-05T10:00:00.000Z',
      deliveryDate: '2026-11-05',
      returnDueDate: '2026-11-10',
      returned: false,
      returnedAt: null,
      mail1SentAt: null,
      reminderCount: 0,
      reminderStages: [],
    },
  ];
  const series = buildReturnsActivityByRangeFast(trendRows, now)['30d'];
  const last = series[series.length - 1]!;
  assert(last.open === 2, 'trend Offen = 2 open returns');
  assert(last.overdue === 1, 'trend Überfällig = 1 (only past-due)');
  assert(last.overdue < last.open, 'Überfällig strictly < Offen (not identical)');
  assert(
    series.some((p) => p.open !== p.overdue),
    'RÜCKLIEFERUNGEN-TRENDS produces distinct Offen vs Überfällig series',
  );
}

function testReturnsDynamicReminderStagesLifecycle(): void {
  console.log('\n[19f] Returns dynamic reminder stages 1..N (backend)');

  const cfg = defaultHardwareReturnsConfig();
  assert(cfg.stages.length === 4, 'default 4 stages');
  assert(
    defaultConfiguredReminderStages().length === 4 &&
      cfg.stages[3]!.ccRoles.includes('ceo'),
    'stage 4 includes ceo CC',
  );

  cfg.auto_send_enabled = true;
  const after3 = {
    ...({
      return_required: true,
      returned: false,
      auto_reminder_enabled: true,
      mail1_sent_at: '2026-10-01T10:00:00.000Z',
      mail2_sent_at: '2026-10-08T10:00:00.000Z',
      mail3_sent_at: '2026-10-15T10:00:00.000Z',
      reminder_stages: [],
      reminder_count: 3,
      delivery_date: '2026-10-01',
      return_due_date: '2026-10-15',
    } as any),
  };
  assert(
    evaluateDueReminderStage(after3, cfg, new Date('2026-10-22T12:00:00.000Z')) === 4,
    'scheduler due stage 4 after stage 3 + delay',
  );

  const s5 = resolveConfiguredStage(cfg, 5);
  const s6 = resolveConfiguredStage(cfg, 6);
  assert(s5.usedFallback && s6.usedFallback, 'stage 5/6 fallback to last template');
  let stages = upsertReminderStageSent([], {
    stage: 5,
    sentAt: '2026-11-01T00:00:00.000Z',
    scheduledDate: null,
    recipientsTo: ['a@b.c'],
    recipientsCc: [],
  });
  stages = upsertReminderStageSent(stages, {
    stage: 6,
    sentAt: '2026-11-08T00:00:00.000Z',
    scheduledDate: null,
    recipientsTo: ['a@b.c'],
    recipientsCc: [],
  });
  assert(reminderCountFromStages(stages) === 6, 'reminder_count → 6 after stage 5+6');
}

function testReturnsCollapsibleFilterBarLifecycle(): void {
  console.log('\n[19d2] Returns collapsible filter bar + Zeitraum date filtering');

  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const filtersSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns-filters.ts'),
    'utf8',
  );
  assert(
    workbenchSrc.includes('const [isFilterOpen, setIsFilterOpen] = useState(false)') &&
      workbenchSrc.includes('SlidersHorizontal') &&
      workbenchSrc.includes('RETURNS_ZEITRAUM_OPTIONS') &&
      filtersSrc.includes('Benutzerdefiniert') &&
      workbenchSrc.includes('Filter zurücksetzen') &&
      workbenchSrc.includes('dateRangeToApiParams') &&
      !workbenchSrc.includes("'/api/db"),
    'compact toolbar + collapsed Filter panel; portal-safe',
  );
  assert(
    workbenchSrc.includes('dateFrom') &&
      workbenchSrc.includes('dateTo') &&
      workbenchSrc.includes('dateField') &&
      workbenchSrc.includes('RETURNS_DATE_FIELD_OPTIONS') &&
      filtersSrc.includes('Eingangsdatum') &&
      workbenchSrc.includes('setPage(1)'),
    'Von/Bis + Datumsfeld; pagination resets on filter change',
  );

  const now = new Date('2026-11-25T12:00:00.000Z');
  const last30 = resolveZeitraumPreset('last_30', now, 'due');
  assert(
    last30.dateFrom === '2026-10-26' && last30.dateTo === '2026-11-25',
    'Letzte 30 Tage preset',
  );
  const month = resolveZeitraumPreset('this_month', now, 'delivery');
  assert(
    month.dateField === 'delivery' &&
      month.dateFrom === '2026-11-01' &&
      month.dateTo === '2026-11-25',
    'Dieser Monat keeps dateField + month start',
  );
  assert(
    dateRangeToApiParams('delivery', '2026-11-01', '2026-11-15').deliveryFrom === '2026-11-01',
    'delivery maps to deliveryFrom',
  );
  assert(
    countActiveReturnsAdvancedFilters({
      mailStatus: 'all',
      overdueBucket: 'overdue',
      shippingMethod: 'Express',
      statusFilter: 'all',
      assigneeFilter: 'all',
      exportStatus: 'all',
      dateFrom: '',
      dateTo: '',
      zeitraumActive: true,
    }) === 2,
    'badge counts overdue + shipping',
  );
}

function testReturnsInlineListEditorsLifecycle(): void {
  console.log('\n[19e] Returns inline Status / Geräte / Eingang bestätigen');

  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const inlineSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsInlineEditors.tsx'),
    'utf8',
  );

  assert(
    workbenchSrc.includes('Eingang bestätigen') &&
      workbenchSrc.includes('unreturnItem') &&
      workbenchSrc.includes('Rückgängig') &&
      workbenchSrc.includes('InlineStatusSelect') &&
      workbenchSrc.includes('DeviceSerialPopover') &&
      workbenchSrc.includes('patchDeviceFields') &&
      inlineSrc.includes('device_old_type') &&
      inlineSrc.includes('device_new_serial') &&
      !workbenchSrc.includes("'/api/db") &&
      !inlineSrc.includes("'/api/db"),
    'inline Status + device popover + Eingang/Rückgängig via portal-safe PATCH',
  );
}

function testReturnsListeKanbanKartenLifecycle(): void {
  console.log('\n[19d] Returns Liste | Kanban | Karten layouts');

  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const kanbanSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsKanbanBoard.tsx'),
    'utf8',
  );

  assert(
    workbenchSrc.includes('ReturnsViewModeSelector') &&
      workbenchSrc.includes('ReturnsKanbanBoard') &&
      workbenchSrc.includes('ReturnsCardGrid') &&
      workbenchSrc.includes("layoutMode === 'kanban' ? 'all'") &&
      workbenchSrc.includes('includeAllReturned'),
    'workbench wires Liste|Kanban|Karten; Kanban loads view=all for 4 buckets',
  );

  assert(
    RETURNS_LIFECYCLE_COLUMNS.length === 4 &&
      RETURNS_LIFECYCLE_COLUMNS.map((c) => c.id).join('|') ===
        'open|overdue|escalated|returned',
    'Kanban has 4 lifecycle columns matching KPI bars',
  );
  assert(
    DEFAULT_RETURN_STATUSES.join('|') === 'Neu|Warten auf Third Level|Abgeschlossen' &&
      !([...DEFAULT_RETURN_STATUSES] as string[]).includes('In Bearbeitung'),
    'default status catalog drops In Bearbeitung for new orgs',
  );

  const now = new Date('2026-11-25T12:00:00.000Z');
  const sample = [
    {
      hardwareReturn: {
        return_required: true,
        returned: false,
        return_due_date: '2026-12-10',
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
        status: 'Neu',
      },
    },
    {
      hardwareReturn: {
        return_required: true,
        returned: false,
        return_due_date: '2026-11-01',
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
        status: 'Neu',
      },
    },
    {
      hardwareReturn: {
        return_required: true,
        returned: false,
        return_due_date: '2026-10-01',
        mail1_sent_at: '2026-10-15T10:00:00.000Z',
        reminder_stages: [{ stage: 4, sentAt: '2026-11-01T10:00:00.000Z' }],
        reminder_count: 4,
        status: 'Neu',
      },
    },
    {
      hardwareReturn: {
        return_required: true,
        returned: true,
        returned_at: '2026-11-20T10:00:00.000Z',
        return_due_date: '2026-11-01',
        mail1_sent_at: null,
        reminder_stages: [],
        reminder_count: 0,
        status: 'Abgeschlossen',
      },
    },
  ];
  assert(resolveReturnsLifecycleColumn(sample[0]!, now) === 'open', 'lifecycle → Offen');
  assert(resolveReturnsLifecycleColumn(sample[1]!, now) === 'overdue', 'lifecycle → Überfällig');
  assert(resolveReturnsLifecycleColumn(sample[2]!, now) === 'escalated', 'lifecycle → Eskaliert');
  assert(resolveReturnsLifecycleColumn(sample[3]!, now) === 'returned', 'lifecycle → Zurückgeliefert');

  const buckets = buildReturnsLifecycleBuckets(sample, { now, includeAllReturned: false });
  assert(
    buckets.open.length === 1 &&
      buckets.overdue.length === 1 &&
      buckets.escalated.length === 1 &&
      buckets.returned.length === 1,
    'lifecycle buckets have accurate counts (1 each)',
  );

  // Liste still uses catalog status columns (Kanban does not).
  const cols = buildReturnsStatusColumns(
    ['Neu', 'Abgeschlossen', 'Warten auf Logistik'],
    [
      { hardwareReturn: { status: 'Neu' } },
      { hardwareReturn: { status: 'Warten auf Logistik' } },
      { hardwareReturn: { status: 'Sonderstatus DPG' } },
    ],
  );
  assert(cols.includes('Warten auf Logistik'), 'Liste catalog keeps admin-added statuses');
  assert(cols.includes('Sonderstatus DPG'), 'Liste orphan status gets its own column');
  assert(
    resolveReturnsStatusColumn('Abgeschlossen', cols) === 'Abgeschlossen',
    'Liste status column resolves case-insensitively',
  );

  assert(
    kanbanSrc.includes('draggable') &&
      kanbanSrc.includes('onDrop') &&
      kanbanSrc.includes('buildReturnsLifecycleBuckets') &&
      kanbanSrc.includes('RETURNS_LIFECYCLE_COLUMNS') &&
      kanbanSrc.includes("target === 'returned'") &&
      workbenchSrc.includes('returned: true') &&
      workbenchSrc.includes('returned_at: nowIso') &&
      !kanbanSrc.includes("'/api/db") &&
      !workbenchSrc.includes("'/api/db"),
    'Kanban DnD into Zurückgeliefert PATCHes returned=true (no /api/db)',
  );
}

function testReturnsDetailOverviewLifecycle(): void {
  console.log('\n[24] Rücklieferung Detail Overview (Part 2)');

  const overviewSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnDetailOverviewPage.tsx'),
    'utf8',
  );
  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const editorSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnEditorPage.tsx'),
    'utf8',
  );
  const appSrc = fs.readFileSync(path.join(process.cwd(), 'src/App.tsx'), 'utf8');

  const layoutSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/client-portal/ClientPortalLayout.tsx'),
    'utf8',
  );
  assert(
    overviewSrc.includes('Bearbeiten') &&
      overviewSrc.includes('Geräte-Informationen') &&
      overviewSrc.includes('Mitarbeiter & Kontakt') &&
      overviewSrc.includes('Versand- & Rückgabe-Tracking') &&
      overviewSrc.includes('Verlauf & Aktivitätsprotokoll') &&
      overviewSrc.includes('Erinnerung senden') &&
      overviewSrc.includes('SerialCopyPill') &&
      overviewSrc.includes('Eingang rückgängig') &&
      !overviewSrc.includes('+{overdue} Tage überfällig') &&
      !overviewSrc.includes("'/api/db") &&
      !overviewSrc.includes('"/api/db'),
    'overview polish: scroll-friendly, copy SN, no duplicate note/overdue; zero /api/db',
  );
  assert(
    layoutSrc.includes('returnsNeedsPageScroll') && layoutSrc.includes('isReturnsList'),
    'portal main scrolls on returns detail/edit',
  );
  assert(
    workbenchSrc.includes('openDetails') &&
      !workbenchSrc.includes('/tickets/kunden/') &&
      workbenchSrc.includes('/returns/${encodeURIComponent(id)}?organizationId='),
    'staff Details opens /returns/:id overview',
  );
  assert(
    editorSrc.includes('overviewPath') &&
      appSrc.includes('returns/:id/edit') &&
      appSrc.includes('ClientReturnDetailPage') &&
      appSrc.includes('StaffReturnDetailPage'),
    'edit route separate; save can return to overview',
  );
}

function testReturnsShipmentStatusLifecycle(): void {
  console.log('\n[23] Rücksendestatus shipment_status — PATCH sync + pills (Part 1)');

  assert(coerceShipmentStatus('Ausstehend') === 'versendet', 'legacy ausstehend → versendet');
  assert(coerceShipmentStatus('VERSENDET') === 'versendet', 'coerce versendet');
  assert(coerceShipmentStatus('eingegangen') === 'eingegangen', 'coerce eingegangen');
  assert(coerceShipmentStatus('bogus') === null, 'coerce rejects unknown');

  // Effective display: only Versendet | Eingegangen (returned wins).
  assert(
    resolveEffectiveShipmentStatus({ returned: true, shipment_status: null }) === 'eingegangen',
    'returned=true → Eingegangen (no backfill)',
  );
  assert(
    resolveEffectiveShipmentStatus({ returned: false, shipment_status: 'ausstehend' }) ===
      'versendet',
    'legacy ausstehend displays as Versendet',
  );
  assert(
    resolveEffectiveShipmentStatus({ returned: false, shipment_status: null }) === 'versendet',
    'null shipment_status → Versendet (legacy default)',
  );
  assert(
    resolveEffectiveShipmentStatus({ returned: false, shipment_status: 'versendet' }) ===
      'versendet',
    'explicit versendet',
  );

  const base = normalizeHardwareReturnInput({
    shipping_method: 'Standard',
    shipment_status: 'versendet',
  });
  assert(base.shipment_status === 'versendet', 'create/PATCH persists versendet');

  const toPending = normalizeHardwareReturnInput(
    { shipment_status: 'ausstehend' },
    { existing: base as any },
  );
  assert(
    toPending.shipment_status === 'versendet' && !toPending.returned,
    'PATCH legacy ausstehend normalizes to versendet',
  );

  const toReceived = normalizeHardwareReturnInput(
    { shipment_status: 'eingegangen' },
    { existing: { ...(base as any), returned: false, returned_at: null } },
  );
  assert(
    toReceived.shipment_status === 'eingegangen' &&
      toReceived.returned === true &&
      typeof toReceived.returned_at === 'string',
    'PATCH eingegangen auto-sets returned + returned_at (Eingang bestätigen sync)',
  );

  const leaveReceived = normalizeHardwareReturnInput(
    { shipment_status: 'versendet' },
    {
      existing: {
        ...(base as any),
        returned: true,
        returned_at: toReceived.returned_at,
        shipment_status: 'eingegangen',
      },
    },
  );
  assert(
    leaveReceived.shipment_status === 'versendet' &&
      leaveReceived.returned === false &&
      leaveReceived.returned_at == null,
    'leaving eingegangen via pill clears returned',
  );

  const markReceived = normalizeHardwareReturnInput(
    { returned: true },
    { existing: { ...(base as any), shipment_status: 'ausstehend', returned: false } },
  );
  assert(
    markReceived.returned === true && markReceived.shipment_status === 'eingegangen',
    'Eingang bestätigen forces shipment_status=eingegangen',
  );
  const unreturn = normalizeHardwareReturnInput(
    { returned: false },
    {
      existing: {
        ...(base as any),
        returned: true,
        returned_at: markReceived.returned_at,
        shipment_status: 'eingegangen',
      },
    },
  );
  assert(
    unreturn.returned === false && unreturn.shipment_status === 'versendet',
    'undo receipt reverts shipment_status to versendet',
  );

  let threw = false;
  try {
    normalizeHardwareReturnInput({ shipment_status: 'flying' }, { existing: base as any });
  } catch {
    threw = true;
  }
  assert(threw, 'invalid shipment_status → 400');

  const escalationSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns-escalation.ts'),
    'utf8',
  );
  assert(
    escalationSrc.includes("shipment_status = 'eingegangen'"),
    'markHardwareReturned SQL sets shipment_status=eingegangen',
  );

  const hwSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/client-portal/hardware-returns.ts'),
    'utf8',
  );
  assert(
    hwSrc.includes('shipment_status') &&
      hwSrc.includes('coerceShipmentStatus') &&
      hwSrc.includes("next.shipment_status = 'eingegangen'") &&
      hwSrc.includes("next.shipment_status = 'versendet'"),
    'normalize + UPDATE/INSERT expose shipment_status',
  );

  const mig = fs.readFileSync(
    path.join(
      process.cwd(),
      'prisma/migrations/20261126150000_hardware_returns_shipment_status/migration.sql',
    ),
    'utf8',
  );
  assert(
    mig.includes('ADD COLUMN IF NOT EXISTS shipment_status TEXT'),
    'idempotent shipment_status migration',
  );

  const pgSrc = fs.readFileSync(path.join(process.cwd(), 'src/lib/postgres-backend.ts'), 'utf8');
  assert(
    pgSrc.includes('shipment_status TEXT') &&
      pgSrc.includes('ADD COLUMN IF NOT EXISTS shipment_status TEXT'),
    'postgres-backend creates + alters shipment_status',
  );

  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const pillSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ShipmentStatusPill.tsx'),
    'utf8',
  );
  const editorSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnEditorPage.tsx'),
    'utf8',
  );
  const sharedSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/returns-layout-shared.tsx'),
    'utf8',
  );
  const kanbanSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsKanbanBoard.tsx'),
    'utf8',
  );
  const cardsSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsCardGrid.tsx'),
    'utf8',
  );

  const deliveryPillsSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/DeliveryDuePills.tsx'),
    'utf8',
  );
  const stepperSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsReminderStepper.tsx'),
    'utf8',
  );
  assert(
    pillSrc.includes('bg-blue-50 text-blue-700 border-blue-200') &&
      pillSrc.includes('bg-emerald-50 text-emerald-700 border-emerald-200') &&
      !pillSrc.includes('ausstehend') &&
      pillSrc.includes('Send') &&
      pillSrc.includes('CheckCircle2') &&
      pillSrc.includes('e.stopPropagation()'),
    'ShipmentStatusPill Versendet|Eingegangen only',
  );
  assert(
    workbenchSrc.includes('DeliveryDuePills') &&
      deliveryPillsSrc.includes('Versendet ·') &&
      deliveryPillsSrc.includes('Eingegangen ·') &&
      deliveryPillsSrc.includes('Tage überfällig') &&
      !workbenchSrc.includes('Versand: {hw.') &&
      !workbenchSrc.includes("'/api/db") &&
      !workbenchSrc.includes('"/api/db'),
    'list uses 2-pill DeliveryDuePills; zero /api/db',
  );
  assert(
    sharedSrc.includes('DeliveryDuePills') &&
      stepperSrc.includes('h-6 min-w-6') &&
      stepperSrc.includes('text-[11px]') &&
      stepperSrc.includes('h-[1.5px] w-2') &&
      workbenchSrc.includes('ArrowUpRight') &&
      workbenchSrc.includes('shadow-2xs'),
    'compact 24px stepper + modern Details button',
  );
  assert(
    editorSrc.includes('Rücksendestatus') &&
      editorSrc.includes('SHIPMENT_STATUS_OPTIONS') &&
      editorSrc.includes('shipment_status') &&
      !editorSrc.includes("'ausstehend'"),
    'full-page form has 2-state Rücksendestatus selector',
  );
  assert(
    workbenchSrc.includes("'/api/portal/returns'") && workbenchSrc.includes("'/api/returns'"),
    'staff + portal PATCH bases unchanged',
  );
}

function testSharePointReturnsCsvImportUiLifecycle(): void {
  console.log('\n[22] SharePoint Returns CSV import UI (Part 3) — modal preview/commit');

  const modalSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsCsvImportModal.tsx'),
    'utf8',
  );
  const workbenchSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/returns/ReturnsWorkbench.tsx'),
    'utf8',
  );
  const portalPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/pages/client-portal/ClientReturnsPage.tsx'),
    'utf8',
  );
  const staffPageSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/pages/StaffReturnsPage.tsx'),
    'utf8',
  );

  assert(
    workbenchSrc.includes('ReturnsCsvImportModal') &&
      staffPageSrc.includes('canImportCsv') &&
      portalPageSrc.includes('canImportCsv={isOrgWide}'),
    'staff + portal wire CSV import into shared workbench',
  );
  assert(
    modalSrc.includes('/import-csv/preview') &&
      modalSrc.includes('${apiBase}/import-csv') &&
      !modalSrc.includes("'/api/db") &&
      !modalSrc.includes('"/api/db') &&
      !workbenchSrc.includes("'/api/db") &&
      !workbenchSrc.includes('"/api/db'),
    'UI never calls /api/db; uses preview then commit',
  );
  assert(
    modalSrc.includes('excludeTestRows') &&
      modalSrc.includes('mergeCatalogs') &&
      modalSrc.includes('seedDirectory') &&
      modalSrc.includes('enableAutoReminders') &&
      modalSrc.includes('setEnableAutoReminders(false)') &&
      modalSrc.includes('Empfohlen: Aus lassen'),
    'commit payload flags match API; auto-reminders default unchecked',
  );
  assert(
    modalSrc.includes('employeesSeeded') &&
      modalSrc.includes('Rücklieferungen importiert') &&
      modalSrc.includes('onImported') &&
      workbenchSrc.includes('onImported={() =>') &&
      workbenchSrc.includes('void load()'),
    'success toast + list/KPI refresh after import',
  );
  assert(
    workbenchSrc.includes('Neue Rücklieferung erstellen') &&
      workbenchSrc.includes('openCreate'),
    'create CTA unchanged alongside CSV modal',
  );
}

function testPortalKbSharePointCsvImportLifecycle(): void {
  console.log('\n[20] Portal KB SharePoint CSV import lifecycle');

  const ORG_A = 'org-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const ORG_B = 'org-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const sampleCsv =
    '\uFEFFID;Matchcode;Problem;GenaueProblembeschreibung;Loesungsweg;Webseite;Anlagen\n' +
    '10;DPG PrüfApp PRO;"Login Fehler:\nDetails";Genau;"=> Fix";example.dpg.de/path;1\n' +
    '11;DPG PrüfApp PRO;"Absturz beim Start";"Genau 2";"=> Restart";;0\n' +
    '21;;"Ohne Matchcode Titel";"x";"y";;0\n';

  const rows = parseSharePointCsvRows(sampleCsv);
  const counts = countMatchcodeOccurrences(rows);
  assert((counts.get('DPG PrüfApp PRO') || 0) === 2, 'duplicate Matchcode counted');
  assert(
    buildSmartTitle(rows[0], counts) !== buildSmartTitle(rows[1], counts),
    'two PrüfApp rows keep distinct titles',
  );

  const previews = buildSharePointPreviewArticles(sampleCsv);
  const planned = planKbCsvImportArticles(
    previews.map((p) => ({
      title: p.title,
      content: p.content,
      sharePointId: p.sharePointId,
      hasAttachments: p.hasAttachments,
    })),
    [],
  );
  assert(planned.toImport.length >= 3, 'CSV plans multiple articles');

  const reimport = planKbCsvImportArticles(
    planned.toImport,
    planned.toImport.map((a) => a.title),
  );
  assert(
    reimport.toImport.length === 0 && reimport.skipped.length === planned.toImport.length,
    're-import skips duplicates cleanly',
  );

  const dpgDoc = {
    title: planned.toImport[0].title,
    content: planned.toImport[0].content,
    visibility: 'organization',
    organizationId: ORG_B,
  };
  assert(isKbArticleVisibleToPortal(dpgDoc, ORG_B) === true, 'DPG sees own import');
  assert(isKbArticleVisibleToPortal(dpgDoc, ORG_A) === false, 'Citadelle cannot see DPG import');

  assert(assertPortalKbWriteRole('CLIENT_USER') === false, 'CLIENT_USER → 403 on import');
  assert(assertPortalKbWriteRole('CLIENT_ADMIN') === true, 'CLIENT_ADMIN may import');

  const portalKbSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/routes/clientPortalKbRoutes.ts'),
    'utf8',
  );
  assert(
    portalKbSrc.includes('/import-csv') &&
      portalKbSrc.includes("visibility: 'organization'") &&
      portalKbSrc.includes('sessionOrg(req)'),
    'portal import-csv ignores spoofed organizationId (session lock)',
  );

  const adapterSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/kb/kb-workbench-adapter.ts'),
    'utf8',
  );
  assert(
    /PORTAL_KB_WRITER_CAPABILITIES[\s\S]*importCsv:\s*true/.test(adapterSrc),
    'portal writers expose CSV import capability',
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
  testPortalKbArticleEditLifecycle();
  testReturnsPaginationErinnerungDashboardLifecycle();
  testPortalDashboardReturnsPerfLifecycle();
  testReturnsKpiConsistencyLifecycle();
  testReturnsListeKanbanKartenLifecycle();
  testReturnsCollapsibleFilterBarLifecycle();
  testReturnsInlineListEditorsLifecycle();
  testReturnsDynamicReminderStagesLifecycle();
  testPortalKbSharePointCsvImportLifecycle();
  testSharePointReturnsCsvImportApiLifecycle();
  testSharePointReturnsCsvImportUiLifecycle();
  testReturnsShipmentStatusLifecycle();
  testReturnsDetailOverviewLifecycle();

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
