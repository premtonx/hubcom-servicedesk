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

export const LOCAL_AI_UNREACHABLE_ERROR = 'Lokale Mandanten-KI nicht erreichbar';
export const ORG_AI_DISABLED_ERROR = 'KI für diesen Mandanten ist deaktiviert';

export interface OrgAiSettings {
  ai_mode: OrgAiMode;
  local_llm_endpoint: string;
  local_llm_model: string;
  local_embedding_endpoint: string;
  local_embedding_model: string;
  /** Encrypted bearer/API key (storage only). */
  local_ai_api_key_enc: string | null;
  /** Default true when ai_mode === org_local_ai. */
  strict_local_only: boolean;
  /** Default false — exclusive org RAG (Part 1). */
  include_shared_kb_in_rag: boolean;
  /** Last saved embedding model id — UI hints reindex when changed. */
  last_embedding_model: string | null;
}

/** Public DTO — never includes raw or encrypted secrets. */
export interface OrgAiSettingsPublic {
  ai_mode: OrgAiMode;
  local_llm_endpoint: string;
  local_llm_model: string;
  local_embedding_endpoint: string;
  local_embedding_model: string;
  local_ai_api_key_set: boolean;
  strict_local_only: boolean;
  include_shared_kb_in_rag: boolean;
  last_embedding_model: string | null;
  needs_reindex: boolean;
}

export interface OrgAiSettingsUpdateInput {
  ai_mode?: OrgAiMode | string | null;
  local_llm_endpoint?: string | null;
  local_llm_model?: string | null;
  local_embedding_endpoint?: string | null;
  local_embedding_model?: string | null;
  /** Plaintext key to store; omit to keep; empty string clears. */
  local_ai_api_key?: string | null;
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

export function defaultOrgAiSettings(): OrgAiSettings {
  return {
    ai_mode: 'global_default',
    local_llm_endpoint: '',
    local_llm_model: 'llama3',
    local_embedding_endpoint: '',
    local_embedding_model: 'nomic-embed-text',
    local_ai_api_key_enc: null,
    strict_local_only: true,
    include_shared_kb_in_rag: false,
    last_embedding_model: null,
  };
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

  return {
    ai_mode,
    local_llm_endpoint: asTrimmed(
      nested.local_llm_endpoint ?? nested.localLlmEndpoint,
      500,
    ),
    local_llm_model:
      asTrimmed(nested.local_llm_model ?? nested.localLlmModel, 120) ||
      defaults.local_llm_model,
    local_embedding_endpoint: asTrimmed(
      nested.local_embedding_endpoint ?? nested.localEmbeddingEndpoint,
      500,
    ),
    local_embedding_model:
      asTrimmed(nested.local_embedding_model ?? nested.localEmbeddingModel, 120) ||
      defaults.local_embedding_model,
    local_ai_api_key_enc: enc,
    strict_local_only,
    include_shared_kb_in_rag,
    last_embedding_model:
      asTrimmed(nested.last_embedding_model ?? nested.lastEmbeddingModel, 120) || null,
  };
}

export function toPublicOrgAiSettings(settings: OrgAiSettings): OrgAiSettingsPublic {
  const embeddingModel = settings.local_embedding_model || 'nomic-embed-text';
  const needs_reindex =
    settings.ai_mode === 'org_local_ai' &&
    Boolean(settings.last_embedding_model) &&
    settings.last_embedding_model !== embeddingModel;

  return {
    ai_mode: settings.ai_mode,
    local_llm_endpoint: settings.local_llm_endpoint,
    local_llm_model: settings.local_llm_model,
    local_embedding_endpoint: settings.local_embedding_endpoint,
    local_embedding_model: embeddingModel,
    local_ai_api_key_set: Boolean(settings.local_ai_api_key_enc),
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
  if (input.strict_local_only !== undefined && input.strict_local_only !== null) {
    next.strict_local_only = Boolean(input.strict_local_only);
  } else if (next.ai_mode === 'org_local_ai' && input.ai_mode === 'org_local_ai') {
    // Switching into org_local_ai defaults strict_local_only true unless explicitly set.
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
      // mask → keep existing
    } else if (isEncryptedEmailSecret(plain)) {
      next.local_ai_api_key_enc = plain;
    } else {
      next.local_ai_api_key_enc = encryptEmailChannelSecret(plain.trim());
    }
  }

  return next;
}

/** Flatten OrgAiSettings into organizations.settings JSON (no nested wrapper required). */
export function orgAiSettingsToSettingsPatch(settings: OrgAiSettings): Record<string, unknown> {
  return {
    ai_mode: settings.ai_mode,
    local_llm_endpoint: settings.local_llm_endpoint,
    local_llm_model: settings.local_llm_model,
    local_embedding_endpoint: settings.local_embedding_endpoint,
    local_embedding_model: settings.local_embedding_model,
    local_ai_api_key_enc: settings.local_ai_api_key_enc,
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

/** Whether this org forces exclusive local AI (no cloud). */
export function isOrgStrictLocalAi(settings: OrgAiSettings): boolean {
  return settings.ai_mode === 'org_local_ai' && settings.strict_local_only !== false;
}

export function markEmbeddingModelSaved(settings: OrgAiSettings): OrgAiSettings {
  return {
    ...settings,
    last_embedding_model: settings.local_embedding_model || null,
  };
}

/**
 * Pure routing decision for tests — which endpoint class should handle a call.
 */
export function resolveOrgAiRouting(
  settings: OrgAiSettings,
):
  | { mode: 'disabled'; error: string }
  | { mode: 'global_default' }
  | {
      mode: 'org_local_ai';
      endpoint: string;
      model: string;
      embeddingEndpoint: string;
      embeddingModel: string;
      strictLocalOnly: boolean;
      allowCloudFallback: boolean;
    } {
  if (settings.ai_mode === 'disabled') {
    return { mode: 'disabled', error: ORG_AI_DISABLED_ERROR };
  }
  if (settings.ai_mode !== 'org_local_ai') {
    return { mode: 'global_default' };
  }
  const endpoint = resolveOrgLlmEndpoint(settings);
  return {
    mode: 'org_local_ai',
    endpoint,
    model: settings.local_llm_model || 'llama3',
    embeddingEndpoint: resolveOrgEmbeddingEndpoint(settings),
    embeddingModel: settings.local_embedding_model || 'nomic-embed-text',
    strictLocalOnly: settings.strict_local_only !== false,
    allowCloudFallback: settings.strict_local_only === false,
  };
}

/** Filter KB article ids that belong to organizationId (for org-only reindex). */
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

/** Embedding rows that must be purged before org reindex (same organization_id only). */
export function embeddingRowsOwnedByOrg<
  T extends { organization_id?: string | null; organizationId?: string | null },
>(rows: T[], organizationId: string): T[] {
  const orgId = String(organizationId || '').trim();
  return rows.filter(
    (r) => String(r.organization_id ?? r.organizationId ?? '').trim() === orgId,
  );
}
