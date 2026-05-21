import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestDirectory, chunkContent } from "../src/ingest/markdown.js";

test("chunkContent splits per strategy", () => {
  assert.equal(chunkContent("a\n\nb\n\nc", "paragraph").length, 3);
  assert.equal(chunkContent("a\n\nb", "file").length, 1);
  assert.equal(chunkContent("# H1\nx\n# H2\ny", "heading").length, 2);
});

test("ingestDirectory: frontmatter file = 1 memory, plain log = paragraphs", () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-ingest-"));
  writeFileSync(
    join(dir, "fm.md"),
    `---\nname: lesson\nimportance: 7\nmetadata:\n  type: semantic\n---\nbody one paragraph only`,
  );
  writeFileSync(join(dir, "log.md"), `entry one happened\n\nentry two happened`);

  const mems = ingestDirectory(dir);
  assert.equal(mems.length, 3); // 1 + 2

  const semantic = mems.find((m) => m.tier === "semantic");
  assert.ok(semantic, "frontmatter type should map to tier");
  assert.equal(semantic?.id, "lesson");
  assert.equal(semantic?.importance, 7);

  const logChunks = mems.filter((m) => m.source === "log.md");
  assert.equal(logChunks.length, 2);
  assert.notEqual(logChunks[0]?.id, logChunks[1]?.id); // distinct chunk ids
});
