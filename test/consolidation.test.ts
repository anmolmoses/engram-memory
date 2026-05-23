import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { salience, DEFAULT_SALIENCE } from "../src/consolidation/consolidate.js";

const DAY = 86_400_000;

test("salience: recent/frequent/important scores higher than old/unused/trivial", () => {
  const now = Date.now();
  const hot = salience({ createdAt: now, lastUsedAt: now, useCount: 10, importance: 0.9 }, now);
  const cold = salience({ createdAt: now - 90 * DAY, lastUsedAt: null, useCount: 0, importance: 0.1 }, now);
  assert.ok(hot > cold);
});

test("consolidate archives the lowest-salience memories beyond capacity", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "keep1", content: "critical deploy rule", importance: 9, createdAt: now },
    { id: "keep2", content: "important migration lesson", importance: 8, createdAt: now },
    { id: "drop1", content: "trivial note one", importance: 1, createdAt: now - 60 * DAY },
    { id: "drop2", content: "trivial note two", importance: 1, createdAt: now - 80 * DAY },
  ]);
  const res = mem.consolidate({ capacity: 2, now });
  assert.equal(res.archived, 2);
  assert.deepEqual(new Set(res.archivedIds), new Set(["drop1", "drop2"]));
  // Archived memories drop out of recall…
  const hits = await mem.recall("note", { k: 10 });
  assert.ok(!hits.some((h) => h.id === "drop1" || h.id === "drop2"));
  mem.close();
});

test("protected tiers are never archived", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "lesson", content: "a durable rule", tier: "semantic", importance: 1, createdAt: now - 99 * DAY },
    { id: "ep1", content: "fresh episode one", tier: "episodic", importance: 5, createdAt: now },
    { id: "ep2", content: "fresh episode two", tier: "episodic", importance: 5, createdAt: now },
  ]);
  const res = mem.consolidate({ capacity: 1, now }); // overflow 2, but lesson is protected
  assert.ok(!res.archivedIds.includes("lesson"));
  assert.ok(res.protectedCount >= 1);
  mem.close();
});

test("readmit brings an archived memory back into recall", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "a", content: "deploy migration database outage alpha", importance: 9, createdAt: now },
    { id: "b", content: "deploy migration database outage beta", importance: 1, createdAt: now - 99 * DAY },
  ]);
  mem.consolidate({ capacity: 1, now });
  assert.ok(!(await mem.recall("deploy migration", { k: 10 })).some((h) => h.id === "b"));
  mem.readmit(["b"]);
  assert.ok((await mem.recall("deploy migration", { k: 10 })).some((h) => h.id === "b"));
  mem.close();
});

test("reinforce strengthens edges among co-used memories toward 1", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const t = Date.now();
  await mem.addMany([{ id: "a", content: "x" }, { id: "b", content: "y" }]);
  mem.store.addEdge({ srcId: "a", dstId: "b", type: "similar", weight: 0.4, createdAt: t, updatedAt: t });
  const n = mem.reinforce(["a", "b"], 0.5);
  assert.equal(n, 1);
  const w = mem.store.edgesFrom(["a"], ["similar"])[0]?.weight ?? 0;
  assert.ok(w > 0.4 && w <= 1, `weight should rise from 0.4, got ${w}`);
  mem.close();
});

test("graphExport reports archived state and salience per node", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "hi", content: "hot important", importance: 9, createdAt: now },
    { id: "lo", content: "old trivial", importance: 1, createdAt: now - 99 * DAY },
  ]);
  mem.consolidate({ capacity: 1, now });
  const g = mem.graphExport();
  const lo = g.nodes.find((n) => n.id === "lo"), hi = g.nodes.find((n) => n.id === "hi");
  assert.equal(lo?.archived, true);
  assert.equal(hi?.archived, false);
  assert.ok(hi.salience > lo.salience);
  mem.close();
});
