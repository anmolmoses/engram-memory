# 7 · API & CLI

**Code:** `src/engram.ts` (API), `src/cli.ts` (CLI), `src/index.ts` (exports).

## 7.1 The `Engram` class

One object is the entire public surface.

```ts
const mem = new Engram({
  dbPath: "agent.db",                    // ":memory:" for ephemeral
  embedding: { provider: "hashing" },    // or "openai", or a custom provider
  defaultK: 8,
  weights: { semantic: 1, lexical: 1, importance: 0.5, recency: 0 },
});

await mem.add({ content, tier?, importance?, source?, metadata?, id? }): Promise<string>;
await mem.addMany(inputs): Promise<string[]>;
await mem.indexDirectory(dir, { chunk?, fresh?, prune? }): Promise<IndexResult>;
await mem.recall(query, { k?, tier?, weights?, markUsed?, candidatePool? }): Promise<RecallResult[]>;
mem.toContextBlock(results, { header?, withSource? }): string;
mem.markUsed(ids); mem.stats(); mem.close();
```

Design choices:

- **`importance` accepts 0..1 or 1..10.** Values > 1 are divided by 10. (Exactly
  `1` is treated as max on the 0..1 scale — to express low salience on a 1..10
  scale, use `2`.) This is the one ergonomic ambiguity in the API and is documented
  at the call site.
- **`toContextBlock`** exists because the most common need is "give me a string to
  paste into a prompt." It formats results as a numbered list with optional source
  attribution.
- **Async methods** even though SQLite is synchronous — because embedding providers
  may be network-bound, and a stable async signature means swapping providers never
  changes call sites.

## 7.2 Return shape

`recall` returns `RecallResult[]`, each carrying content, source, tier, importance,
the final `score`, the component `scores`/`ranks`, `metadata`, and the `why` trace
(§6.4). `indexDirectory` returns an `IndexResult` summary (files, memories, pruned,
durationMs, embeddingModel).

## 7.3 The CLI

A thin wrapper over the API with hand-rolled arg parsing (no dependency):

```bash
engram index <dir>      [--db p] [--chunk auto|file|paragraph|heading] [--fresh]
engram recall "<query>" [--db p] [-k N] [--tier T] [--mark-used] [--json]
engram add "<text>"     [--db p] [--tier T] [--importance I] [--source S]
engram stats            [--db p]
engram help
```

Embedding flags (`--provider`, `--model`, `--dim`, `--openai-key`) and `--db`
(or `$ENGRAM_DB`) apply across commands. `recall` prints a ranked list with the
`why` trace per hit; `--json` emits the raw results for scripting.

The CLI is what makes engram usable as a **standalone tool** (index a folder, query
it from the shell) in addition to a library — and it doubles as the smoke test for
the whole pipeline.
