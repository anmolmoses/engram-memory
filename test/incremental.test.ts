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
