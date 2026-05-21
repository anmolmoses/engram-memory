import { SqliteStore } from "./store/sqlite-store.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings/provider.js";
import { createLLMProvider, type LLMProvider } from "./llm/provider.js";
import { ingestDirectory, type IngestOptions } from "./ingest/markdown.js";
import { recall as hybridRecall, DEFAULT_WEIGHTS } from "./retrieval/hybrid.js";
import { llmRerank } from "./retrieval/rerank.js";
import { sha256 } from "./util/hash.js";
import type { MemoryRecord, MemoryStore, StoreStats } from "./store/types.js";
import type {
  EngramOptions,
  IndexResult,
  MemoryInput,
  RecallOptions,
  RecallResult,
  RecallWeights,
} from "./types.js";

/** Accepts 0..1 directly, or a 1..10 salience scale (auto-divided by 10). */
function normalizeImportance(v?: number): number {
  if (v === undefined || Number.isNaN(v)) return 0.5;
  const x = v > 1 ? v / 10 : v;
  return Math.min(1, Math.max(0, x));
}

export interface IndexOptions extends IngestOptions {
  /** Re-ingested files have their old memories removed first (default true). */
  prune?: boolean;
  /** Wipe the whole index before indexing — a clean full rebuild (default false). */
  fresh?: boolean;
}

/**
 * Engram — the public memory engine.
 *
 * One object wires a storage backend + an embedding provider + ingestion +
 * hybrid retrieval. The markdown files (or any text you `add`) remain the
 * source of truth; the SQLite index is a derived, rebuildable cache.
 *
 * @example
 * const mem = new Engram({ dbPath: "agent.db" });
 * await mem.indexDirectory("./memories");
 * const hits = await mem.recall("what went wrong last deploy?", { k: 5 });
 * const context = mem.toContextBlock(hits); // inject into your prompt
 */
export class Engram {
  readonly store: MemoryStore;
  readonly embedding: EmbeddingProvider;
  /** The configured LLM (subscription CLI), or null for pure hybrid search. */
  readonly llm: LLMProvider | null;
  private readonly defaultK: number;
  private readonly weights: RecallWeights;

  constructor(opts: EngramOptions = {}) {
    this.store = new SqliteStore(opts.dbPath ?? "engram.db");
    this.embedding = createEmbeddingProvider(opts.embedding);
    this.llm = createLLMProvider(opts.llm);
    this.defaultK = opts.defaultK ?? 8;
    this.weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  }

  /** Store one memory. Returns its id (stable hash of content if not provided). */
  async add(input: MemoryInput): Promise<string> {
    const recs = await this.toRecords([input]);
    const rec = recs[0]!;
    this.store.upsert(rec);
    return rec.id;
  }

  /** Store many memories in a single transaction. */
  async addMany(inputs: MemoryInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const recs = await this.toRecords(inputs);
    this.store.upsertMany(recs);
    return recs.map((r) => r.id);
  }

  private async toRecords(inputs: MemoryInput[]): Promise<MemoryRecord[]> {
    const now = Date.now();
    const embeddings = await this.embedding.embed(inputs.map((i) => i.content));
    return inputs.map((input, idx) => {
      const emb = embeddings[idx] ?? null;
      return {
        id: input.id ?? sha256(input.content).slice(0, 16),
        content: input.content,
        source: input.source ?? null,
        tier: input.tier ?? null,
        importance: normalizeImportance(input.importance),
        metadata: input.metadata ?? null,
        contentHash: sha256(input.content),
        createdAt: input.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: null,
        useCount: 0,
        embedding: emb,
        embeddingModel: this.embedding.name,
        embeddingDim: emb ? emb.length : null,
      } satisfies MemoryRecord;
    });
  }

  /**
   * Index a directory of markdown/text files into memories. Non-destructive to
   * the files themselves — the DB is a derived cache that can be rebuilt anytime.
   */
  async indexDirectory(dir: string, opts: IndexOptions = {}): Promise<IndexResult> {
    const start = Date.now();
    if (opts.fresh) this.store.clear();
    const inputs = ingestDirectory(dir, opts);
    const sources = new Set(inputs.map((i) => i.source).filter((s): s is string => !!s));
    let pruned = 0;
    if (opts.prune !== false && !opts.fresh) {
      for (const src of sources) pruned += this.store.deleteBySourcePrefix(src);
    }
    await this.addMany(inputs);
    return {
      directory: dir,
      files: sources.size,
      memories: inputs.length,
      pruned,
      durationMs: Date.now() - start,
      embeddingModel: this.embedding.name,
    };
  }

  /**
   * Recall the top-k most relevant memories for a query (hybrid search).
   * With `{ rerank: true }` and an LLM configured, hybrid produces a larger
   * candidate pool that the LLM (your subscription) then reorders by reading the
   * actual text — higher quality, at the cost of one LLM call.
   */
  async recall(query: string, opts: RecallOptions = {}): Promise<RecallResult[]> {
    const k = opts.k ?? this.defaultK;
    const doRerank = Boolean(opts.rerank) && this.llm !== null;

    if (!doRerank) {
      return hybridRecall(this.store, this.embedding, query, { k, ...opts }, this.weights);
    }

    const pool = opts.rerankPool ?? Math.max(k * 4, 20);
    const candidates = await hybridRecall(
      this.store,
      this.embedding,
      query,
      { ...opts, k: pool, markUsed: false },
      this.weights,
    );
    const ranked = await llmRerank(this.llm!, query, candidates, k);
    if (opts.markUsed) this.store.markUsed(ranked.map((r) => r.id));
    return ranked;
  }

  /**
   * Rate a memory's long-term importance (0..1) using the configured LLM.
   * Returns 0.5 (neutral) if no LLM is set or the call fails. Opt-in helper for
   * auto-scoring salience at write time.
   */
  async rateImportance(text: string): Promise<number> {
    if (!this.llm) return 0.5;
    const prompt =
      `Rate how important this memory is for an agent to remember long-term, ` +
      `on a scale of 1 (trivial) to 10 (critical). Consider consequence, ` +
      `surprise, and reusability. Reply with ONLY the number.\n\nMemory: ${text}`;
    try {
      const resp = await this.llm.complete(prompt);
      const m = resp.match(/\d+(\.\d+)?/);
      if (!m) return 0.5;
      const n = Number.parseFloat(m[0]);
      return Math.min(1, Math.max(0, n > 1 ? n / 10 : n));
    } catch {
      return 0.5;
    }
  }

  /** Format recall results as a prompt-ready context block for any agent. */
  toContextBlock(results: RecallResult[], opts: { header?: string; withSource?: boolean } = {}): string {
    if (results.length === 0) return "";
    const header = opts.header ?? "Relevant memories (most relevant first):";
    const withSource = opts.withSource ?? true;
    const lines = results.map((r, i) => {
      const src = withSource && r.source ? `  (source: ${r.source})` : "";
      return `${i + 1}. ${r.content}${src}`;
    });
    return `${header}\n${lines.join("\n")}`;
  }

  /** Bump recency/frequency counters (used by future consolidation phases). */
  markUsed(ids: string[]): void {
    this.store.markUsed(ids);
  }

  stats(): StoreStats {
    return this.store.stats();
  }

  close(): void {
    this.store.close();
  }
}
