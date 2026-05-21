# 0 · Abstract

**engram** is a portable memory layer that gives any AI agent fast, ranked,
explainable recall over its own accumulated notes. It is designed to be *plug and
play*: a single `Engram` object, one runtime dependency, no external services, and
no API keys required to run.

The core problem it solves is **recall, not storage**. Agents readily append to a
log of what happened; they struggle to retrieve the right past memory at the right
moment. A flat daily log is write-optimised and read-hostile — finding a relevant
prior experience degrades to scanning every entry. engram turns recall into a
ranked query.

**Approach (Phase 1).** Memories — parsed from markdown files or added
programmatically — are stored in a single SQLite database. Each memory's text is
mirrored into an FTS5 full-text index, and its embedding is stored as a Float32
blob. Retrieval runs two channels in parallel — **semantic** (cosine similarity of
embeddings) and **lexical** (FTS5/bm25 keyword search) — and fuses them with
**Reciprocal Rank Fusion (RRF)**, then applies a gentle **salience (importance)**
nudge and an optional **recency** boost. Each result carries a human-readable
explanation of why it surfaced.

**Key design decisions.**

1. *The files are the source of truth; the database is a derived, rebuildable
   cache.* This preserves human-readability, git history, and auditability, and
   makes the index disposable.
2. *Default to zero dependencies for intelligence.* The bundled embedder is a
   deterministic feature-hashing function — offline, no model, no key — so the
   system runs anywhere out of the box. True semantic embeddings are a one-line
   upgrade through a provider interface.
3. *Fuse by rank, not score.* Cosine and bm25 are not comparable on the same axis;
   RRF combines them by rank position, which is robust and parameter-light.
4. *Swappable everywhere it matters.* Storage sits behind a `MemoryStore` contract
   and embeddings behind an `EmbeddingProvider` contract, so the database and the
   model can each be replaced without touching recall logic.

**Result.** On both bundled samples and a real agent's memory directory, engram
recalls the correct memory for paraphrased queries (e.g. "why did production go
down after a release?" → the migration-ordering incident) that a keyword grep would
miss, in milliseconds, with an audit trace for every hit.

**Scope.** This is Phase 1 of a human-inspired design. The associative graph
(typed edges + spreading-activation recall) and the "dreaming" consolidation layer
(bounded short-term cache + nightly promotion/forgetting) are future phases (§9).
