import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { spreadActivation } from "../src/retrieval/spreading.js";
import { SqliteStore } from "../src/store/sqlite-store.js";

const now = Date.now();
const edge = (srcId: string, dstId: string, type: string, weight = 1) => ({
  srcId, dstId, type, weight, createdAt: now, updatedAt: now,
});

test("spreadActivation: charge flows outward, attenuates, records provenance", () => {
  const s = new SqliteStore(":memory:");
  // a → b → c, plus a → d (weaker). Seed only at "a".
  s.addEdges([edge("a", "b", "caused", 1), edge("b", "c", "lesson_from", 1), edge("a", "d", "similar", 0.5)]);

  const act = spreadActivation(s, new Map([["a", 1]]), { decay: 0.5, hops: 2 });

  // b and d are 1 hop from a; c is 2 hops (via b).
  assert.ok(act.has("b") && act.has("c") && act.has("d"));
  // a only seeds; nothing flows back to it.
  assert.ok(!act.has("a"));
  // Attenuation: 2-hop c is weaker than 1-hop b.
  assert.ok(act.get("c")!.activation < act.get("b")!.activation);
  // Provenance points back along the strongest inflow edge.
  assert.equal(act.get("b")!.via.type, "caused");
  assert.equal(act.get("b")!.via.from, "a");
  assert.equal(act.get("c")!.via.from, "b");
  assert.equal(act.get("c")!.via.hop, 2);
  s.close();
});

test("associative recall surfaces a memory OUTSIDE the hybrid pool, via an edge", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  // episode + near both match the query; the *lesson* shares no words/vectors
  // with it. With candidatePool=2 the lesson is NOT among the hybrid seeds — so
  // if it appears at all, it can only have arrived by following the edge.
  await mem.addMany([
    { id: "episode", content: "the dentist used a drill on my tooth and it really hurt" },
    { id: "near", content: "the dentist drilled and it hurt my tooth badly that day" },
    { id: "lesson", content: "floss every night to avoid future appointments" },
  ]);
  // Hand-author the associative link (Slice 4 derives these automatically).
  mem.store.addEdge(edge("episode", "lesson", "lesson_from", 1));

  const query = "tooth pain at the dentist drill";
  const assoc = await mem.recall(query, { k: 5, associative: true, candidatePool: 2 });

  const lesson = assoc.find((r) => r.id === "lesson");
  assert.ok(lesson, "the linked lesson should surface via spreading activation");
  // rrf===0 proves it was NOT a hybrid hit — it came purely from the graph.
  assert.equal(lesson!.scores.rrf, 0);
  assert.ok((lesson!.scores.activation ?? 0) > 0);
  assert.match(lesson!.why, /^associative:/);
  assert.match(lesson!.why, /lesson_from←episode/);
  // The directly-relevant episode still outranks the associatively-pulled lesson.
  assert.ok(
    assoc.findIndex((r) => r.id === "episode") < assoc.findIndex((r) => r.id === "lesson"),
    "the seed episode should outrank the spread-only lesson",
  );
  mem.close();
});

test("associative recall is a safe no-op when the graph has no edges", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "a", content: "deploy migration database outage" },
    { id: "b", content: "had lunch in the park" },
  ]);
  const hybrid = await mem.recall("deploy migration", { k: 2 });
  const assoc = await mem.recall("deploy migration", { k: 2, associative: true });
  assert.deepEqual(assoc.map((r) => r.id), hybrid.map((r) => r.id));
  mem.close();
});
