/**
 * engram — a plug-and-play associative memory layer for any AI agent.
 *
 * Public API surface. Import what you need:
 *   import { Engram } from "engram";
 */

export { Engram } from "./engram.js";
export type { IndexOptions } from "./engram.js";

// Types
export type {
  EngramOptions,
  MemoryInput,
  RecallOptions,
  RecallResult,
  RecallWeights,
  IndexResult,
  GraphExport,
  GraphNode,
  GraphEdgeView,
  RecallTraceResult,
  AssociativeTrace,
  TraceSeed,
  TraceActivation,
} from "./types.js";
export type {
  MemoryRecord,
  MemoryStore,
  StoreStats,
  Tier,
  ScoredId,
  MemoryEdge,
  EdgeType,
} from "./store/types.js";

// Storage
export { SqliteStore, toFtsQuery } from "./store/sqlite-store.js";

// Embeddings (pluggable)
export {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type EmbeddingConfig,
} from "./embeddings/provider.js";
export { HashingEmbeddingProvider } from "./embeddings/hashing.js";
export { OpenAIEmbeddingProvider, type OpenAIEmbeddingOptions } from "./embeddings/openai.js";

// Ingestion
export {
  ingestDirectory,
  ingestFile,
  walk,
  chunkContent,
  type IngestOptions,
  type ChunkStrategy,
} from "./ingest/markdown.js";

// Graph (Phase 2 — associative edges)
export {
  buildEdges,
  type EdgeBuildOptions,
  type SimilarEdgeOptions,
  type AboutEdgeOptions,
  type EdgeBuildResult,
} from "./graph/build.js";
export { extractEntities } from "./graph/entities.js";
export {
  buildLlmEdges,
  parseRelations,
  type LlmEdgeOptions,
  type LlmEdgeResult,
} from "./graph/llm-edges.js";

// Consolidation ("dreaming") — Phase 3
export {
  consolidate,
  reinforce,
  readmit,
  salience,
  DEFAULT_SALIENCE,
  type SalienceWeights,
  type ConsolidateOptions,
  type ConsolidateResult,
} from "./consolidation/consolidate.js";

// Retrieval
export { recall, DEFAULT_WEIGHTS } from "./retrieval/hybrid.js";
export { llmRerank, parseOrder } from "./retrieval/rerank.js";
export {
  spreadActivation,
  type SpreadOptions,
  type Activation,
  type ActivationProvenance,
} from "./retrieval/spreading.js";

// LLM (subscription CLIs — claude/codex — or any custom command)
export {
  createLLMProvider,
  type LLMProvider,
  type LLMConfig,
  type LLMCompleteOptions,
} from "./llm/provider.js";
export { ClaudeCliProvider, type ClaudeCliOptions } from "./llm/claude-cli.js";
export { CodexCliProvider, type CodexCliOptions } from "./llm/codex-cli.js";
export { CommandProvider, type CommandOptions } from "./llm/command.js";

// Config
export { loadConfig, type EngramFileConfig } from "./config.js";

// Utils that callers may reuse
export { cosine, l2normalize } from "./util/cosine.js";
export { parseFrontmatter, type Frontmatter } from "./util/frontmatter.js";
export { runCommand, runViaTmux } from "./util/exec.js";
