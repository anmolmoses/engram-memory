import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engram } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

test("recall ranks the relevant memory first (hybrid, offline)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "dentist", content: "The dentist used a drill on my tooth, it was painful", tier: "episodic" },
    { id: "grocery", content: "Bought milk, eggs and bread at the grocery store", tier: "episodic" },
    { id: "review", content: "Reviewed a pull request and left comments about error handling", tier: "episodic" },
  ]);
  const hits = await mem.recall("tooth pain at the dentist drill", { k: 3 });
  assert.equal(hits[0]?.id, "dentist");
  assert.ok(hits[0]?.why.length); // explainability trace present
  mem.close();
});

test("indexDirectory + recall surfaces the migration incident", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const res = await mem.indexDirectory(join(here, "..", "sample-memories"));
  assert.ok(res.memories >= 5, `expected >=5 memories, got ${res.memories}`);
  const hits = await mem.recall("production outage after a deploy migration", { k: 3 });
  assert.ok(
    hits.some((h) => h.content.toLowerCase().includes("migration")),
    "a migration-related memory should surface",
  );
  mem.close();
});

test("tier filter restricts results", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "a", content: "deploy migration database outage", tier: "semantic" },
    { id: "b", content: "deploy migration database outage", tier: "episodic" },
  ]);
  const hits = await mem.recall("deploy migration", { tier: "semantic", k: 5 });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.tier === "semantic"));
  mem.close();
});

test("importance boost lifts a higher-salience memory", async () => {
  const mem = new Engram({ dbPath: ":memory:", weights: { importance: 1 } });
  await mem.addMany([
    { id: "low", content: "deploy migration note", tier: "episodic", importance: 3 },
    { id: "high", content: "deploy migration note", tier: "episodic", importance: 9 },
  ]);
  const hits = await mem.recall("deploy migration note", { k: 2 });
  assert.equal(hits[0]?.id, "high");
  mem.close();
});

test("reindex is idempotent (no duplicates)", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  const dir = join(here, "..", "sample-memories");
  const a = await mem.indexDirectory(dir);
  const b = await mem.indexDirectory(dir);
  assert.equal(mem.stats().count, a.memories);
  assert.equal(b.pruned, a.memories); // second pass pruned what the first added
  mem.close();
});

test("toContextBlock formats recalled memories", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.add({ id: "x", content: "hello memory world", source: "s.md" });
  const hits = await mem.recall("hello world", { k: 1 });
  const block = mem.toContextBlock(hits);
  assert.match(block, /hello memory world/);
  assert.match(block, /s\.md/);
  mem.close();
});
