import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

test("loadConfig reads a JSON config file", () => {
  const dir = mkdtempSync(join(tmpdir(), "engram-cfg-"));
  const p = join(dir, "engram.config.json");
  writeFileSync(
    p,
    JSON.stringify({ dbPath: "x.db", rerank: true, llm: { provider: "claude-cli", model: "sonnet" } }),
  );
  const cfg = loadConfig(p);
  assert.equal(cfg.dbPath, "x.db");
  assert.equal(cfg.rerank, true);
  assert.deepEqual(cfg.llm, { provider: "claude-cli", model: "sonnet" });
});

test("loadConfig() with no file in cwd returns an empty object", () => {
  // Run from a guaranteed-empty temp dir so a deployment's engram.config.json
  // in the repo root can't leak into this assertion.
  const empty = mkdtempSync(join(tmpdir(), "engram-empty-"));
  const cwd = process.cwd();
  try {
    process.chdir(empty);
    assert.deepEqual(loadConfig(), {});
  } finally {
    process.chdir(cwd);
  }
});

test("loadConfig throws a clear error for an explicit missing path", () => {
  assert.throws(() => loadConfig(join(tmpdir(), "definitely-missing-engram-xyz.json")), /Failed to read config/);
});
