import Database from "better-sqlite3";
import { meaningfulTokens } from "../util/text.js";
import type { MemoryRecord, MemoryStore, ScoredId, StoreStats } from "./types.js";

/**
 * SQLite-backed store. One file = the whole memory index.
 *
 * Design notes:
 *  - `memory` is the source of truth for records + embeddings (stored as BLOBs).
 *  - `memory_fts` is an FTS5 mirror of `content`, kept in sync inside `upsert`.
 *  - Embeddings live as little-endian Float32 BLOBs. At Phase-1 scale (thousands
 *    of rows) we scan them in JS for cosine similarity; swapping in sqlite-vec is
 *    a drop-in optimisation behind this same interface (see docs/paper/05).
 */

// --- Float32Array <-> BLOB helpers -----------------------------------------

function encodeVec(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function decodeVec(b: Buffer): Float32Array {
  // Copy into a fresh, 0-offset ArrayBuffer so Float32Array alignment is safe.
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Float32Array(ab);
}

/**
 * Build a safe FTS5 MATCH expression from free-form text. Stopwords are dropped
 * (same tokeniser as the embedder) so bm25 ranks on content-bearing terms.
 * Returns null when nothing meaningful remains.
 */
export function toFtsQuery(query: string): string | null {
  const unique = [...new Set(meaningfulTokens(query))];
  if (unique.length === 0) return null;
  // Quote each term to neutralise FTS operators, OR them together.
  return unique.map((t) => `"${t}"`).join(" OR ");
}

interface MemoryRow {
  id: string;
  content: string;
  source: string | null;
  tier: string | null;
  importance: number;
  metadata: string | null;
  content_hash: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
  use_count: number;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_dim: number | null;
}

function rowToRecord(r: MemoryRow): MemoryRecord {
  return {
    id: r.id,
    content: r.content,
    source: r.source,
    tier: r.tier,
    importance: r.importance,
    metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : null,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
    useCount: r.use_count,
    embedding: r.embedding ? decodeVec(r.embedding) : null,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
  };
}

export class SqliteStore implements MemoryStore {
  readonly db: Database.Database;
  readonly dbPath: string;

  constructor(dbPath = "engram.db") {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id            TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        source        TEXT,
        tier          TEXT,
        importance    REAL NOT NULL DEFAULT 0.5,
        metadata      TEXT,
        content_hash  TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        last_used_at  INTEGER,
        use_count     INTEGER NOT NULL DEFAULT 0,
        embedding     BLOB,
        embedding_model TEXT,
        embedding_dim INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memory_source ON memory(source);
      CREATE INDEX IF NOT EXISTS idx_memory_tier ON memory(tier);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        content,
        tokenize = 'porter unicode61'
      );
    `);
  }

  upsert(rec: MemoryRecord): void {
    const insertMem = this.db.prepare(`
      INSERT INTO memory (id, content, source, tier, importance, metadata, content_hash,
                          created_at, updated_at, last_used_at, use_count,
                          embedding, embedding_model, embedding_dim)
      VALUES (@id, @content, @source, @tier, @importance, @metadata, @content_hash,
              @created_at, @updated_at, @last_used_at, @use_count,
              @embedding, @embedding_model, @embedding_dim)
      ON CONFLICT(id) DO UPDATE SET
        content=excluded.content, source=excluded.source, tier=excluded.tier,
        importance=excluded.importance, metadata=excluded.metadata,
        content_hash=excluded.content_hash, updated_at=excluded.updated_at,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model,
        embedding_dim=excluded.embedding_dim
    `);
    insertMem.run({
      id: rec.id,
      content: rec.content,
      source: rec.source,
      tier: rec.tier,
      importance: rec.importance,
      metadata: rec.metadata ? JSON.stringify(rec.metadata) : null,
      content_hash: rec.contentHash,
      created_at: rec.createdAt,
      updated_at: rec.updatedAt,
      last_used_at: rec.lastUsedAt,
      use_count: rec.useCount,
      embedding: rec.embedding ? encodeVec(rec.embedding) : null,
      embedding_model: rec.embeddingModel,
      embedding_dim: rec.embeddingDim,
    });
    // keep FTS mirror in sync
    this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(rec.id);
    this.db.prepare(`INSERT INTO memory_fts (id, content) VALUES (?, ?)`).run(rec.id, rec.content);
  }

  upsertMany(recs: MemoryRecord[]): void {
    const tx = this.db.transaction((rows: MemoryRecord[]) => {
      for (const r of rows) this.upsert(r);
    });
    tx(recs);
  }

  getById(id: string): MemoryRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM memory WHERE id = ?`).get(id) as MemoryRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  getByIds(ids: string[]): MemoryRecord[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM memory WHERE id IN (${placeholders})`)
      .all(...ids) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  deleteBySourcePrefix(prefix: string): number {
    const ids = this.db
      .prepare(`SELECT id FROM memory WHERE source = ? OR source LIKE ?`)
      .all(prefix, `${prefix}%`) as Array<{ id: string }>;
    const tx = this.db.transaction((rows: Array<{ id: string }>) => {
      for (const { id } of rows) {
        this.db.prepare(`DELETE FROM memory WHERE id = ?`).run(id);
        this.db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id);
      }
    });
    tx(ids);
    return ids.length;
  }

  clear(): void {
    this.db.exec(`DELETE FROM memory; DELETE FROM memory_fts;`);
  }

  ftsSearch(query: string, limit: number): ScoredId[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT id, bm25(memory_fts) AS score
         FROM memory_fts WHERE memory_fts MATCH ?
         ORDER BY score ASC LIMIT ?`,
      )
      .all(match, limit) as Array<{ id: string; score: number }>;
    return rows.map((r) => ({ id: r.id, score: r.score }));
  }

  allVectors(): Array<{ id: string; embedding: Float32Array; dim: number }> {
    const rows = this.db
      .prepare(`SELECT id, embedding, embedding_dim FROM memory WHERE embedding IS NOT NULL`)
      .all() as Array<{ id: string; embedding: Buffer; embedding_dim: number }>;
    return rows.map((r) => ({ id: r.id, embedding: decodeVec(r.embedding), dim: r.embedding_dim }));
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM memory`).get() as { n: number }).n;
  }

  markUsed(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const stmt = this.db.prepare(
      `UPDATE memory SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?`,
    );
    const tx = this.db.transaction((rows: string[]) => {
      for (const id of rows) stmt.run(now, id);
    });
    tx(ids);
  }

  stats(): StoreStats {
    const count = this.count();
    const withEmbedding = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM memory WHERE embedding IS NOT NULL`).get() as {
        n: number;
      }
    ).n;
    const sources = (
      this.db.prepare(`SELECT COUNT(DISTINCT source) AS n FROM memory WHERE source IS NOT NULL`).get() as {
        n: number;
      }
    ).n;
    const tierRows = this.db
      .prepare(`SELECT COALESCE(tier,'(none)') AS tier, COUNT(*) AS n FROM memory GROUP BY tier`)
      .all() as Array<{ tier: string; n: number }>;
    const tiers: Record<string, number> = {};
    for (const t of tierRows) tiers[t.tier] = t.n;
    return { count, withEmbedding, tiers, sources, dbPath: this.dbPath };
  }

  close(): void {
    this.db.close();
  }
}
