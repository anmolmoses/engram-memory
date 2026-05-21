# 5 · Ingestion

**Code:** `src/ingest/markdown.ts`, `src/util/frontmatter.ts`.

## 5.1 Goal

Turn a directory of human-written notes into well-formed memories, without
mangling the source and without requiring the author to think about the index.

## 5.2 Frontmatter

A tiny, dependency-free parser (`parseFrontmatter`) handles the subset of YAML that
agent memory files actually use:

- a leading `--- … ---` block,
- top-level `key: value` pairs,
- one level of nesting (e.g. `metadata:` then indented `type: semantic`),
- scalar coercion (numbers, booleans, quoted strings).

It deliberately does **not** implement full YAML. For arbitrary YAML, swap in
`js-yaml` by replacing this one function. Keeping it dependency-free serves the
"zero install friction" principle; the cost is documented, not hidden.

Recognised keys: `name` (→ stable id), `importance` (→ salience),
`tier`/`metadata.type` (→ tier), `date`/`created_at` (→ creation time). Everything
in the frontmatter is also preserved in the memory's `metadata`.

## 5.3 Chunking strategies

A file can become one memory or several. The strategy:

| Strategy | Behaviour | Good for |
|----------|-----------|----------|
| `file` | one memory per file | atomic notes, lessons |
| `paragraph` | split on blank lines | daily logs / event streams |
| `heading` | split on markdown headings | structured docs |
| `auto` (default) | `file` if the doc has frontmatter, else `paragraph` | mixed corpora |

`auto` encodes a useful heuristic: a note with frontmatter is usually one coherent
idea (keep it whole), while a frontmatter-less daily log is a stream of independent
events (split it). A refinement attaches a **lone heading line** (e.g.
`# 2026-05-18`) to the paragraph that follows it, so a date/title travels with its
first entry instead of becoming a noisy standalone memory.

## 5.4 Stable ids and idempotent re-index

Ids are stable so re-indexing updates rather than duplicates:

- single-chunk file → id = slug of frontmatter `name` or the relative path,
- multi-chunk file → `…::0`, `…::1`, … by chunk index,
- programmatic `add()` without an id → first 16 hex chars of the content hash.

On `indexDirectory`, every re-ingested file's existing memories are **pruned first**
(`deleteBySourcePrefix`), so editing a file or changing its chunk count never
leaves orphaned rows. `--fresh` clears the whole index for a clean rebuild.
This is the property that makes the SQLite index a true *derived cache*: it always
reflects the current files and can be regenerated at will.

## 5.5 What it does not do (yet)

- No semantic chunking (split by meaning rather than blank lines).
- No size cap / sub-splitting of very long paragraphs.
- No incremental "only changed files" indexing (content hashes are stored, so this
  is a straightforward future optimisation).
