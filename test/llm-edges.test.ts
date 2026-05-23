import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLlmEdges, parseRelations } from "../src/graph/llm-edges.js";
import { SqliteStore } from "../src/store/sqlite-store.js";
import { Engram } from "../src/index.js";
import type { LLMProvider } from "../src/llm/provider.js";

const now = Date.now();
function seed(s: SqliteStore) {
  const mk = (id: string, content: string) => ({
    id, content, source: "x.md", tier: null, importance: 0.5, metadata: null,
    contentHash: "h", createdAt: 1, updatedAt: 1, lastUsedAt: null, useCount: 0,
    embedding: null, embeddingModel: null, embeddingDim: null,
  });
  s.upsertMany([
    mk("deploy", "shipped code that read a column the migration had not created yet"),
    mk("lesson", "rule: always run migrations before the code that depends on them"),
  ]);
  // A structural edge makes them a candidate pair (deploy → lesson).
  s.addEdge({ srcId: "deploy", dstId: "lesson", type: "similar", weight: 0.7, createdAt: now, updatedAt: now });
}

test("parseRelations extracts labelled pairs, ignores junk", () => {
  assert.deepEqual(
    parseRelations('ok: [{"pair":1,"rel":"caused","dir":"XY"},{"pair":2,"rel":"none"}]'),
    [{ pair: 1, rel: "caused", dir: "XY" }, { pair: 2, rel: "none", dir: undefined }],
  );
  assert.deepEqual(parseRelations("no json"), []);
  assert.deepEqual(parseRelations("[broken"), []);
});

test("buildLlmEdges creates a directed semantic edge from the LLM label", async () => {
  const s = new SqliteStore(":memory:");
  seed(s);
  const stub: LLMProvider = { name: "stub", async complete() { return '[{"pair":1,"rel":"lesson_from","dir":"YX"}]'; } };
  const res = await buildLlmEdges(s, stub);
  assert.equal(res.lesson_from, 1);
  assert.equal(res.pairsConsidered, 1);
  // dir "YX" → lesson (Y) is the source of lesson_from → deploy (X) the episode.
  const out = s.edgesFrom(["lesson"], ["lesson_from"]);
  assert.equal(out[0]?.dstId, "deploy");
  s.close();
});

test("buildLlmEdges is safe when the LLM throws or returns junk", async () => {
  const s1 = new SqliteStore(":memory:"); seed(s1);
  const thrower: LLMProvider = { name: "x", async complete() { throw new Error("cli down"); } };
  const r1 = await buildLlmEdges(s1, thrower);
  assert.equal(r1.caused + r1.supersedes + r1.lesson_from, 0);
  assert.equal(s1.edgeCount(), 1); // only the original similar edge remains
  s1.close();

  const s2 = new SqliteStore(":memory:"); seed(s2);
  const junk: LLMProvider = { name: "x", async complete() { return "I can't do that"; } };
  const r2 = await buildLlmEdges(s2, junk);
  assert.equal(r2.lesson_from, 0);
  s2.close();
});

test("buildLlmEdges no-ops with no candidate pairs", async () => {
  const s = new SqliteStore(":memory:"); // no edges at all
  const stub: LLMProvider = { name: "stub", async complete() { return '[{"pair":1,"rel":"caused","dir":"XY"}]'; } };
  const res = await buildLlmEdges(s, stub);
  assert.equal(res.pairsConsidered, 0);
  assert.equal(res.calls, 0);
  s.close();
});

test("Engram.buildLlmEdges returns zeros without an LLM configured", async () => {
  const mem = new Engram({ dbPath: ":memory:" }); // no llm
  await mem.addMany([{ id: "a", content: "alpha" }, { id: "b", content: "beta" }]);
  mem.buildEdges();
  const res = await mem.buildLlmEdges();
  assert.equal(res.caused + res.supersedes + res.lesson_from, 0);
  mem.close();
});
