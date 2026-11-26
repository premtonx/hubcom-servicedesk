/**
 * Per-organization local AI (Ollama / OpenAI-compat) settings.
 * Secrets encrypted at rest via AES-256-GCM; never returned raw to clients.
 */

import {
  decryptEmailChannelSecret,
  encryptEmailChannelSecret,
  isEncryptedEmailSecret,
} from '../email-ingestion/channel-secret-crypto.js';

export const ORG_AI_MODES = ['global_default', 'org_local_ai', 'disabled'] as const;
export type OrgAiMode = (typeof ORG_AI_MODES)[number];

export const LOCAL_SERVER_TYPES = ['ollama', 'openai_compatible'] as const;
export type LocalServerType = (typeof LOCAL_SERVER_TYPES)[number];

/** Portal AI feature buckets for per-model selection. */
export const ORG_AI_FEATURE_KINDS = [
  'ticket_summary',
  'ticket_reply',
  'kb_assistant',
  'rag_embedding',
] as const;
export type OrgAiFeatureKind = (typeof ORG_AI_FEATURE_KINDS)[number];

export const LOCAL_AI_UNREACHABLE_ERROR =
  'Lokaler KI-Server ist unter dieser Adresse nicht erreichbar.';
export const ORG_AI_DISABLED_ERROR = 'KI für diesen Mandanten ist deaktiviert.';

export interface OrgAiSettings {
  ai_mode: OrgAiMode;
  local_server_type: LocalServerType;
  local_llm_endpoint: string;
  /** Fallback chat model when a per-feature override is empty. */
  local_llm_model: string;
  local_embedding_endpoint: string;
  /** @deprecated prefer model_rag_embedding — kept for back-compat. */
  local_embedding_model: string;
  local_ai_api_key_enc: string | null;
  model_ticket_summary: string;
  model_ticket_reply: string;
  model_kb_assistant: string;
  model_rag_embedding: string;
  strict_local_only: boolean;
  include_shared_kb_in_rag: boolean;
  last_embedding_model: string | null;
}

/** Public DTO — never includes raw or encrypted secrets. */
export interface OrgAiSettingsPublic {
  ai_mode: OrgAiMode;
  local_server_type: LocalServerType;
  local_llm_endpoint: string;
  local_llm_model: string;
  local_embedding_endpoint: string;
  local_embedding_model: string;
  local_ai_api_key_set: boolean;
  model_ticket_summary: string;
  model_ticket_reply: string;
  model_kb_assistant: string;
  model_rag_embedding: string;
  strict_local_only: boolean;
  include_shared_kb_in_rag: boolean;
  last_embedding_model: string | null;
  needs_reindex: boolean;
}

export interface OrgAiSettingsUpdateInput {
  ai_mode?: OrgAiMode | string | null;
  local_server_type?: LocalServerType | string | null;
  local_llm_endpoint?: string | null;
  local_llm_model?: string | null;
  local_embedding_endpoint?: string | null;
  local_embedding_model?: string | null;
  local_ai_api_key?: string | null;
  model_ticket_summary?: string | null;
  model_ticket_reply?: string | null;
  model_kb_assistant?: string | null;
  model_rag_embedding?: string | null;
  strict_local_only?: boolean | null;
  include_shared_kb_in_rag?: boolean | null;
}

function asTrimmed(value: unknown, max = 500): string {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

export function isOrgAiMode(value: unknown): value is OrgAiMode {
  return typeof value === 'string' && (ORG_AI_MODES as readonly string[]).includes(value);
}

export function isLocalServerType(value: unknown): value is LocalServerType {
  return typeof value === 'string' && (LOCAL_SERVER_TYPES as readonly string[]).includes(value);
}

export function defaultOrgAiSettings(): OrgAiSettings {
  return {
    ai_mode: 'global_default',
    local_server_type: 'ollama',
    local_llm_endpoint: '',
    local_llm_model: 'llama3',
    local_embedding_endpoint: '',
    local_embedding_model: 'nomic-embed-text',
    local_ai_api_key_enc: null,
    model_ticket_summary: '',
    model_ticket_reply: '',
    model_kb_assistant: '',
    model_rag_embedding: '',
    strict_local_only: true,
    include_shared_kb_in_rag: false,
    last_embedding_model: null,
  };
}

/**
 * Map lifecycle / portal AI feature ids onto org model buckets.
 */
export function mapAiFeatureToOrgModelKind(
  feature: string | null | undefined,
): OrgAiFeatureKind {
  const f = String(feature || '').trim();
  if (f === 'smart_reply' || f === 'ticket_reply' || f === 'reply') return 'ticket_reply';
  if (
    f === 'kb_generation' ||
    f === 'kb_assistant' ||
    f === 'kb_ask' ||
    f === 'kb_generate'
  ) {
    return 'kb_assistant';
  }
  if (f === 'rag_embedding' || f === 'embedding') return 'rag_embedding';
  if (
    f === 'ticket_summarization' ||
    f === 'root_cause_analysis' ||
    f === 'ticket_summary' ||
    f === 'triage' ||
    f === 'detail_analysis'
  ) {
    return 'ticket_summary';
  }
  return 'ticket_summary';
}

/** Resolve chat/embedding model for a feature; empty override → local_llm_model / embedding default. */
export function resolveOrgFeatureModel(
  settings: OrgAiSettings,
  kind: OrgAiFeatureKind,
): string {
  const chatFallback = settings.local_llm_model || 'llama3';
  const embFallback =
    settings.model_rag_embedding ||
    settings.local_embedding_model ||
    'nomic-embed-text';
  switch (kind) {
    case 'ticket_summary':
      return asTrimmed(settings.model_ticket_summary, 120) || chatFallback;
    case 'ticket_reply':
      return asTrimmed(settings.model_ticket_reply, 120) || chatFallback;
    case 'kb_assistant':
      return asTrimmed(settings.model_kb_assistant, 120) || chatFallback;
    case 'rag_embedding':
      return asTrimmed(settings.model_rag_embedding, 120) || embFallback;
    default:
      return chatFallback;
  }
}

/**
 * Normalize settings from organizations.settings (or nested ai / local_ai keys).
 */
export function normalizeOrgAiSettings(
  orgOrSettings:
    | { settings?: Record<string, unknown> | null }
    | Record<string, unknown>
    | null
    | undefined,
): OrgAiSettings {
  const defaults = defaultOrgAiSettings();
  if (!orgOrSettings || typeof orgOrSettings !== 'object') return defaults;

  const root = orgOrSettings as Record<string, unknown>;
  const settings =
    root.settings && typeof root.settings === 'object'
      ? (root.settings as Record<string, unknown>)
      : root;
  const nested =
    settings.ai && typeof settings.ai === 'object'
      ? (settings.ai as Record<string, unknown>)
      : settings.local_ai && typeof settings.local_ai === 'object'
        ? (settings.local_ai as Record<string, unknown>)
        : settings;

  const modeRaw = nested.ai_mode ?? nested.aiMode ?? defaults.ai_mode;
  const ai_mode: OrgAiMode = isOrgAiMode(modeRaw) ? modeRaw : 'global_default';

  const serverRaw =
    nested.local_server_type ?? nested.localServerType ?? defaults.local_server_type;
  const local_server_type: LocalServerType = isLocalServerType(serverRaw)
    ? serverRaw
    : 'ollama';

  const strictRaw = nested.strict_local_only ?? nested.strictLocalOnly;
  const strict_local_only =
    typeof strictRaw === 'boolean'
      ? strictRaw
      : ai_mode === 'org_local_ai'
        ? true
        : defaults.strict_local_only;

  const includeRaw =
    nested.include_shared_kb_in_rag ??
    nested.includeSharedKbInRag ??
    settings.include_shared_kb_in_rag ??
    settings.includeSharedKbInRag;
  const include_shared_kb_in_rag = includeRaw === true;

  const enc =
    asTrimmed(nested.local_ai_api_key_enc ?? nested.localAiApiKeyEnc, 4000) || null;

  const local_llm_model =
    asTrimmed(nested.local_llm_model ?? nested.localLlmModel, 120) ||
    defaults.local_llm_model;
  const local_embedding_model =
    asTrimmed(nested.local_embedding_model ?? nested.localEmbeddingModel, 120) ||
    defaults.local_embedding_model;

  return {
    ai_mode,
    local_server_type,
    local_llm_endpoint: asTrimmed(
      nested.local_llm_endpoint ?? nested.localLlmEndpoint,
      500,
    ),
    local_llm_model,
    local_embedding_endpoint: asTrimmed(
      nested.local_embedding_endpoint ?? nested.localEmbeddingEndpoint,
      500,
    ),
    local_embedding_model,
    local_ai_api_key_enc: enc,
    model_ticket_summary: asTrimmed(
      nested.model_ticket_summary ?? nested.modelTicketSummary,
      120,
    ),
    model_ticket_reply: asTrimmed(
      nested.model_ticket_reply ?? nested.modelTicketReply,
      120,
    ),
    model_kb_assistant: asTrimmed(
      nested.model_kb_assistant ?? nested.modelKbAssistant,
      120,
    ),
    model_rag_embedding: asTrimmed(
      nested.model_rag_embedding ?? nested.modelRagEmbedding,
      120,
    ),
    strict_local_only,
    include_shared_kb_in_rag,
    last_embedding_model:
      asTrimmed(nested.last_embedding_model ?? nested.lastEmbeddingModel, 120) || null,
  };
}

export function toPublicOrgAiSettings(settings: OrgAiSettings): OrgAiSettingsPublic {
  const embeddingModel = resolveOrgFeatureModel(settings, 'rag_embedding');
  const needs_reindex =
    settings.ai_mode === 'org_local_ai' &&
    Boolean(settings.last_embedding_model) &&
    settings.last_embedding_model !== embeddingModel;

  return {
    ai_mode: settings.ai_mode,
    local_server_type: settings.local_server_type,
    local_llm_endpoint: settings.local_llm_endpoint,
    local_llm_model: settings.local_llm_model,
    local_embedding_endpoint: settings.local_embedding_endpoint,
    local_embedding_model: embeddingModel,
    local_ai_api_key_set: Boolean(settings.local_ai_api_key_enc),
    model_ticket_summary: settings.model_ticket_summary,
    model_ticket_reply: settings.model_ticket_reply,
    model_kb_assistant: settings.model_kb_assistant,
    model_rag_embedding: settings.model_rag_embedding || embeddingModel,
    strict_local_only: settings.strict_local_only !== false,
    include_shared_kb_in_rag: settings.include_shared_kb_in_rag === true,
    last_embedding_model: settings.last_embedding_model,
    needs_reindex,
  };
}

/** Merge update input into existing settings; encrypts API key when provided. */
export function applyOrgAiSettingsUpdate(
  current: OrgAiSettings,
  input: OrgAiSettingsUpdateInput,
): OrgAiSettings {
  const next: OrgAiSettings = { ...current };

  if (input.ai_mode != null && String(input.ai_mode).trim() !== '') {
    next.ai_mode = isOrgAiMode(input.ai_mode) ? input.ai_mode : current.ai_mode;
  }
  if (input.local_server_type != null && String(input.local_server_type).trim() !== '') {
    next.local_server_type = isLocalServerType(input.local_server_type)
      ? input.local_server_type
      : current.local_server_type;
  }
  if (input.local_llm_endpoint !== undefined) {
    next.local_llm_endpoint = asTrimmed(input.local_llm_endpoint, 500);
  }
  if (input.local_llm_model !== undefined) {
    next.local_llm_model =
      asTrimmed(input.local_llm_model, 120) || defaultOrgAiSettings().local_llm_model;
  }
  if (input.local_embedding_endpoint !== undefined) {
    next.local_embedding_endpoint = asTrimmed(input.local_embedding_endpoint, 500);
  }
  if (input.local_embedding_model !== undefined) {
    next.local_embedding_model =
      asTrimmed(input.local_embedding_model, 120) ||
      defaultOrgAiSettings().local_embedding_model;
  }
  if (input.model_ticket_summary !== undefined) {
    next.model_ticket_summary = asTrimmed(input.model_ticket_summary, 120);
  }
  if (input.model_ticket_reply !== undefined) {
    next.model_ticket_reply = asTrimmed(input.model_ticket_reply, 120);
  }
  if (input.model_kb_assistant !== undefined) {
    next.model_kb_assistant = asTrimmed(input.model_kb_assistant, 120);
  }
  if (input.model_rag_embedding !== undefined) {
    next.model_rag_embedding = asTrimmed(input.model_rag_embedding, 120);
    if (next.model_rag_embedding) {
      next.local_embedding_model = next.model_rag_embedding;
    }
  }
  if (input.strict_local_only !== undefined && input.strict_local_only !== null) {
    next.strict_local_only = Boolean(input.strict_local_only);
  } else if (next.ai_mode === 'org_local_ai' && input.ai_mode === 'org_local_ai') {
    if (current.ai_mode !== 'org_local_ai' && input.strict_local_only == null) {
      next.strict_local_only = true;
    }
  }
  if (input.include_shared_kb_in_rag !== undefined && input.include_shared_kb_in_rag !== null) {
    next.include_shared_kb_in_rag = Boolean(input.include_shared_kb_in_rag);
  }

  if (input.local_ai_api_key !== undefined) {
    const plain = String(input.local_ai_api_key ?? '');
    if (!plain.trim() || plain.trim() === '••••••••') {
      if (plain.trim() === '') next.local_ai_api_key_enc = null;
    } else if (isEncryptedEmailSecret(plain)) {
      next.local_ai_api_key_enc = plain;
    } else {
      next.local_ai_api_key_enc = encryptEmailChannelSecret(plain.trim());
    }
  }

  return next;
}

export function orgAiSettingsToSettingsPatch(settings: OrgAiSettings): Record<string, unknown> {
  return {
    ai_mode: settings.ai_mode,
    local_server_type: settings.local_server_type,
    local_llm_endpoint: settings.local_llm_endpoint,
    local_llm_model: settings.local_llm_model,
    local_embedding_endpoint: settings.local_embedding_endpoint,
    local_embedding_model:
      settings.model_rag_embedding || settings.local_embedding_model,
    local_ai_api_key_enc: settings.local_ai_api_key_enc,
    model_ticket_summary: settings.model_ticket_summary,
    model_ticket_reply: settings.model_ticket_reply,
    model_kb_assistant: settings.model_kb_assistant,
    model_rag_embedding: settings.model_rag_embedding,
    strict_local_only: settings.strict_local_only,
    include_shared_kb_in_rag: settings.include_shared_kb_in_rag,
    last_embedding_model: settings.last_embedding_model,
  };
}

export function decryptOrgAiApiKey(settings: OrgAiSettings): string | null {
  if (!settings.local_ai_api_key_enc) return null;
  try {
    const plain = decryptEmailChannelSecret(settings.local_ai_api_key_enc);
    return plain && plain !== '••••••••' ? plain : null;
  } catch {
    return null;
  }
}

export function resolveOrgLlmEndpoint(settings: OrgAiSettings): string {
  return asTrimmed(settings.local_llm_endpoint, 500).replace(/\/$/, '');
}

export function resolveOrgEmbeddingEndpoint(settings: OrgAiSettings): string {
  const emb = asTrimmed(settings.local_embedding_endpoint, 500);
  if (emb) return emb.replace(/\/$/, '');
  return resolveOrgLlmEndpoint(settings);
}

export function isOrgStrictLocalAi(settings: OrgAiSettings): boolean {
  return settings.ai_mode === 'org_local_ai' && settings.strict_local_only !== false;
}

export function isOrgAiEnabled(settings: OrgAiSettings): boolean {
  return settings.ai_mode !== 'disabled';
}

export function markEmbeddingModelSaved(settings: OrgAiSettings): OrgAiSettings {
  return {
    ...settings,
    last_embedding_model: resolveOrgFeatureModel(settings, 'rag_embedding') || null,
  };
}

/**
 * Pure routing decision for tests — which endpoint class should handle a call.
 */
export function resolveOrgAiRouting(
  settings: OrgAiSettings,
  feature?: string | null,
):
  | { mode: 'disabled'; error: string }
  | { mode: 'global_default' }
  | {
      mode: 'org_local_ai';
      endpoint: string;
      model: string;
      embeddingEndpoint: string;
      embeddingModel: string;
      serverType: LocalServerType;
      featureKind: OrgAiFeatureKind;
      strictLocalOnly: boolean;
      allowCloudFallback: boolean;
    } {
  if (settings.ai_mode === 'disabled') {
    return { mode: 'disabled', error: ORG_AI_DISABLED_ERROR };
  }
  if (settings.ai_mode !== 'org_local_ai') {
    return { mode: 'global_default' };
  }
  const featureKind = mapAiFeatureToOrgModelKind(feature);
  const endpoint = resolveOrgLlmEndpoint(settings);
  return {
    mode: 'org_local_ai',
    endpoint,
    model: resolveOrgFeatureModel(settings, featureKind),
    embeddingEndpoint: resolveOrgEmbeddingEndpoint(settings),
    embeddingModel: resolveOrgFeatureModel(settings, 'rag_embedding'),
    serverType: settings.local_server_type || 'ollama',
    featureKind,
    strictLocalOnly: settings.strict_local_only !== false,
    allowCloudFallback: settings.strict_local_only === false,
  };
}

/** Parse Ollama GET /api/tags JSON → model names (pure, testable). */
export function parseOllamaTagsResponse(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const models = (data as any).models;
  if (!Array.isArray(models)) return [];
  const names = models
    .map((m: any) => String(m?.name || m?.model || '').trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/** Parse OpenAI-compatible GET /v1/models JSON → model ids (pure, testable). */
export function parseOpenAiModelsResponse(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const list = (data as any).data;
  if (!Array.isArray(list)) return [];
  const names = list
    .map((m: any) => String(m?.id || m?.name || '').trim())
    .filter(Boolean);
  return [...new Set(names)];
}

export function filterKbArticlesForOrgReindex<
  T extends { id?: string; organizationId?: string | null; organization_id?: string | null },
>(articles: T[], organizationId: string): T[] {
  const orgId = String(organizationId || '').trim();
  if (!orgId) return [];
  return articles.filter((a) => {
    const rowOrg = String(a.organizationId ?? a.organization_id ?? '').trim();
    return rowOrg === orgId;
  });
}

export function embeddingRowsOwnedByOrg<
  T extends { organization_id?: string | null; organizationId?: string | null },
>(rows: T[], organizationId: string): T[] {
  const orgId = String(organizationId || '').trim();
  return rows.filter(
    (r) => String(r.organization_id ?? r.organizationId ?? '').trim() === orgId,
  );
}
