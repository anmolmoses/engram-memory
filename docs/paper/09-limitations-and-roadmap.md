# 9 · Limitations & Roadmap

## 9.1 Honest limitations of Phase 1

- **The default embedder is lexical-ish, not semantic.** Feature hashing has no
  learned meaning; true paraphrase recall ("dentist" ~ "tooth pain") needs a real
  model (one-line swap to OpenAI or a local model). The default optimises for
  zero-friction, offline operation.
- **Vector search is a linear scan.** Fine to tens of thousands of memories;
  beyond that, plug in `sqlite-vec`/ANN behind the store interface.
- **No graph, no associations.** Memories are independent records. There are no
  causal/temporal/entity edges and no spreading-activation recall yet — the
  signature feature of the larger design.
- **No consolidation or forgetting.** Memory grows monotonically; nothing decays,
  gets promoted, or is pruned. There is no short-term/long-term distinction at
  runtime.
- **Importance is supplied, not inferred.** It comes from frontmatter or the
  caller; engram does not yet rate salience automatically.
- **Chunking is structural, not semantic.** Splitting is by blank lines/headings,
  not by meaning.
- **Single-node storage.** One SQLite file; no multi-tenant or networked backend
  (though the interface allows one).

None of these are hidden — they are the explicit boundary of Phase 1, which is the
*recall* layer.

## 9.2 Roadmap

The phases map onto the human-inspired design the project set out to build.

### Phase 2 — Associative graph
Add typed, weighted edges between memories: `caused`, `temporal_next`, `about`
(shared entity), `similar`, `supersedes`, `lesson_from`. Replace/augment top-k
similarity with **spreading activation / Personalized PageRank**: inject activation
at the query's seed memories and let it cascade along edges, so "dentist" lights up
the related lesson even with no direct similarity. Entity extraction populates an
inverted index ("glossary") for precise seeding. This is where recall becomes
genuinely *associative*.

### Phase 3 — "Dreaming" (consolidation + forgetting)
Treat the day's memories as a **bounded short-term cache** with salience-weighted
eviction (recency + frequency + importance — not plain LRU). A nightly idle-time
job "dreams": replays and re-scores the day, extracts general lessons (reflection),
promotes the salient few to long-term, strengthens co-activated edges (Hebbian),
and **garbage-collects** the rest to cold archive (never hard-deleted —
re-admittable on a later hit). This gives engram a true short-term/long-term split
and keeps the hot index small and sharp.

### Phase 4 — Reinforcement & evaluation
- recall@k benchmark on a labelled, LoCoMo-style set built from real threads;
- weight tuning against that benchmark;
- Hebbian edge reinforcement on co-retrieval;
- automatic importance/surprise inference (e.g. Bayesian surprise);
- a "why retrieved" audit view over time.

### Smaller near-term improvements
- incremental indexing (skip files whose `content_hash` is unchanged);
- `sqlite-vec` ANN backend;
- semantic chunking;
- a local-model embedding provider shipped in the box.

## 9.3 Stable foundations for all of the above

Phase 1 was built so the later phases don't require a rewrite:

- `MemoryStore` and `EmbeddingProvider` interfaces isolate the two things most
  likely to change.
- `last_used_at` / `use_count` columns already capture the recency/frequency
  signals Phase 2–3 need.
- The five-term scoring shape (semantic, lexical, importance, recency, + future
  activation) is already in place; Phase 2 adds the activation term, Phase 3 turns
  on recency and consolidation.
- Explainable results make each new signal debuggable as it lands.
