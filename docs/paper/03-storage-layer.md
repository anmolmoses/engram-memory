# 3 · Storage Layer

**Code:** `src/store/types.ts` (contract), `src/store/sqlite-store.ts`
(implementation).

## 3.1 The contract

All persistence sits behind `MemoryStore`. The store is intentionally *dumb*: it
persists records and answers two primitive queries — lexical and "give me every
vector." All ranking lives in `retrieval/`. This separation is what makes the
backend swappable (SQLite now; Postgres+pgvector or Redis later) without touching
recall.

```ts
interface MemoryStore {
  upsert(rec); upsertMany(recs);
  getById(id); getByIds(ids);
  deleteBySourcePrefix(prefix);   // prune a file's memories on re-index
  clear();
  ftsSearch(query, limit): ScoredId[];                 // lexical primitive
  allVectors(): { id, embedding, dim }[];              // vector primitive
  count(); markUsed(ids); stats(); close();
}
```

## 3.2 Schema

One table is the source of truth; one virtual table is the lexical mirror.

```sql
CREATE TABLE memory (
  id            TEXT PRIMARY KEY,
  content       TEXT NOT NULL,
  source        TEXT,            -- relative file path (or null for add())
  tier          TEXT,            -- episodic | semantic | procedural | ...
  importance    REAL NOT NULL DEFAULT 0.5,   -- salience in [0,1]
  metadata      TEXT,            -- JSON
  content_hash  TEXT NOT NULL,   -- sha256, lets re-index skip unchanged rows
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_used_at  INTEGER,         -- recency (Phase 2+)
  use_count     INTEGER NOT NULL DEFAULT 0,  -- frequency (Phase 2+)
  embedding     BLOB,            -- little-endian Float32 array
  embedding_model TEXT,          -- which provider produced the vector
  embedding_dim INTEGER
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  id UNINDEXED, content, tokenize = 'porter unicode61'
);
```

Notes:

- **`last_used_at` / `use_count`** aren't used by Phase-1 ranking by default, but
  are populated by `markUsed` so Phase 2's recency/frequency signals have history
  to work with from day one.
- **`content_hash`** and **`embedding_model`** make the index self-describing: you
  can tell what changed and which model produced each vector.
- **`porter unicode61`** tokeniser gives Unicode-aware, stemmed matching ("migrate"
  ~ "migration").

## 3.3 Vectors as BLOBs (and why not sqlite-vec yet)

Embeddings are stored as raw little-endian Float32 blobs:

```ts
encode: Buffer.from(v.buffer, v.byteOffset, v.byteLength)
decode: new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
```

(The decode copies into a fresh 0-offset `ArrayBuffer` so `Float32Array` alignment
is always valid — a subtle correctness point with pooled Node Buffers.)

Phase-1 vector search **scans all vectors in JS** and computes cosine. At the scale
engram targets (thousands to low-tens-of-thousands of memories) this is sub-
millisecond and removes a fragile native dependency. A drop-in optimisation —
`sqlite-vec` for ANN search — fits behind the exact same `allVectors()` /
store interface when scale demands it. We chose **correctness and zero-friction
install over premature optimisation**.

## 3.4 FTS synchronisation

`memory_fts` is kept in sync manually inside `upsert` (delete + insert the row's
text) rather than via triggers. Explicit beats clever here: the sync is visible in
one place, and `deleteBySourcePrefix`/`clear` keep both tables consistent.

## 3.5 Pragmas

`journal_mode = WAL` and `synchronous = NORMAL` give good durability with
concurrent readers and fast writes — sensible defaults for a local agent memory.
For `:memory:` databases (tests, ephemeral use) these are no-ops.
