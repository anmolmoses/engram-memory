import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Engram } from "../src/index.js";
import { startDashboard, DASHBOARD_HTML } from "../src/index.js";

async function withServer(fn: (base: string, mem: Engram) => Promise<void>) {
  const mem = new Engram({ dbPath: ":memory:" });
  const now = Date.now();
  await mem.addMany([
    // Shared source + ordered timestamps -> a deterministic temporal_next edge.
    { id: "a", content: "prod broke when the deploy raced ahead of the DB migration", tier: "episodic", importance: 9, source: "daily/log.md", createdAt: now },
    { id: "b", content: "always run migrations before the code that depends on them", tier: "semantic", importance: 8, source: "daily/log.md", createdAt: now + 1000 },
  ]);
  mem.buildEdges();
  const server = startDashboard(mem, { port: 0 }); // 0 = ephemeral port
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, mem);
  } finally {
    server.close();
    mem.close();
  }
}

test("serves the self-contained dashboard HTML at /", async () => {
  assert.ok(DASHBOARD_HTML.includes("<canvas"), "page embeds a canvas");
  await withServer(async (base) => {
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.ok(html.includes("watch the neurons fire"));
  });
});

test("/api/graph returns nodes, edges, stats, and the emotion palette", async () => {
  await withServer(async (base) => {
    const g = await (await fetch(base + "/api/graph")).json();
    assert.equal(g.nodes.length, 2);
    assert.ok(g.edges.length >= 1);
    assert.ok(g.stats && typeof g.stats.count === "number");
    assert.ok(g.palette.pride && typeof g.palette.pride.hue === "number", "palette tints by emotion");
  });
});

test("/api/recall returns the firing neurons + spread trace", async () => {
  await withServer(async (base) => {
    const r = await (await fetch(base + "/api/recall?q=deploy%20migration&k=2")).json();
    assert.ok(r.results.length >= 1);
    assert.ok(r.results[0].id && typeof r.results[0].why === "string");
    assert.ok(r.trace && Array.isArray(r.trace.seeds));
  });
});

test("/api/maintain runs reindex; favicon is a clean 204; unknown route 404s", async () => {
  await withServer(async (base) => {
    const m = await (await fetch(base + "/api/maintain?op=reindex", { method: "POST" })).json();
    assert.match(m.message, /reindexed/);
    assert.equal((await fetch(base + "/favicon.ico")).status, 204);
    assert.equal((await fetch(base + "/nope")).status, 404);
  });
});
