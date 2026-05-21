# 2 · Architecture Overview

## 2.1 Modules

engram is four small layers behind one façade:

```
                         ┌─────────────────────────┐
                         │        Engram           │  src/engram.ts
                         │  (public orchestrator)  │
                         └───────────┬─────────────┘
            ┌────────────────┬───────┴───────┬──────────────────┐
            ▼                ▼               ▼                  ▼
     ┌────────────┐  ┌──────────────┐ ┌─────────────┐  ┌───────────────┐
     │  ingest/   │  │ embeddings/  │ │ retrieval/  │  │    store/     │
     │  markdown  │  │  provider    │ │   hybrid    │  │  SqliteStore  │
     └────────────┘  └──────────────┘ └─────────────┘  └───────────────┘
       frontmatter      hashing /        RRF fusion        SQLite +
       + chunking        openai          + scoring         FTS5 + blobs
```

- **`store/`** — persistence. `MemoryStore` is the contract; `SqliteStore` is the
  implementation. Knows nothing about ranking.
- **`embeddings/`** — turns text into vectors. `EmbeddingProvider` is the contract;
  `HashingEmbeddingProvider` (default, offline) and `OpenAIEmbeddingProvider` ship.
- **`ingest/`** — turns files into memories (frontmatter, chunking, ids).
- **`retrieval/`** — the recall algorithm: two channels fused, then scored.
- **`Engram`** — wires the above together and exposes the public API.

The two extension points are `MemoryStore` (swap the database) and
`EmbeddingProvider` (swap the model). Everything else can stay put.

## 2.2 The write path

`indexDirectory(dir)` or `add(memory)`:

1. **Ingest** (directory case): walk files → parse frontmatter → chunk into
   memory-sized units → produce `MemoryInput[]`.
2. **Normalise**: assign a stable id (provided, frontmatter `name`, or content
   hash), clamp `importance` to [0,1], stamp timestamps, compute a content hash.
3. **Embed**: the provider turns each memory's text into a Float32 vector.
4. **Persist**: upsert into the `memory` table; mirror the text into `memory_fts`.

Re-indexing is **idempotent**: existing memories from a re-ingested file are pruned
first, so content edits and chunk-count changes never leave orphans.

## 2.3 The read path

`recall(query)`:

1. **Embed the query** with the same provider.
2. **Semantic channel**: cosine of the query vector against every stored vector
   (of matching dimensionality), ranked best-first.
3. **Lexical channel**: FTS5/bm25 keyword search over `memory_fts`, best-first.
4. **Fuse**: Reciprocal Rank Fusion combines the two ranked lists.
5. **Score**: multiply the fused score by a salience (importance) nudge and an
   optional recency term.
6. **Return** the top-k with a `why` trace; optionally bump usage counters.

## 2.4 Why this shape

- **Files canonical, DB derived.** The DB is never the only copy of anything; it
  can be deleted and rebuilt from the files. This is the safest possible failure
  mode and keeps memory human-auditable.
- **Synchronous storage, async façade.** `better-sqlite3` is synchronous (simpler,
  faster for this workload); `Engram` methods are `async` because embedding
  providers may be network-bound. The seam is clean.
- **Stateless retrieval.** Recall reads; it only writes if you opt into
  `markUsed`. This keeps queries cheap and reproducible.
