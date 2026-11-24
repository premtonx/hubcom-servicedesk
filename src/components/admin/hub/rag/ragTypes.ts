export type ResolutionMode = 'extract' | 'ai_generated' | 'hybrid';

export interface RagStatus {
  success: boolean;
  tenantId: string;
  queueDepth: number;
  kb: {
    totalArticles: number;
    publishedArticles: number;
    indexedChunks: number;
    indexedArticles: number;
    missingIndexArticles: number;
  };
  tickets: {
    totalResolvedClosed: number;
    indexedChunks: number;
    indexedTickets: number;
    missingIndexTickets: number;
  };
  activeEmbeddingProvider: unknown;
  config: {
    resolutionMode: ResolutionMode;
    redactPii: boolean;
    chunkOverlapTokens: number;
    indexResolvedTickets?: boolean;
    indexNewKbArticles?: boolean;
    detectDuplicates?: boolean;
  };
  sampledMissingKb?: string[];
  sampledMissingTickets?: string[];
  embeddingError?: string | null;
  recentFailures?: Array<{ id: string; jobType: string; lastError: string | null; updatedAt: string }>;
}

export interface RagSearchHit {
  id?: string;
  sourceType?: string;
  sourceId?: string;
  title?: string;
  content?: string;
  chunkContent?: string;
  similarityScore?: number;
  hybridScore?: number;
  vectorDistance?: number;
  metadata?: Record<string, unknown>;
}

export interface IndexProgress {
  type: 'kb' | 'ticket';
  enqueued: number;
  completed: number;
  queueDepth: number;
  missing: number;
  message: string;
  error?: string | null;
}

export const EMBEDDING_UNREACHABLE_SUMMARY =
  'Embedding-Endpunkt nicht erreichbar. Bitte Modell-Server (Port 8080) oder API-Key prüfen.';

export function isEmbeddingUnreachableMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /unreachable|timeout|ECONNREFUSED|nicht erreichbar|port 8080|no embedding provider/i.test(
    message,
  );
}
