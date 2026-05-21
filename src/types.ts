import type { EmbeddingConfig } from "./embeddings/provider.js";
import type { LLMConfig } from "./llm/provider.js";

/** A memory to be stored. Only `content` is required. */
export interface MemoryInput {
  id?: string;
  content: string;
  source?: string | null;
  tier?: string | null;
  /** Salience. Accepts 0..1 or 1..10 (auto-normalised). Defaults to 0.5. */
  importance?: number;
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
}

/** How the five recall signals are weighted when fusing results. */
export interface RecallWeights {
  /** Weight on the semantic (vector) channel in RRF. */
  semantic: number;
  /** Weight on the lexical (FTS5/bm25) channel in RRF. */
  lexical: number;
  /** Strength of the salience (importance) boost. 0 disables it. */
  importance: number;
  /** Strength of the recency boost. 0 disables it (default). */
  recency: number;
  /** Reciprocal-Rank-Fusion constant. Larger = flatter rank influence. */
  rrfK: number;
  /** Half-life in days for the recency boost. */
  recencyHalfLifeDays: number;
}

export interface EngramOptions {
  /** SQLite file path, or ":memory:" for an ephemeral index. */
  dbPath?: string;
  /** Embedding provider or config. Defaults to the offline hashing provider. */
  embedding?: EmbeddingConfig;
  /**
   * Optional LLM (subscription CLI: claude/codex, or custom) used for reranking
   * and importance scoring. Omit to run in pure hybrid-search mode.
   */
  llm?: LLMConfig;
  defaultK?: number;
  weights?: Partial<RecallWeights>;
}

export interface RecallOptions {
  k?: number;
  weights?: Partial<RecallWeights>;
  /** Restrict to a single tier (episodic/semantic/procedural/...). */
  tier?: string;
  /** Bump recency/use-count counters on the returned memories (default false). */
  markUsed?: boolean;
  /** Candidates pulled from each channel before fusion (default 50). */
  candidatePool?: number;
  /** Rerank hybrid candidates with the configured LLM. No-op if no LLM is set. */
  rerank?: boolean;
  /** How many hybrid candidates to hand the reranker (default max(k*4, 20)). */
  rerankPool?: number;
}

export interface RecallResult {
  id: string;
  content: string;
  source: string | null;
  tier: string | null;
  importance: number;
  /** Final fused score (higher = better). */
  score: number;
  scores: { semantic?: number; lexical?: number; rrf: number };
  ranks: { semantic?: number; lexical?: number };
  metadata: Record<string, unknown> | null;
  /** Human-readable explanation of why this memory surfaced (the "audit" trace). */
  why: string;
}

export interface IndexResult {
  directory: string;
  files: number;
  memories: number;
  pruned: number;
  durationMs: number;
  embeddingModel: string;
}
