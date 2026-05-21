import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStore, toFtsQuery } from "../src/store/sqlite-store.js";
import type { MemoryRecord } from "../src/store/types.js";

function rec(partial: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord {
  const now = Date.now();
  return {
    source: null,
    tier: null,
    importance: 0.5,
    metadata: null,
    contentHash: "h",
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    embedding: null,
    embeddingModel: null,
    embeddingDim: null,
    ...partial,
  };
}

test("upsert / getById round-trips content, metadata, embedding", () => {
  const s = new SqliteStore(":memory:");
  s.upsert(
    rec({
      id: "a",
      content: "the dentist drilled my tooth",
      tier: "episodic",
      importance: 0.8,
      metadata: { k: 1 },
      embedding: new Float32Array([1, 0, 0]),
      embeddingDim: 3,
      embeddingModel: "m",
    }),
  );
  const got = s.getById("a");
  assert.equal(got?.content, "the dentist drilled my tooth");
  assert.deepEqual(got?.metadata, { k: 1 });
  assert.equal(got?.embedding?.length, 3);
  assert.equal(got?.embedding?.[0], 1);
  s.close();
});

test("FTS search finds by keyword; vectors are listed", () => {
  const s = new SqliteStore(":memory:");
  s.upsert(rec({ id: "a", content: "the dentist drilled my tooth", embedding: new Float32Array([1, 0]), embeddingDim: 2 }));
  s.upsert(rec({ id: "b", content: "bought milk and bread" }));
  const hits = s.ftsSearch("dentist tooth", 10);
  assert.equal(hits[0]?.id, "a");
  assert.equal(s.allVectors().length, 1);
  assert.equal(s.count(), 2);
  s.close();
});

test("deleteBySourcePrefix removes a file's memories (and its FTS rows)", () => {
  const s = new SqliteStore(":memory:");
  s.upsert(rec({ id: "x::0", content: "alpha", source: "daily/x.md" }));
  s.upsert(rec({ id: "x::1", content: "beta", source: "daily/x.md" }));
  s.upsert(rec({ id: "y", content: "gamma", source: "daily/y.md" }));
  const removed = s.deleteBySourcePrefix("daily/x.md");
  assert.equal(removed, 2);
  assert.equal(s.count(), 1);
  assert.equal(s.ftsSearch("alpha", 5).length, 0);
  s.close();
});

test("toFtsQuery sanitises free text, drops stopwords, rejects empty", () => {
  assert.equal(toFtsQuery("  !! ?? "), null);
  assert.equal(toFtsQuery("how do the with"), null); // all stopwords
  assert.equal(toFtsQuery('how do I "deploy" the migration?'), '"deploy" OR "migration"');
});
