import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { buildEdges } from "../src/graph/build.js";
import { SqliteStore } from "../src/store/sqlite-store.js";

test("similar edges link near-duplicate memories (kNN over embeddings)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "deploy1", content: "the production deploy broke after a database migration" },
    { id: "deploy2", content: "production outage caused by a deploy migration mismatch" },
    { id: "lunch", content: "had a sandwich and coffee for lunch in the park" },
  ]);
  const res = mem.buildEdges({ temporal: false, similar: { k: 2, minSimilarity: 0.2 } });
  assert.ok(res.similar > 0, "expected at least one similar edge");

  // The two deploy memories should link to each other; lunch should not be a
  // top neighbour of either deploy note.
  const fromDeploy1 = mem.store.edgesFrom(["deploy1"], ["similar"]).map((e) => e.dstId);
  assert.ok(fromDeploy1.includes("deploy2"), "deploy1 → deploy2 similar edge");
  assert.ok(!fromDeploy1.includes("lunch"), "lunch should not be deploy1's neighbour");
  mem.close();
});

test("temporal_next chains memories within a source by creation time", () => {
  const s = new SqliteStore(":memory:");
  const mk = (id: string, t: number, source: string | null) => ({
    id, content: `note ${id}`, source, tier: null, importance: 0.5, metadata: null,
    contentHash: "h", createdAt: t, updatedAt: t, lastUsedAt: null, useCount: 0,
    embedding: null, embeddingModel: null, embeddingDim: null,
  });
  // Out of order on purpose; two sources.
  s.upsertMany([
    mk("b", 200, "day/1.md"),
    mk("a", 100, "day/1.md"),
    mk("c", 300, "day/1.md"),
    mk("z", 150, "day/2.md"),
  ]);
  const res = buildEdges(s, { similar: false });
  // day/1: a→b, b→c (2 edges). day/2: single memory, no chain. Total 2.
  assert.equal(res.temporal, 2);
  const aNext = s.edgesFrom(["a"], ["temporal_next"]);
  assert.equal(aNext[0]?.dstId, "b");
  const bNext = s.edgesFrom(["b"], ["temporal_next"]);
  assert.equal(bNext[0]?.dstId, "c");
  assert.equal(s.edgesFrom(["z"], ["temporal_next"]).length, 0);
  s.close();
});

test("buildEdges is idempotent (upsert, no duplicate accumulation)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "a", content: "deploy migration database outage", source: "d.md", createdAt: 1 },
    { id: "b", content: "deploy migration database rollback", source: "d.md", createdAt: 2 },
  ]);
  const first = mem.buildEdges({ similar: { k: 5, minSimilarity: 0.1 } });
  const countAfterFirst = mem.stats().edges;
  const second = mem.buildEdges({ similar: { k: 5, minSimilarity: 0.1 } });
  assert.equal(mem.stats().edges, countAfterFirst, "edge count stable across rebuilds");
  assert.equal(first.total, second.total);
  mem.close();
});

test("indexDirectory builds the graph by default; edges:false skips it", async () => {
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "..", "sample-memories");

  const withGraph = new Engram({ dbPath: ":memory:" });
  await withGraph.indexDirectory(dir);
  assert.ok(withGraph.stats().edges > 0, "default index should populate edges");
  withGraph.close();

  const noGraph = new Engram({ dbPath: ":memory:" });
  await noGraph.indexDirectory(dir, { edges: false });
  assert.equal(noGraph.stats().edges, 0, "edges:false should skip graph building");
  noGraph.close();
});
