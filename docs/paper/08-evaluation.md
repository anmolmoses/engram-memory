# 8 · Evaluation

This is Phase 1, so evaluation is about **correctness and behaviour**, not a
leaderboard score. Three layers: unit tests, a worked end-to-end demo, and a
real-world index.

## 8.1 Test suite

`npm test` runs 17 tests (offline, via the hashing embedder + `:memory:` DBs):

- **frontmatter** — nested metadata, scalar coercion, quote stripping, no-frontmatter.
- **embeddings** — determinism, L2-normalisation, correct dim, and that
  token-overlapping texts score higher than unrelated ones.
- **store** — round-trip of content/metadata/embedding, FTS keyword hit, vector
  listing, `deleteBySourcePrefix` (incl. FTS rows), query sanitisation + stopword drop.
- **ingest** — chunking per strategy; frontmatter→1 memory vs plain log→paragraphs;
  tier mapping; distinct chunk ids.
- **engram (end-to-end)** — relevant memory ranks #1; directory index + recall
  surfaces the migration incident; tier filtering; importance boost lifts the
  higher-salience memory; **re-index is idempotent (no duplicates)**;
  `toContextBlock` formatting.

All 17 pass; the package typechecks under `strict` + `noUncheckedIndexedAccess`.

## 8.2 Worked demo (offline embedder)

`npx tsx examples/quickstart.ts` indexes the bundled `sample-memories/` (9 memories
across episodic/semantic/procedural tiers) and runs three **paraphrased** queries —
none of which share the answer's key noun:

| Query | Correct memory surfaced #1 | Trace |
|-------|----------------------------|-------|
| "why did production go down after a release?" | the deploy/migration rollback rule | `semantic #1 · lexical #1 · importance 0.90` |
| "how do I set up a new member with admin access?" | the create-member procedure | `semantic #1 · lexical #1 · importance 0.60` |
| "can I trust an agent that says it finished a task?" | the verify-agent-claims rule | top-1 |

The first query is the headline: the matching memory contains "migration",
"rollback", "deploy" — none of which appear in the query — yet it ranks #1 via
lexical overlap on "production"/"deploy" plus the salience nudge. **Recall that a
grep would miss.**

## 8.3 Real-world index

To validate "plug into any agent," engram was pointed at a real agent's memory
directory (17 markdown files: feedback memos, daily logs, therapy notes):

```
Indexed 38 memories from 17 files (15ms).
recall "bug triage stuck on a judgment call who should I message"
  → #1 feedback_dm-on-blocking-decisions.md   (the exactly-correct memory)
```

15 ms to index 38 memories; correct top-1 on a natural-language query. No
configuration, no keys.

## 8.4 Two bugs the evaluation caught (and the fixes)

Recorded because they are instructive:

1. **Stopwords diluted the lexical channel.** Conversational queries returned the
   wrong top-1 because filler words ("how", "the", "with") contributed to bm25 and
   high-importance memories then dominated. **Fix:** share the stopword-aware
   tokeniser between the embedder and the FTS query builder (§4.4). This flipped
   all three demo queries from wrong to correct.
2. **The salience boost was too strong.** A ±2× importance multiplier let a
   high-importance memory win unrelated queries. **Fix:** reduce it to a gentle
   ~±0.25 nudge (§6.3).

Both were found *because* every result carries a `why` trace — the explainability
feature paid for itself during development.

## 8.5 What is not yet measured

There is no recall@k benchmark against a labelled set (e.g. a LoCoMo-style eval)
yet. That is the first task of Phase 4 and the right way to tune the weights and
justify the move to real semantic embeddings quantitatively.
