/**
 * Automatic edge construction — turns a flat set of memories into an
 * associative graph using only signals already in the store (no LLM, no
 * network), in keeping with engram's zero-friction default.
 *
 * Two deterministic builders ship here:
 *
 *  - `similar`        — k-nearest-neighbour over embeddings. For each memory we
 *                       link to its top-k most cosine-similar peers above a
 *                       threshold. Edge weight = the cosine itself, so stronger
 *                       resemblances carry more activation later.
 *  - `temporal_next`  — within one source (a day-log, a session) memories form a
 *                       chain in creation order: each links to the one that
 *                       immediately followed it. This is what lets recall walk
 *                       "what happened next" even when the next note shares no
 *                       words with the query.
 *
 * Both are idempotent: edges upsert on (src,dst,type), and a reindex prunes a
 * file's old memories (cascading their edges) before re-adding, so rebuilding
 * never accumulates stale links. Richer edge types (caused / supersedes /
 * lesson_from) are LLM- or frontmatter-derived and live in later increments.
 */

import type { MemoryStore, MemoryEdge } from "../store/types.js";
import { cosine } from "../util/cosine.js";

export interface SimilarEdgeOptions {
  /** Max similar neighbours linked per memory (default 5). */
  k?: number;
  /** Minimum cosine similarity to create an edge (default 0.5). */
  minSimilarity?: number;
}

export interface EdgeBuildOptions {
  /** Build `similar` edges from embedding kNN. `true` uses defaults. Default on. */
  similar?: boolean | SimilarEdgeOptions;
  /** Build `temporal_next` edges within each source. Default on. */
  temporal?: boolean;
}

export interface EdgeBuildResult {
  similar: number;
  temporal: number;
  total: number;
}

const DEFAULT_SIMILAR: Required<SimilarEdgeOptions> = { k: 5, minSimilarity: 0.5 };

/**
 * (Re)derive automatic edges over every memory currently in the store.
 * Returns how many edges of each kind were written.
 */
export function buildEdges(store: MemoryStore, opts: EdgeBuildOptions = {}): EdgeBuildResult {
  const wantSimilar = opts.similar !== false;
  const wantTemporal = opts.temporal !== false;
  const now = Date.now();
  const edges: MemoryEdge[] = [];

  if (wantSimilar) {
    const cfg = { ...DEFAULT_SIMILAR, ...(typeof opts.similar === "object" ? opts.similar : {}) };
    edges.push(...similarEdges(store, cfg, now));
  }
  if (wantTemporal) {
    edges.push(...temporalEdges(store, now));
  }

  store.addEdges(edges);
  const similar = edges.filter((e) => e.type === "similar").length;
  const temporal = edges.filter((e) => e.type === "temporal_next").length;
  return { similar, temporal, total: edges.length };
}

/**
 * kNN over embeddings. O(n²) cosine — fine at Phase-1 scale (the vector search
 * itself is already a linear scan); swap in ANN here when the store does.
 */
function similarEdges(store: MemoryStore, cfg: Required<SimilarEdgeOptions>, now: number): MemoryEdge[] {
  const vecs = store.allVectors();
  if (vecs.length < 2) return [];
  // Only compare equal-dimension vectors (mixed embedders shouldn't cross-link).
  const out: MemoryEdge[] = [];
  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i]!;
    const scored: Array<{ id: string; score: number }> = [];
    for (let j = 0; j < vecs.length; j++) {
      if (i === j) continue;
      const b = vecs[j]!;
      if (b.dim !== a.dim) continue;
      const score = cosine(a.embedding, b.embedding);
      if (score >= cfg.minSimilarity) scored.push({ id: b.id, score });
    }
    scored.sort((x, y) => y.score - x.score);
    for (const { id, score } of scored.slice(0, cfg.k)) {
      out.push({ srcId: a.id, dstId: id, type: "similar", weight: score, createdAt: now, updatedAt: now });
    }
  }
  return out;
}

/**
 * Chain memories within each source by creation time. Direction is forward
 * (earlier → later); weight is constant 1 — the relationship is "what came
 * next", not a strength.
 */
function temporalEdges(store: MemoryStore, now: number): MemoryEdge[] {
  const records = store.allRecords().filter((r) => r.source);
  const bySource = new Map<string, Array<{ id: string; createdAt: number }>>();
  for (const r of records) {
    const arr = bySource.get(r.source!) ?? [];
    arr.push({ id: r.id, createdAt: r.createdAt });
    bySource.set(r.source!, arr);
  }
  const out: MemoryEdge[] = [];
  for (const arr of bySource.values()) {
    if (arr.length < 2) continue;
    // Stable order: createdAt, then id, so equal timestamps chain deterministically.
    arr.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (let i = 0; i < arr.length - 1; i++) {
      out.push({
        srcId: arr[i]!.id,
        dstId: arr[i + 1]!.id,
        type: "temporal_next",
        weight: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  return out;
}
