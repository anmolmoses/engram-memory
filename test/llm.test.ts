import { test } from "node:test";
import assert from "node:assert/strict";
import { llmRerank, parseOrder } from "../src/retrieval/rerank.js";
import { createLLMProvider, type LLMProvider } from "../src/llm/provider.js";
import { Engram } from "../src/index.js";
import type { RecallResult } from "../src/types.js";

function mkResult(id: string, content: string): RecallResult {
  return {
    id,
    content,
    source: null,
    tier: null,
    importance: 0.5,
    score: 0,
    scores: { rrf: 0 },
    ranks: {},
    metadata: null,
    why: "hybrid",
  };
}

test("parseOrder extracts a JSON array of valid 1-based indices", () => {
  assert.deepEqual(parseOrder("answer: [3,1,2]", 3), [3, 1, 2]);
  assert.deepEqual(parseOrder("[5, 1]", 3), [1]); // out-of-range dropped
  assert.deepEqual(parseOrder("no array here", 3), []);
  assert.deepEqual(parseOrder("[bad json", 3), []);
});

test("llmRerank reorders candidates per the LLM and tags the why-trace", async () => {
  const stub: LLMProvider = { name: "stub", async complete() { return "[3,1]"; } };
  const cands = [mkResult("a", "alpha"), mkResult("b", "beta"), mkResult("c", "gamma")];
  const out = await llmRerank(stub, "q", cands, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0]?.id, "c");
  assert.equal(out[1]?.id, "a");
  assert.match(out[0]!.why, /LLM-reranked/);
});

test("llmRerank falls back to hybrid order on unparseable output", async () => {
  const stub: LLMProvider = { name: "stub", async complete() { return "I cannot help with that"; } };
  const cands = [mkResult("a", "alpha"), mkResult("b", "beta")];
  const out = await llmRerank(stub, "q", cands, 2);
  assert.deepEqual(out.map((r) => r.id), ["a", "b"]);
});

test("llmRerank falls back gracefully when the LLM call throws", async () => {
  const stub: LLMProvider = { name: "stub", async complete() { throw new Error("cli down"); } };
  const cands = [mkResult("a", "alpha"), mkResult("b", "beta")];
  const out = await llmRerank(stub, "q", cands, 1);
  assert.deepEqual(out.map((r) => r.id), ["a"]);
});

test("createLLMProvider: undefined/none -> null; config -> instance; instance passthrough", () => {
  assert.equal(createLLMProvider(undefined), null);
  assert.equal(createLLMProvider({ provider: "none" }), null);
  const claude = createLLMProvider({ provider: "claude-cli", model: "sonnet" });
  assert.ok(claude && claude.name.includes("claude-cli"));
  const stub: LLMProvider = { name: "stub", async complete() { return ""; } };
  assert.equal(createLLMProvider(stub), stub);
});

test("Engram.recall with a stub LLM runs the rerank path end-to-end", async () => {
  const stub: LLMProvider = { name: "stub", async complete() { return "[1]"; } };
  const mem = new Engram({ dbPath: ":memory:", llm: stub });
  await mem.addMany([
    { id: "dentist", content: "dentist drill tooth painful" },
    { id: "grocery", content: "milk eggs bread grocery store" },
  ]);
  const hits = await mem.recall("dentist tooth", { k: 1, rerank: true });
  assert.equal(hits.length, 1);
  assert.match(hits[0]!.why, /LLM-reranked/);
  mem.close();
});

test("recall without an LLM ignores rerank (no crash, hybrid order)", async () => {
  const mem = new Engram({ dbPath: ":memory:" }); // no llm
  await mem.add({ id: "x", content: "deploy migration database" });
  const hits = await mem.recall("deploy migration", { k: 1, rerank: true });
  assert.equal(hits.length, 1);
  assert.doesNotMatch(hits[0]!.why, /LLM-reranked/);
  mem.close();
});
