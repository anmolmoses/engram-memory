/**
 * Storage-layer types and the MemoryStore contract.
 *
 * The store is deliberately dumb: it persists records and answers two kinds of
 * primitive queries — lexical (FTS5) and "give me every vector". All ranking
 * and fusion lives one layer up in `retrieval/`. This keeps the store swappable
 * (SQLite today, Postgres/Redis tomorrow) without touching recall logic.
 */

export type Tier = "episodic" | "semantic" | "procedural" | "working" | (string & {});

/** A fully-materialised memory as it lives in storage. */
export interface MemoryRecord {
  id: string;
  content: string;
  source: string | null;
  tier: Tier | null;
  /** Salience in [0,1]. Drives optional ranking boosts now; central in Phase 2+. */
  importance: number;
  metadata: Record<string, unknown> | null;
  /** sha256 of `content`; lets re-indexing skip unchanged rows. */
  contentHash: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  embedding: Float32Array | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
}

/** A single lexical (FTS) or vector hit. Lower-is-better for bm25; cosine is 0..1. */
export interface ScoredId {
  id: string;
  score: number;
}

export interface StoreStats {
  count: number;
  withEmbedding: number;
  tiers: Record<string, number>;
  sources: number;
  dbPath: string;
}

/**
 * The backend contract. Implement this to put engram on a different database.
 * Methods are synchronous because SQLite (better-sqlite3) is synchronous; an
 * async backend can wrap these in promises behind the same shape.
 */
export interface MemoryStore {
  upsert(rec: MemoryRecord): void;
  upsertMany(recs: MemoryRecord[]): void;
  getById(id: string): MemoryRecord | undefined;
  getByIds(ids: string[]): MemoryRecord[];
  /** Remove every memory whose `source` starts with `prefix`. Returns rows deleted. */
  deleteBySourcePrefix(prefix: string): number;
  clear(): void;
  /** Lexical search via FTS5/bm25. Returns ids best-first. */
  ftsSearch(query: string, limit: number): ScoredId[];
  /** Every stored embedding. Phase-1 vector search scans these in JS. */
  allVectors(): Array<{ id: string; embedding: Float32Array; dim: number }>;
  count(): number;
  /** Bump recency/frequency counters for the given ids. */
  markUsed(ids: string[]): void;
  stats(): StoreStats;
  close(): void;
}
