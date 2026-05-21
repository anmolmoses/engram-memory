# 6 · Hybrid Retrieval

**Code:** `src/retrieval/hybrid.ts`. This is the heart of Phase 1.

## 6.1 Two channels

A query runs through two independent retrievers:

1. **Semantic** — embed the query, take cosine similarity against every stored
   vector of matching dimensionality, rank best-first.
2. **Lexical** — FTS5/bm25 keyword search over the text mirror, best-first.

They are complementary. Lexical nails exact terms and rare tokens ("relevance_score",
"Venkatesh") with no model. Semantic catches paraphrase and word-overlap the keyword
index misses. Neither alone is enough; together they cover each other's blind spots.

## 6.2 Why Reciprocal Rank Fusion

The two channels produce **incomparable scores**: cosine is roughly [-1, 1] and
"higher is better"; bm25 is an unbounded relevance metric where "lower is better"
in SQLite's implementation. Normalising them onto a shared scale is fiddly and
brittle (min-max depends on the result set; z-scores assume distributions).

**Reciprocal Rank Fusion (RRF)** sidesteps this by fusing on *rank position*:

```
score(d) = Σ_channels  weight_channel × 1 / (rrfK + rank_channel(d))
```

with `rrfK = 60` by default. Properties that make it the right choice here:

- **Scale-free** — only ranks matter, so no normalisation step.
- **Robust** — a document strong in *both* channels accumulates contributions; a
  one-channel fluke is bounded by `1/(rrfK+0)`.
- **Tunable** — per-channel weights let you favour semantic or lexical without
  touching the fusion math.

This mirrors the "convergent evidence" intuition from associative memory: a memory
that lights up through multiple paths should rank above one reached by a single
weak path.

## 6.3 Salience and recency

After fusion, two optional adjustments shape the result, echoing the
recency/importance/relevance scoring of Generative Agents:

- **Salience (importance):** `score ×= 1 + w.importance × (importance − 0.5)`.
  Importance 0.5 is neutral; the multiplier stays within ~[0.75, 1.25] at the
  default weight. It is **deliberately gentle** — a tie-breaker and close-call
  tilt, not an override of clear relevance. (An earlier ±2× version wrongly let a
  high-importance memory win unrelated queries; §8 records the fix.)
- **Recency (off by default):** when enabled, `score ×= 1 + w.recency × 2^(−ageDays/halfLife)`,
  using `last_used_at` (or `created_at`). Off by default because recency only
  becomes meaningful once memories are actively used; it is central in Phase 2+.

## 6.4 Explainability

Every `RecallResult` carries:

- `score` — the final fused/boosted number,
- `scores` — the raw `{ semantic, lexical, rrf }` components,
- `ranks` — the per-channel rank positions,
- `why` — a human string, e.g. `"semantic #1 (0.21) · lexical #1 · importance 0.90"`.

This makes recall **auditable**: you can always answer "why did this memory
surface?" — something a single opaque similarity score cannot provide. It is also
how we debugged the stopword and salience issues (§4.4, §8).

## 6.5 Complexity

Phase-1 semantic search is a linear scan over stored vectors (O(N · dim)); lexical
search is FTS5's indexed lookup. At engram's target scale this is sub-millisecond.
The `candidatePool` option bounds how many candidates each channel contributes
before fusion (default 50), keeping fusion and materialisation cheap regardless of
corpus size. ANN indexing (sqlite-vec) is the scale-out path and slots in behind
the store interface (§3.3).
