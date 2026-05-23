import { test } from "node:test";
import assert from "node:assert/strict";
import { tagMemories, parseTags } from "../src/enrich/tagging.js";
import { Engram } from "../src/index.js";
import type { LLMProvider } from "../src/llm/provider.js";

test("parseTags extracts a JSON array, ignores junk", () => {
  assert.equal(parseTags("ok: [{\"tier\":\"semantic\"}]").length, 1);
  assert.deepEqual(parseTags("no json"), []);
});

test("tagMemories: LLM tags are coerced + clamped; order preserved", async () => {
  const stub: LLMProvider = {
    name: "stub",
    async complete() {
      return JSON.stringify([
        { tier: "semantic", importance: 9, emotion: "Proud", emotionIntensity: 0.8, topic: "deploy rule", people: ["@Anmol"], summary: "a rule" },
        { tier: "bogus", importance: 2, emotion: "", emotionIntensity: 50, topic: "x", people: "nope", summary: "" },
      ]);
    },
  };
  const tags = await tagMemories(stub, ["always migrate first", "lunch"]);
  assert.equal(tags.length, 2);
  // item 1: importance 9 → 0.9 (1..10 scale); emotion lowercased; @ stripped
  assert.equal(tags[0]!.tier, "semantic");
  assert.equal(tags[0]!.importance, 0.9);
  assert.equal(tags[0]!.emotion, "proud");
  assert.deepEqual(tags[0]!.people, ["anmol"]);
  // item 2: invalid tier → episodic; intensity clamped to 1; emotion default; bad people → []
  assert.equal(tags[1]!.tier, "episodic");
  assert.equal(tags[1]!.emotionIntensity, 1);
  assert.equal(tags[1]!.emotion, "neutral");
  assert.deepEqual(tags[1]!.people, []);
});

test("tagMemories falls back to neutral/episodic without an LLM or on failure", async () => {
  const noLlm = await tagMemories(null, ["something happened"]);
  assert.equal(noLlm[0]!.tier, "episodic");
  assert.equal(noLlm[0]!.emotion, "neutral");
  assert.ok(noLlm[0]!.summary.length > 0);

  const thrower: LLMProvider = { name: "x", async complete() { throw new Error("down"); } };
  const failed = await tagMemories(thrower, ["a", "b"]);
  assert.equal(failed.length, 2);
  assert.ok(failed.every((t) => t.tier === "episodic"));
});

test("Engram.tagMemories runs through the configured LLM", async () => {
  const stub: LLMProvider = { name: "stub", async complete() { return '[{"tier":"procedural","importance":0.6,"emotion":"neutral","emotionIntensity":0,"topic":"howto","people":[],"summary":"steps"}]'; } };
  const mem = new Engram({ dbPath: ":memory:", llm: stub });
  const [tag] = await mem.tagMemories(["to deploy, run the migration first"]);
  assert.equal(tag!.tier, "procedural");
  assert.equal(tag!.topic, "howto");
  mem.close();
});
