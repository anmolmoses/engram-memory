# 10 · LLM Reasoning via Subscription CLIs

**Code:** `src/llm/` (`provider.ts`, `claude-cli.ts`, `codex-cli.ts`,
`command.ts`), `src/util/exec.ts`, `src/retrieval/rerank.ts`, `src/config.ts`.

## 10.1 Goal: use the plan you already pay for

Many teams have a **Claude (Max/Pro)** or **ChatGPT/Codex** subscription but no
desire to provision and bill a separate API key just to give their agent better
memory. engram therefore drives the LLM-powered features through the
**subscription CLIs** (`claude -p`, `codex exec`) as child processes — the same
mechanism the host agent (e.g. Friday) already uses. No API key, no extra billing.

A clarifying boundary: **subscription CLIs generate text; they do not expose an
embeddings endpoint.** So the *vector* channel still uses the offline hashing
embedder (or OpenAI, if a key is supplied). The LLM is used where it is uniquely
strong — **judging relevance and salience** — not for embeddings.

## 10.2 The provider abstraction

```ts
interface LLMProvider { name: string; complete(prompt, opts?): Promise<string>; }
```

Three built-ins, all behind one factory (`createLLMProvider`):

| Provider | Invocation | Subscription |
|----------|-----------|--------------|
| `claude-cli` | `claude -p <prompt> --model <m> --output-format text` | Claude |
| `codex-cli` | `codex exec -m <m> <prompt>` | ChatGPT/Codex |
| `command` | any `argv` (e.g. `ollama run llama3`), prompt via stdin/arg | local / other |

Models are configurable per provider (`model` option / `--llm-model`). Passing
`{ provider: "none" }` or nothing yields a `null` LLM, and engram runs in pure
hybrid mode (rerank becomes a no-op). A ready `LLMProvider` instance can also be
passed directly — which is how the tests inject a deterministic stub.

## 10.3 Process execution: direct and "silent tmux"

`src/util/exec.ts` provides two ways to run a CLI:

- **`runCommand`** — a direct `spawn` with args as an array (no shell, so prompts
  with quotes/newlines need no escaping), stdout captured, hard timeout, stdin
  optional.
- **`runViaTmux`** — runs the command inside a **detached tmux session**. The
  prompt is written to a temp file and piped in (`< prompt.txt`), stdout/stderr
  are redirected to files, and a sentinel file signals completion, which we poll
  for (with a timeout) before reading the output and killing the session.

Why offer tmux at all? Some environments and auth setups behave more reliably when
the subscription CLI runs inside a tmux/TTY context (this mirrors how the host
agent spawns `claude`). It is **opt-in** (`useTmux` / `--tmux`); the default is the
simpler direct subprocess. Both paths were verified live against `claude -p`.

## 10.4 Reranking (the headline feature)

Hybrid search is fast but blunt; an LLM that *reads the candidate text* judges
relevance far better. `recall(query, { rerank: true })`:

1. runs hybrid search for a **larger candidate pool** (`max(k*4, 20)`),
2. sends the candidate snippets to the LLM asking for *"a JSON array of the memory
   numbers, most relevant first"*,
3. parses the first `[...]` array from the response (robust to surrounding prose),
   reorders, tops up from the hybrid order if the LLM returned fewer than `k`, and
   tags each result's `why` with `LLM-reranked`.

**Failure is always safe.** Timeout, non-zero exit, or unparseable output → engram
returns the original hybrid top-k. Reranking can only improve recall, never break
it. This was a deliberate robustness requirement: an agent's memory must not go
down because a CLI hiccupped.

Observed live (Claude `sonnet`): for *"what bit us last release?"* the reranker
promoted the full incident narrative above the terse rule — a better answer to the
question as asked.

## 10.5 Importance rating

`rateImportance(text)` asks the LLM to score a memory's long-term importance 1–10
and returns it normalised to [0,1] (neutral 0.5 on no-LLM or failure). This is the
opt-in path toward auto-salience (today importance comes from frontmatter/caller).
It feeds the same salience nudge used in scoring (§6.3).

## 10.6 Configuration

`engram.config.json` (see `engram.config.example.json`) lets users set the
embedder, the LLM provider+model, and default rerank once, instead of repeating
flags. Precedence: **CLI flags > config file > built-in defaults**. The loader
never throws on a missing default file (returns `{}`); an explicitly-given missing
path is a clear error.

## 10.7 Cost, latency, privacy

- **Cost/latency:** a rerank is one LLM call (a few seconds). Keep it for queries
  that matter; pure hybrid is instant and free. Importance rating is one call per
  memory at write time — use the batch/offline path for large imports.
- **Privacy:** prompts contain memory snippets and are sent to whichever CLI you
  configure. For sensitive data, use a local `command` provider (e.g. ollama) — the
  same interface, nothing leaves the machine.

## 10.8 Limits

- Codex's non-interactive output is noisier than Claude's; engram parses
  defensively, but `claude-cli` is the smoother default. `codex-cli` requires
  `codex login` and a readable `~/.codex` config.
- No streaming, no multi-turn — these are single-shot `complete()` calls by design.
- Reranking a very large pool costs prompt tokens; `rerankPool` bounds it.
