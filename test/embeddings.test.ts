import { test } from "node:test";
import assert from "node:assert/strict";
import { HashingEmbeddingProvider } from "../src/embeddings/hashing.js";
import { cosine } from "../src/util/cosine.js";

test("hashing embeddings are deterministic, normalised, correct dim", async () => {
  const p = new HashingEmbeddingProvider(128);
  assert.equal(p.dim, 128);
  const [a] = await p.embed(["the dentist drilled my tooth"]);
  const [b] = await p.embed(["the dentist drilled my tooth"]);
  assert.ok(a && b);
  assert.deepEqual(Array.from(a), Array.from(b)); // deterministic
  assert.equal(a.length, 128);
  let norm = 0;
  for (const x of a) norm += x * x;
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6); // L2-normalised
});

test("token-overlapping texts are more similar than unrelated ones", async () => {
  const p = new HashingEmbeddingProvider(512);
  const [dentistA] = await p.embed(["dentist drill tooth pain root canal"]);
  const [dentistB] = await p.embed(["the dentist used a drill on my painful tooth"]);
  const [groceries] = await p.embed(["bought milk eggs and bread at the grocery store"]);
  assert.ok(dentistA && dentistB && groceries);
  assert.ok(cosine(dentistA, dentistB) > cosine(dentistA, groceries));
});
