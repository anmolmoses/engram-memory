# engram

**A plug-and-play associative memory layer for any AI agent.**

Agents are great at logging what happened and terrible at recalling it. `engram`
fixes the recall half. Point it at a folder of markdown notes (or `add()` memories
programmatically), and it gives any agent fast, ranked, *explainable* recall over
everything it has ever written — with zero external services and zero API keys
required to get started.

> Phase 1 of a larger design. This release ships **hybrid retrieval** (semantic +
> lexical) over a **SQLite + FTS5** index that is a rebuildable cache on top of your
> existing files. The graph, spreading-activation recall, and "dreaming"
> consolidation layers are [on the roadmap](#roadmap).

```bash
npm install
npm run build
node dist/cli.js index ./sample-memories --fresh
node dist/cli.js recall "why did production go down after a release?"
```

```
Top 3 memories for: "why did production go down after a release?"

1. [score 0.0400] Production broke once when a deploy shipped application code that
   expected a new column before the database migration had run...
   ↳ semantic #1 (0.21) · lexical #1 · importance 0.90 · semantic/deploy-rollback-rule.md
```

Note it surfaced the right memory even though the query never said "migration" or
"rollback." That is the whole point.

---

## Why

A daily-log memory (one append-only file per day) is **write-optimised and
recall-hostile**: finding "that thing from a few weeks ago" means re-reading every
file. `engram` makes recall a ranked query instead of a scan, and keeps your
markdown as the source of truth — the index is derived and can be rebuilt anytime.

The design is grounded in the agent-memory literature (Generative Agents'
recency/importance/relevance scoring; hybrid vector+lexical retrieval as used by
Mem0/Zep). See [`docs/paper/`](docs/paper) for the full write-up.

## Features

- **Hybrid recall** — semantic (vector cosine) **+** lexical (SQLite FTS5/bm25),
  fused with Reciprocal Rank Fusion. Robust without score normalisation.
- **Zero-dependency by default** — an offline, deterministic hashing embedder means
  it runs with no API keys, no network, no native model. Great for tests, demos,
  and air-gapped agents.
- **Pluggable embeddings** — swap in OpenAI (built-in) or any model via a one-method
  interface for true semantic recall.
- **Markdown-native ingestion** — frontmatter parsing, recursive walk, smart
  auto-chunking (whole-file for notes, paragraph-split for daily logs).
- **Salience-aware** — an `importance` signal gently tilts ranking (a deploy that
  broke prod outranks small talk).
- **Explainable** — every result carries a `why` trace ("semantic #1 · lexical #2 ·
  importance 0.90"). Recall you can audit.
- **One file = the whole index** — a single SQLite file you can copy, back up, or
  delete and rebuild.
- **TypeScript, tiny surface** — one `Engram` class, a small CLI, no framework.

## Install

```bash
git clone <this-repo> engram && cd engram
npm install
npm run build      # compiles to dist/
npm test           # 17 tests, runs offline
```

Requires Node ≥ 20. The only runtime dependency is `better-sqlite3`.

## Library usage

```ts
import { Engram } from "engram";

const mem = new Engram({ dbPath: "agent-memory.db" });

// 1. Index a folder of notes (non-destructive; rebuildable cache).
await mem.indexDirectory("./memories");

// 2. ...or add memories directly.
await mem.add({
  content: "Prod broke when the deploy raced ahead of the DB migration.",
  tier: "episodic",
  importance: 9,            // 1..10 or 0..1, auto-normalised
});

// 3. Recall the most relevant memories for the current situation.
const hits = await mem.recall("what should I watch out for when deploying?", { k: 5 });

// 4. Drop them straight into your prompt.
const context = mem.toContextBlock(hits);

mem.close();
```

See [`examples/agent-integration.md`](examples/agent-integration.md) for the
per-turn agent loop and how to expose memory as model tools.

### Upgrading to true semantic recall

The default embedder is lexical-ish (it has no learned semantics — "car" and
"automobile" don't converge). For real semantic recall, pass a provider:

```ts
const mem = new Engram({
  dbPath: "agent-memory.db",
  embedding: { provider: "openai", model: "text-embedding-3-small" }, // uses OPENAI_API_KEY
});
```

Or implement the `EmbeddingProvider` interface (`{ name, dim, embed(texts) }`) for a
local model, Cohere, Voyage, etc. Nothing else in your code changes.

## Use your existing subscription (no API key)

engram can use the **Claude or ChatGPT subscription you already pay for** — via
their command-line tools — to *rerank* recalled memories (and optionally rate
importance). It shells out to `claude -p` or `codex exec`; no API key, no separate
billing.

```ts
const mem = new Engram({
  dbPath: "agent-memory.db",
  llm: { provider: "claude-cli", model: "sonnet" },   // your Claude subscription
  // llm: { provider: "codex-cli", model: "gpt-5-codex" }, // your ChatGPT/Codex subscription
});

const hits = await mem.recall("what bit us last release?", { k: 5, rerank: true });
```

How rerank works: hybrid search produces a larger candidate pool (cheap, local),
then the LLM **reads the actual text and reorders by true relevance**. On any
failure it falls back to the hybrid order — reranking never makes recall worse.

```bash
# from the shell, using your Claude subscription:
engram recall "trust an agent that says it's done?" --llm claude --llm-model sonnet --rerank

# silent tmux invocation (for environments that prefer a tmux/TTY context):
engram recall "..." --llm claude --rerank --tmux
```

**Configure once** in `engram.config.json` (see `engram.config.example.json`):

```json
{ "dbPath": "agent-memory.db",
  "llm": { "provider": "claude-cli", "model": "sonnet", "useTmux": false },
  "rerank": true }
```

Providers & models are configurable:

| Provider | Subscription | Models (`--llm-model`) | Prereq |
|----------|--------------|------------------------|--------|
| `claude-cli` | Claude (Max/Pro) | `sonnet`, `opus`, `haiku`, or full id | `claude` logged in |
| `codex-cli` | ChatGPT/Codex | `gpt-5-codex`, etc. | `codex login` + readable `~/.codex` |
| `command` | anything | n/a | any text-in/out CLI (e.g. `ollama run llama3`) |

For any other local model, use `{ provider: "command", command: "ollama", args: ["run","llama3"] }`.

## CLI

```bash
engram index <dir>        # index .md/.txt files (--fresh for a clean rebuild)
engram recall "<query>"   # -k N, --tier T, --rerank, --json, --mark-used
engram add "<text>"       # --tier, --importance, --source
engram stats              # index statistics
engram help
```

Common flags: `--db <path>` (or `$ENGRAM_DB`), `--config <path>`,
`--provider hashing|openai`, `--model`, `--dim`, `--openai-key`.
LLM flags: `--llm claude|codex|none`, `--llm-model <name>`, `--tmux`, `--rerank`.

## How it works (in one paragraph)

On ingest, each memory is embedded and stored in SQLite, with its text mirrored
into an FTS5 table. On `recall(query)`, two channels run: **semantic** (cosine of
the query embedding vs every stored vector) and **lexical** (FTS5/bm25 keyword
match). The two ranked lists are fused with **Reciprocal Rank Fusion**
(`score += weight / (k + rank)`), then nudged by **importance** (and optionally
**recency**). The top-k come back with a `why` trace. Full details in
[`docs/paper/06-hybrid-retrieval.md`](docs/paper/06-hybrid-retrieval.md).

## Project structure

```
engram/
  src/
    engram.ts            # the public Engram orchestrator
    index.ts             # public API exports
    cli.ts               # command-line interface
    config.ts            # engram.config.json loader
    store/               # SQLite + FTS5 storage (swappable behind MemoryStore)
    embeddings/          # pluggable providers (hashing default, openai optional)
    llm/                 # subscription-CLI providers (claude, codex, command)
    ingest/              # markdown frontmatter + chunking
    retrieval/           # hybrid RRF fusion + scoring
    util/                # hashing, cosine, frontmatter, tokenisation
  test/                  # node:test suites (offline)
  examples/              # quickstart + integration guide
  sample-memories/       # works out of the box
  docs/paper/            # research-paper-style design documentation
```

## Roadmap

`engram` Phase 1 is the recall layer. The larger design adds, in order:

- **Phase 2 — associative graph:** typed edges between memories (causal, temporal,
  entity, similarity) and spreading-activation / Personalized-PageRank recall.
- **Phase 3 — dreaming:** treat short-term memory as a bounded cache; a nightly
  consolidation job replays the day, promotes salient memories to long-term,
  extracts lessons, and garbage-collects the rest (salience-weighted eviction).
- **Phase 4 — reinforcement & eval:** Hebbian edge strengthening, recall@k
  benchmarking, weight tuning.

See [`docs/paper/09-limitations-and-roadmap.md`](docs/paper/09-limitations-and-roadmap.md).

## License

MIT — see [LICENSE](LICENSE).
