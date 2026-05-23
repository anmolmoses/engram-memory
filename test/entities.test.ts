import { test } from "node:test";
import assert from "node:assert/strict";
import { Engram } from "../src/index.js";
import { extractEntities } from "../src/graph/entities.js";
import { SqliteStore } from "../src/store/sqlite-store.js";

test("extractEntities pulls identifiers, acronyms, and proper nouns — not filler", () => {
  const ents = new Set(
    extractEntities(
      "Pranav hit the MCP server bug; the `relevance_score` column broke after conversations.replies failed.",
    ),
  );
  assert.ok(ents.has("relevance_score"), "snake_case identifier");
  assert.ok(ents.has("conversations.replies"), "dotted identifier");
  assert.ok(ents.has("mcp"), "acronym (lowercased)");
  assert.ok(ents.has("pranav"), "proper noun");
  // Sentence-initial common word should not become an entity.
  assert.ok(!ents.has("the"));
});

test("entity glossary: setEntities + memoriesForEntity round-trip, cascade delete", () => {
  const s = new SqliteStore(":memory:");
  const mk = (id: string, source: string) => ({
    id, content: `c ${id}`, source, tier: null, importance: 0.5, metadata: null,
    contentHash: "h", createdAt: 1, updatedAt: 1, lastUsedAt: null, useCount: 0,
    embedding: null, embeddingModel: null, embeddingDim: null,
  });
  s.upsertMany([mk("a", "x.md"), mk("b", "x.md")]);
  s.setEntities("a", ["relevance_score", "MCP"]);
  s.setEntities("b", ["relevance_score"]);

  // Case-insensitive lookup; both memories share relevance_score.
  assert.deepEqual(new Set(s.memoriesForEntity("RELEVANCE_SCORE")), new Set(["a", "b"]));
  assert.deepEqual(s.memoriesForEntity("mcp"), ["a"]);
  assert.equal(s.entityCount(), 2);

  // setEntities replaces, not appends.
  s.setEntities("a", ["api"]);
  assert.equal(s.memoriesForEntity("mcp").length, 0);

  // Deleting the memory cascades its glossary rows.
  s.deleteBySourcePrefix("x.md");
  assert.equal(s.entityCount(), 0);
  s.close();
});

test("about edges link memories that share a salient entity", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    { id: "m1", content: "the deploy broke the `relevance_score` column in production" },
    { id: "m2", content: "added a migration that creates `relevance_score` ahead of the code" },
    { id: "m3", content: "had a sandwich for lunch in the park with friends" },
  ]);
  const res = mem.buildEdges({ similar: false, temporal: false });
  assert.ok(res.about > 0, "expected about edges from the shared identifier");

  // m1 and m2 share `relevance_score`; m3 shares nothing with them.
  const m1about = mem.store.edgesFrom(["m1"], ["about"]).map((e) => e.dstId);
  assert.ok(m1about.includes("m2"), "m1 ↔ m2 about edge via relevance_score");
  assert.ok(!m1about.includes("m3"), "m3 should not be linked");
  // Symmetric: m2 → m1 too.
  assert.ok(mem.store.edgesFrom(["m2"], ["about"]).some((e) => e.dstId === "m1"));
  mem.close();
});

test("query-entity seeding surfaces a memory ranked OUT of the hybrid pool", async () => {
  const mem = new Engram({ dbPath: ":memory:" });
  await mem.addMany([
    // Tagged with the `relevance_score` identifier, but lexically thin.
    { id: "scoredoc", content: "the `relevance_score` column must exist before the ranking code reads it" },
    // A lexical hog: repeats the query's plain words so it dominates bm25 and
    // claims the single hybrid seed slot. It has NO identifier, so no entity.
    { id: "hog", content: "relevance score relevance score relevance score ranking ranking ranking improved" },
  ]);
  mem.buildEdges(); // populates the glossary + edges

  // candidatePool:1 → only the hog seeds hybrid; scoredoc can reach the results
  // only because the query mentions the `relevance_score` entity it carries.
  const hits = await mem.recall("notes on `relevance_score`", {
    k: 5,
    associative: true,
    candidatePool: 1,
  });
  const doc = hits.find((r) => r.id === "scoredoc");
  assert.ok(doc, "the relevance_score memory should surface via entity seeding");
  assert.match(doc!.why, /entity match: "relevance_score"/);
  mem.close();
});
