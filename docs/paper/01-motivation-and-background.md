# 1 · Motivation & Background

## 1.1 The problem: recall, not storage

Most agent "memory" today is a log: append a line per event, per day, per session.
Writing is trivial. **Recall is the hard part.** When an agent later faces a
situation it has seen before, it needs the relevant past memory to surface — but a
flat log offers no way to find it except reading everything. As the log grows, that
goes from cheap to impossible.

Concretely, the failure looks like this: an agent wrote, weeks ago, "the deploy
broke prod because it raced ahead of the DB migration." Today it is about to deploy
again. The log *contains* the lesson, but nothing brings it forward unless someone
already knows where to look. The memory is stored but not *recallable*.

engram targets exactly this gap. It does not replace the log — it indexes it and
adds a ranked, associative retrieval path on top.

## 1.2 Design principles

These principles, in priority order, drove every decision:

1. **Plug and play.** Any agent should adopt it in minutes, with no infrastructure
   to stand up and no keys to provision for a basic run.
2. **Files stay the source of truth.** The human-readable markdown remains
   canonical; the index is a derived cache. This keeps memory inspectable, diffable
   in git, and disposable.
3. **Recall must be explainable.** A black-box "here are some memories" is hard to
   trust. Every result should say *why* it was retrieved.
4. **Swappable internals.** The storage engine and the embedding model are the two
   things teams will want to change. Both sit behind interfaces.
5. **Honest about limits.** A zero-dependency default that is "lexical-ish" is
   stated as such, with a clear upgrade path — rather than overclaiming semantic
   magic.

## 1.3 Prior art that shaped the design

engram is an engineering synthesis of well-established ideas:

- **Generative Agents** (Park et al., 2023) retrieve memories by a weighted sum of
  **recency, importance, and relevance**. engram's scoring is a direct descendant:
  relevance (semantic + lexical), an importance nudge, and an optional recency term.
- **Hybrid retrieval** (vector + keyword), now standard in production memory layers
  such as **Mem0** and **Zep**, consistently beats either channel alone. engram
  uses both and fuses them.
- **Reciprocal Rank Fusion** (Cormack et al., 2009) is a simple, strong way to
  combine ranked lists from incomparable scorers — exactly our situation (cosine vs
  bm25).
- **The hippocampal-indexing view of memory** (and systems inspired by it, e.g.
  HippoRAG) motivates the larger roadmap: an associative graph with
  spreading-activation recall (Phase 2).
- **Sleep-consolidation models** of memory motivate Phase 3 "dreaming": replay,
  promote the salient, forget the rest.

The companion research brief (in the originating project) surveys this literature
in depth; this paper focuses on what Phase 1 actually builds.

## 1.4 What Phase 1 deliberately excludes

To ship a solid, testable core, Phase 1 leaves out (by design, not omission):

- the **associative graph** and graph-traversal recall,
- **consolidation / forgetting** (the "dreaming" job),
- automatic **importance inference** (importance is taken from frontmatter or the
  caller; auto-rating is future work),
- multi-tenant / networked storage (single-file SQLite is the Phase-1 backend).

These are the subject of §9 and the project roadmap.
