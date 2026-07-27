import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engram } from "../src/index.js";

// An embedding provider that counts how many texts it embeds — proves the
// incremental path skips unchanged content.
function countingEngram() {
  let embedded = 0;
  const mem = new Engram({ dbPath: ":memory:" });
  const orig = mem.embedding.embed.bind(mem.embedding);
  (mem.embedding as { embed: (t: string[]) => Promise<Float32Array[]> }).embed = async (texts: string[]) => {
    embedded += texts.length;
    return orig(texts);
  };
  return { mem, count: () => embedded };
}

test("incremental index embeds only new content, not unchanged chunks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-inc-"));
  writeFileSync(join(dir, "log.md"), "First memory about deploys.\n\nSecond memory about migrations.\n");
  const { mem, count } = countingEngram();

  const first = await mem.indexDirectory(dir, { chunk: "paragraph" });
  const afterFirst = count();
  assert.ok(afterFirst >= 2, "first index embeds all paragraphs");

  // Re-index incrementally with NO changes → nothing new should be embedded.
  const noop = await mem.indexDirectory(dir, { chunk: "paragraph", incremental: true });
  assert.equal(count(), afterFirst, "unchanged content is not re-embedded");
  assert.equal(noop.memories, 0);

  // Append a new paragraph → only that one should be embedded.
  appendFileSync(join(dir, "log.md"), "\nThird memory about rollbacks.\n");
  const inc = await mem.indexDirectory(dir, { chunk: "paragraph", incremental: true });
  assert.equal(inc.memories, 1, "only the appended paragraph is added");
  assert.equal(count(), afterFirst + 1, "exactly one new embed");

  // The new content is recallable.
  const hits = await mem.recall("rollbacks", { k: 3 });
  assert.ok(hits.some((h) => h.content.includes("rollback")));

  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("incremental index refreshes tags of unchanged text without re-embedding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-retag-"));
  const body = "Anmol asked for a 3D view of the memory graph.\n";
  writeFileSync(
    join(dir, "note.md"),
    `---\ntier: episodic\nimportance: 0.4\nmetadata:\n  emotion: neutral\n  interpretation: "Friday retained this as historical context."\n---\n\n${body}`,
  );
  const { mem, count } = countingEngram();

  await mem.indexDirectory(dir, { chunk: "file" });
  const afterFirst = count();

  // Rewrite ONLY the frontmatter — exactly what a retag/backfill does. The
  // chunk text is byte-identical, so the content hash never moves; without the
  // metadata comparison this update is invisible forever.
  writeFileSync(
    join(dir, "note.md"),
    `---\ntier: episodic\nimportance: 0.8\nmetadata:\n  emotion: pride\n  emotion_intensity: 0.7\n  interpretation: "I remember building her a 3D view of her own memory."\n---\n\n${body}`,
  );
  const res = await mem.indexDirectory(dir, { chunk: "file", incremental: true });

  assert.equal(res.memories, 0, "no chunk is re-added");
  assert.equal(count(), afterFirst, "nothing is re-embedded — the text did not change");
  assert.equal(res.retagged, 1, "the tag rewrite is reported");

  const node = mem.graphExport().nodes[0];
  assert.equal(node?.emotion, "pride");
  assert.ok(node?.interpretation?.startsWith("I remember"));
  assert.equal(node?.importance, 0.8);

  mem.close();
  rmSync(dir, { recursive: true, force: true });
});

test("incremental index prunes chunks that no longer exist in their file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-orphan-"));
  const file = join(dir, "log.md");
  writeFileSync(file, "First para.\n\nSecond para.\n\nThird para.\n");
  const { mem } = countingEngram();

  await mem.indexDirectory(dir, { chunk: "paragraph" });
  assert.equal(mem.stats().count, 3);

  // Rewrite the file with fewer paragraphs. The old chunk ids are never
  // produced again, so without pruning they'd keep serving deleted text.
  writeFileSync(file, "First para, edited.\n");
  const res = await mem.indexDirectory(dir, { chunk: "paragraph", incremental: true });

  assert.equal(mem.stats().count, 1, "orphaned chunks are gone");
  assert.ok(res.pruned >= 2, "the prune is reported");
  const hits = await mem.recall("Third para", { k: 5 });
  assert.ok(!hits.some((h) => h.content.includes("Third para")), "deleted text is not recallable");

  mem.close();
  rmSync(dir, { recursive: true, force: true });
});
