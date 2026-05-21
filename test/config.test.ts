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
  // The repo ships engram.config.example.json (not auto-loaded), so cwd has no
  // engram.config.json during tests.
  assert.deepEqual(loadConfig(), {});
});

test("loadConfig throws a clear error for an explicit missing path", () => {
  assert.throws(() => loadConfig(join(tmpdir(), "definitely-missing-engram-xyz.json")), /Failed to read config/);
});
