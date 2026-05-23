import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { evaluate, tuneWeights } from "../src/eval/recall-eval.js";

async function corpus() {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "deploy", content: "production broke after a deploy because the migration had not run" },
    { id: "auth", content: "users could not log in due to an expired oauth token" },
    { id: "lunch", content: "team lunch at the new ramen place downtown" },
  ]);
  return mem;
}
const SET = [
  { query: "production broke after a deploy migration", relevantIds: ["deploy"] },
  { query: "users could not log in expired oauth token", relevantIds: ["auth"] },
];

test("evaluate computes recall@k, MRR, hit@1", async () => {
  const mem = await corpus();
  const m = await evaluate(mem, SET, { k: 3 });
  assert.equal(m.queries, 2);
  assert.ok(m.recallAtK > 0 && m.recallAtK <= 1);
  assert.ok(m.mrr > 0 && m.mrr <= 1);
  assert.equal(m.perQuery.length, 2);
  mem.close();
});

test("evaluate gives perfect scores when the relevant memory ranks #1", async () => {
  const mem = await corpus();
  const m = await evaluate(mem, SET, { k: 3 });
  // Each query's relevant memory is the obvious lexical/semantic match.
  assert.equal(m.recallAtK, 1);
  assert.equal(m.hitAt1, 1);
  mem.close();
});

test("tuneWeights returns the best grid point and never beats-down the baseline", async () => {
  const mem = await corpus();
  const t = await tuneWeights(mem, SET, { semantic: [0, 1, 2], lexical: [0, 1, 2] }, { k: 3 });
  assert.ok(t.trials.length === 9);
  assert.ok(t.bestScore >= t.baseline - 1e-9);
  assert.ok(typeof t.best === "object");
  mem.close();
});

test("recall({reinforce}) strengthens edges among co-retrieved results", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const t = Date.now();
  await mem.addMany([
    { id: "a", content: "deploy migration database outage incident" },
    { id: "b", content: "deploy migration database rollback incident" },
  ]);
  mem.store.addEdge({ srcId: "a", dstId: "b", type: "similar", weight: 0.3, createdAt: t, updatedAt: t });
  const before = mem.store.edgesFrom(["a"], ["similar"])[0]?.weight ?? 0;
  await mem.recall("deploy migration incident", { k: 5, reinforce: true });
  const after = mem.store.edgesFrom(["a"], ["similar"])[0]?.weight ?? 0;
  assert.ok(after > before, `edge weight should rise: ${before} → ${after}`);
  mem.close();
});

test("surprise: novel text scores high, a near-duplicate scores low", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  assert.equal(await mem.surprise("anything"), 1); // empty store → fully novel
  await mem.add({ id: "x", content: "the deploy broke after the database migration step" });
  const dup = await mem.surprise("the deploy broke after the database migration step");
  const novel = await mem.surprise("quarterly marketing budget spreadsheet review");
  assert.ok(dup < novel, `duplicate (${dup.toFixed(2)}) should be less surprising than novel (${novel.toFixed(2)})`);
  mem.close();
});
