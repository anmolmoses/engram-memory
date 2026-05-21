/**
 * Quickstart — run with:  npx tsx examples/quickstart.ts
 *
 * Uses an in-memory database and the offline hashing embedder, so it needs
 * zero setup and zero API keys.
 */
import { Engram } from "../src/index.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const mem = new Engram({ dbPath: ":memory:" });

  // 1. Index the bundled sample memories (markdown across episodic/semantic/procedural tiers).
  const result = await mem.indexDirectory(join(here, "..", "sample-memories"));
  console.log(`Indexed ${result.memories} memories from ${result.files} files.\n`);

  // 2. Add one more memory programmatically.
  await mem.add({
    content: "The welcome email still references the old pricing tier; needs updating.",
    tier: "episodic",
    importance: 5,
  });

  // 3. Recall — note we never mention "migration" by that exact phrasing.
  const queries = [
    "why did production go down after a release?",
    "how do I set up a new member with admin access?",
    "can I trust an agent that says it finished a task?",
  ];

  for (const q of queries) {
    const hits = await mem.recall(q, { k: 2 });
    console.log(`Q: ${q}`);
    for (const h of hits) {
      console.log(`   • [${h.score.toFixed(3)}] ${h.content.slice(0, 90)}...`);
      console.log(`     ↳ ${h.why}`);
    }
    console.log();
  }

  // 4. Build a prompt-ready context block from the best hits.
  const top = await mem.recall("deploy incident migration", { k: 3 });
  console.log("--- context block to inject into an agent prompt ---");
  console.log(mem.toContextBlock(top));

  mem.close();
}

main();
