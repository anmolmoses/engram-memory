import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";

test("graphExport returns nodes, edges, and stats for visualisation", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "a", content: "the deploy broke the `relevance_score` column", source: "d.md", createdAt: 1 },
    { id: "b", content: "added a migration creating `relevance_score`", source: "d.md", createdAt: 2 },
  ]);
  mem.buildEdges();
  const g = mem.graphExport();

  assert.equal(g.nodes.length, 2);
  assert.ok(g.nodes.every((n) => typeof n.label === "string" && n.label.length > 0));
  assert.ok(g.edges.length > 0, "should have at least temporal/about edges");
  assert.ok(g.edges.every((e) => e.src && e.dst && e.type && typeof e.weight === "number"));
  assert.equal(g.stats.count, 2);
  assert.equal(g.stats.edges, g.edges.length);
  mem.close();
});

test("recallTrace returns results plus seeds and activations", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "episode", content: "the dentist used a drill on my tooth and it hurt" },
    { id: "near", content: "the dentist drilled my tooth badly that day" },
    { id: "lesson", content: "floss every night to avoid future appointments" },
  ]);
  mem.store.addEdge({
    srcId: "episode", dstId: "lesson", type: "lesson_from", weight: 1,
    createdAt: Date.now(), updatedAt: Date.now(),
  });

  const { results, trace } = await mem.recallTrace("tooth pain at the dentist drill", {
    k: 5,
    candidatePool: 2,
  });

  assert.ok(results.length > 0);
  assert.equal(trace.query, "tooth pain at the dentist drill");
  // Hybrid seeds were chosen.
  assert.ok(trace.seeds.some((s) => s.kind === "hybrid"));
  // The lesson was activated via the lesson_from edge.
  const lessonAct = trace.activations.find((a) => a.id === "lesson");
  assert.ok(lessonAct, "lesson should appear in the activation trace");
  assert.equal(lessonAct!.via.type, "lesson_from");
  assert.equal(lessonAct!.via.from, "episode");
  mem.close();
});
