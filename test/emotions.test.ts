import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMOTIONS, EMOTION_FAMILIES, emotionInfo, emotionValence, isKnownEmotion, emotionPalettePrompt,
} from "../src/enrich/emotions.js";

test("the palette is comprehensive and de-duplicated", () => {
  // A genuinely broad human-emotion vocabulary, not just six basics.
  assert.ok(EMOTIONS.length > 120, `expected a rich palette, got ${EMOTIONS.length}`);
  assert.equal(EMOTIONS.length, new Set(EMOTIONS).size, "no duplicate emotions");
  // Spans the major families and valences.
  for (const e of ["joy", "love", "gratitude", "pride", "hope", "sadness", "fear", "anger", "disgust", "shame", "envy", "nostalgia", "awe", "boredom", "neutral"]) {
    assert.ok(isKnownEmotion(e), `palette should include "${e}"`);
  }
});

test("emotionInfo / valence resolve family, hue, and valence", () => {
  assert.equal(emotionValence("pride"), "positive");
  assert.equal(emotionValence("grief"), "negative");
  assert.equal(emotionValence("neutral"), "neutral");
  assert.equal(emotionValence("definitely-not-an-emotion"), "neutral"); // safe default
  const info = emotionInfo("FRUSTRATION ");
  assert.equal(info?.family, "anger");
  assert.equal(typeof info?.hue, "number");
});

test("the prompt palette lists every family and member", () => {
  const p = emotionPalettePrompt();
  for (const fam of EMOTION_FAMILIES) {
    assert.ok(p.includes(fam.key + ":"), `prompt should name family ${fam.key}`);
    for (const m of fam.members) assert.ok(p.includes(m), `prompt should list ${m}`);
  }
});
