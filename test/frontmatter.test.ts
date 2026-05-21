import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../src/util/frontmatter.js";

test("parses frontmatter with nested metadata and coerces scalars", () => {
  const { data, body } = parseFrontmatter(
    `---\nname: foo\nimportance: 8\nactive: true\nmetadata:\n  type: semantic\n---\nhello world`,
  );
  assert.equal(data.name, "foo");
  assert.equal(data.importance, 8);
  assert.equal(data.active, true);
  assert.deepEqual(data.metadata, { type: "semantic" });
  assert.equal(body.trim(), "hello world");
});

test("no frontmatter returns whole text as body", () => {
  const { data, body } = parseFrontmatter("just text\n\nmore text");
  assert.equal(Object.keys(data).length, 0);
  assert.match(body, /just text/);
});

test("strips quotes from values", () => {
  const { data } = parseFrontmatter(`---\ntitle: "quoted value"\n---\nx`);
  assert.equal(data.title, "quoted value");
});
