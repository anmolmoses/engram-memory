import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { promotionScore, DEFAULT_PROMOTION } from "../src/consolidation/promote.js";

const DAY = 86_400_000;

/** Recall a memory n times so its useCount accrues (the promotion signal). */
function recallNTimes(mem: Engram, ids: string[], n: number) {
  for (let i = 0; i < n; i++) mem.store.markUsed(ids);
}

test("promotionScore: proven (recalled, important, mature) beats unused/trivial/new", () => {
  const now = Date.now();
  const proven = promotionScore({ createdAt: now - 30 * DAY, useCount: 8, importance: 0.9 }, now);
  const fresh = promotionScore({ createdAt: now, useCount: 0, importance: 0.1 }, now);
  assert.ok(proven > fresh);
});

test("promote flips a proven episodic memory to the durable tier with provenance", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "proven", content: "always run migrations before the code that needs them", tier: "episodic", importance: 8, createdAt: now - 10 * DAY },
    { id: "noise", content: "someone said hi in the channel", tier: "episodic", importance: 2, createdAt: now },
  ]);
  recallNTimes(mem, ["proven"], 4); // recalled enough to clear the gate

  const res = mem.promote({ minUseCount: 3, now });
  assert.equal(res.promoted, 1);
  assert.deepEqual(res.promotedIds, ["proven"]);

  const rec = mem.store.getById("proven")!;
  assert.equal(rec.tier, "semantic", "promoted into the durable tier");
  assert.equal((rec.metadata as any).promotedFrom, "episodic");
  assert.ok(typeof (rec.metadata as any).promotedAt === "number");

  // The unproven one is untouched.
  assert.equal(mem.store.getById("noise")!.tier, "episodic");
  mem.close();
});

test("the minUseCount gate keeps barely-recalled memories short-term", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([{ id: "a", content: "recalled just twice", tier: "episodic", importance: 9, createdAt: now }]);
  recallNTimes(mem, ["a"], 2); // below the default gate of 3

  const res = mem.promote({ minUseCount: 3, now });
  assert.equal(res.eligible, 0);
  assert.equal(res.promoted, 0);
  assert.equal(mem.store.getById("a")!.tier, "episodic");
  mem.close();
});

test("promotion makes a memory protected from later consolidation (the full short->long loop)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "proven", content: "the lesson that keeps getting recalled", tier: "episodic", importance: 5, createdAt: now - 40 * DAY },
    { id: "filler1", content: "filler one", tier: "episodic", importance: 5, createdAt: now },
    { id: "filler2", content: "filler two", tier: "episodic", importance: 5, createdAt: now },
  ]);
  recallNTimes(mem, ["proven"], 5);

  mem.promote({ minUseCount: 3, now });
  // Now force consolidation down to capacity 1: were "proven" still episodic and
  // oldest, it would be the first archived. Promotion should have protected it.
  const res = mem.consolidate({ capacity: 1, now });
  assert.ok(!res.archivedIds.includes("proven"), "promoted memory survives consolidation");
  mem.close();
});

test("dryRun ranks candidates without changing anything", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([{ id: "a", content: "proven thing", tier: "episodic", importance: 7, createdAt: now }]);
  recallNTimes(mem, ["a"], 4);

  const res = mem.promote({ minUseCount: 3, dryRun: true, now });
  assert.equal(res.eligible, 1);
  assert.equal(res.promoted, 0);
  assert.equal(res.candidates[0]?.id, "a");
  assert.equal(mem.store.getById("a")!.tier, "episodic", "dryRun must not mutate");
  mem.close();
});

test("limit caps promotions to the highest-scoring, and promotion is idempotent", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    { id: "high", content: "high score", tier: "episodic", importance: 9, createdAt: now - 30 * DAY },
    { id: "low", content: "low score", tier: "episodic", importance: 3, createdAt: now },
  ]);
  recallNTimes(mem, ["high"], 8);
  recallNTimes(mem, ["low"], 3);

  const first = mem.promote({ minUseCount: 3, limit: 1, now });
  assert.equal(first.promoted, 1);
  assert.deepEqual(first.promotedIds, ["high"], "highest-scoring promoted first");

  // Re-running: "high" left the episodic pool, so it's never re-promoted; "low" still eligible.
  const second = mem.promote({ minUseCount: 3, limit: 1, now });
  assert.equal(second.promoted, 1);
  assert.deepEqual(second.promotedIds, ["low"]);
  const third = mem.promote({ minUseCount: 3, now });
  assert.equal(third.promoted, 0, "nothing left to promote — idempotent");
  mem.close();
});
