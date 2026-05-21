# engram — Design Paper

A research-paper-style record of *what* engram is, *why* each piece is built the
way it is, and *how* the pieces fit. Written to be read top-to-bottom, but each
section stands alone.

This documents **Phase 1**: hybrid recall over a SQLite-backed index. It is the
first stage of a larger human-inspired associative-memory design (graph recall and
"dreaming" consolidation come later — see §9).

## Table of contents

| # | Section | What it covers |
|---|---------|----------------|
| 0 | [Abstract](00-abstract.md) | One-page summary of the system and its claims |
| 1 | [Motivation & background](01-motivation-and-background.md) | The recall problem; prior art that shaped the design |
| 2 | [Architecture overview](02-architecture-overview.md) | Modules, data flow, the write/read paths |
| 3 | [Storage layer](03-storage-layer.md) | SQLite schema, FTS5, vectors-as-blobs, the store contract |
| 4 | [Embeddings](04-embeddings.md) | The provider interface; the offline hashing embedder; OpenAI |
| 5 | [Ingestion](05-ingestion.md) | Frontmatter parsing, chunking strategies, idempotent re-index |
| 6 | [Hybrid retrieval](06-hybrid-retrieval.md) | Two channels, RRF fusion, salience/recency, explainability |
| 7 | [API & CLI](07-api-and-cli.md) | The `Engram` surface and command-line tool |
| 8 | [Evaluation](08-evaluation.md) | Test strategy, worked recall results, real-world demo |
| 9 | [Limitations & roadmap](09-limitations-and-roadmap.md) | Honest limits and Phases 2–4 |

## Reading guide

- **Just want to use it?** Read the top-level [`README.md`](../../README.md).
- **Want to understand the design?** Start at §0 → §2 → §6.
- **Want to extend it?** §3 (new backend) and §4 (new embedder) define the two
  extension points.
