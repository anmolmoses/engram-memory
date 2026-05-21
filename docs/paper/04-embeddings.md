# 4 · Embeddings

**Code:** `src/embeddings/provider.ts`, `hashing.ts`, `openai.ts`;
shared tokeniser in `src/util/text.ts`.

## 4.1 The contract

```ts
interface EmbeddingProvider {
  readonly name: string;   // stored per-vector, e.g. "hashing-v1@256"
  readonly dim: number;    // vectors of different dims are never compared
  embed(texts: string[]): Promise<Float32Array[]>;
}
```

That is the entire extension point. A factory (`createEmbeddingProvider`) resolves
either a config object or a ready instance, defaulting to the offline hashing
provider so engram works with no setup.

## 4.2 The default: feature hashing (offline, deterministic)

`HashingEmbeddingProvider` implements the classic *hashing trick*:

1. Tokenise to meaningful words (lowercased, stopwords and 1-char tokens removed —
   see §4.4).
2. Form unigrams **and** bigrams.
3. Hash each gram (FNV-1a) into a bucket in `[0, dim)`, with a sign bit from the
   high bits of the hash.
4. Accumulate, then L2-normalise.

**What it is and isn't.** It is deterministic, offline, dependency-free, and fast.
It has **no learned semantics** — "car" and "automobile" do not converge. It
therefore behaves like a *smart lexical signal* that complements FTS5 rather than a
true semantic model. This is a deliberate trade: it lets engram run anywhere —
tests, CI, demos, air-gapped agents — with zero install friction and zero keys.

Because it is normalised, cosine reduces to a dot product, and identical inputs
always produce identical vectors (important for reproducible tests).

## 4.3 The upgrade: real semantics

`OpenAIEmbeddingProvider` calls the OpenAI embeddings API via the global `fetch`
(no SDK dependency). Supply a key via constructor or `OPENAI_API_KEY`:

```ts
new Engram({ embedding: { provider: "openai", model: "text-embedding-3-small" } });
```

It supports reduced dimensions (`text-embedding-3-*`) and L2-normalises results so
the rest of the pipeline is unchanged. To use a **local** model (e.g.
`@xenova/transformers`), Cohere, or Voyage, implement the three-member interface —
nothing else in engram changes.

## 4.4 One tokeniser, both channels

A subtle but important decision: the **lexical channel and the embedder share the
same tokeniser** (`meaningfulTokens` in `util/text.ts`), including stopword removal.

Early on, the FTS query included stopwords ("how", "do", "with", "new"...). Because
bm25 sums per-term contributions, filler words diluted the rare, content-bearing
terms, and high-`importance` memories then won queries they shouldn't. Stripping
stopwords from *both* channels fixed it: lexical recall now ranks on "migration",
"admin", "agent" rather than "how"/"the". This single change moved the bundled
demo from wrong top-1 results to correct ones on all three sample queries (§8).

The lesson, recorded here because it is non-obvious: **a hybrid system's channels
must agree on what a meaningful token is**, or one channel's noise leaks into the
fused ranking.
