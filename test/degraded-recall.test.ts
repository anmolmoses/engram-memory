import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import type { EmbeddingProvider } from "../src/embeddings/provider.js";

/**
 * An embedder that works for writes but dies for reads — exactly what a revoked
 * API key looks like against an already-populated store: the vectors are there,
 * the query can't be embedded.
 */
class FlakyProvider implements EmbeddingProvider {
  readonly name = "flaky@8";
  readonly dim = 8;
  broken = false;
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.broken) throw new Error("embeddings unavailable: 401 invalid_api_key");
    return texts.map((t) => {
      const v = new Float32Array(this.dim);
      for (let i = 0; i < t.length; i++) v[i % this.dim] += 1;
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      return v.map((x) => x / n);
    });
  }
}

test("recall degrades to lexical-only when the embedder fails, instead of throwing", async () => {
  const provider = new FlakyProvider();
  const mem = new Engram({ dbPath: ":memory:", embedding: provider });
  await mem.addMany([
    { id: "worktree", content: "Never run npm install inside a dispatched worktree", tier: "semantic" },
    { id: "grocery", content: "Bought milk, eggs and bread at the grocery store", tier: "episodic" },
  ]);

  provider.broken = true;
  const errors: Error[] = [];
  const hits = await mem.recall("npm install worktree", { k: 2, onDegraded: (e) => errors.push(e) });

  // The point: results still come back, from the keyword channel alone.
  assert.equal(hits[0]?.id, "worktree");
  assert.equal(hits[0]?.scores.semantic, undefined, "no semantic score in degraded mode");
  assert.ok(hits[0]?.scores.lexical !== undefined, "lexical channel carried the recall");
  // ...and the caller is told, so a UI can say "keyword-only" rather than lie.
  assert.equal(errors.length > 0, true);
  assert.match(errors[0]!.message, /401|unavailable/);
  mem.close();
});

test("a healthy embedder still contributes the semantic channel", async () => {
  const provider = new FlakyProvider();
  const mem = new Engram({ dbPath: ":memory:", embedding: provider });
  await mem.addMany([
    { id: "worktree", content: "Never run npm install inside a dispatched worktree", tier: "semantic" },
  ]);
  const degraded: Error[] = [];
  const hits = await mem.recall("npm install worktree", { k: 1, onDegraded: (e) => degraded.push(e) });
  assert.equal(degraded.length, 0);
  assert.ok(hits[0]?.scores.semantic !== undefined);
  mem.close();
});
