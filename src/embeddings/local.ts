import { l2normalize } from "../util/cosine.js";
import type { EmbeddingProvider } from "./provider.js";

/** Output width of the models we ship defaults for, so `dim` needn't be configured. */
const MODEL_DIMS: Record<string, number> = {
  "Xenova/all-MiniLM-L6-v2": 384,
  "Xenova/all-MiniLM-L12-v2": 384,
  "Xenova/bge-small-en-v1.5": 384,
  "Xenova/bge-base-en-v1.5": 768,
  "Xenova/gte-small": 384,
  "Xenova/all-mpnet-base-v2": 768,
};

/**
 * Character budget per input. These encoders cap at 512 tokens and truncate
 * anyway; slicing first keeps a huge chunk from dominating a batch's runtime.
 */
const MAX_EMBED_CHARS = 8_000;

/** Inputs per forward pass. Small batches keep peak memory flat on a laptop. */
const BATCH = 16;

export interface LocalEmbeddingOptions {
  /** Hugging Face model id (ONNX weights), default Xenova/all-MiniLM-L6-v2. */
  model?: string;
  dim?: number;
  /** Cache dir for downloaded weights (default: transformers.js's own cache). */
  cacheDir?: string;
}

// Minimal structural types — we never import transformers.js types at build
// time, since it's an optional dependency that may not be installed.
type Tensor = { data: ArrayLike<number>; dims: number[] };
type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<Tensor>;

/**
 * Real semantic embeddings from a local ONNX model — no API key, no network
 * after the first run, no per-call cost.
 *
 * This is the recommended upgrade from the hashing provider for anyone who
 * wants "dentist" to match "tooth pain" without renting an embeddings API.
 * Weights are downloaded once (~90MB for MiniLM) and cached on disk; every
 * later run is fully offline.
 *
 * `@huggingface/transformers` is an OPTIONAL dependency: engram still installs
 * and runs (hashing/openai) without it. The import is lazy so the cost — and
 * the requirement — only lands when this provider is actually used.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  private readonly model: string;
  private readonly cacheDir?: string;
  private extractor?: Promise<Extractor>;

  constructor(opts: LocalEmbeddingOptions = {}) {
    this.model = opts.model ?? "Xenova/all-MiniLM-L6-v2";
    this.dim = opts.dim ?? MODEL_DIMS[this.model] ?? 384;
    this.cacheDir = opts.cacheDir;
    this.name = `local:${this.model}@${this.dim}`;
  }

  /** Load the model once per process; later calls reuse the same pipeline. */
  private pipeline(): Promise<Extractor> {
    if (!this.extractor) {
      this.extractor = (async () => {
        let mod: { pipeline: (task: string, model: string, opts?: unknown) => Promise<Extractor>; env?: Record<string, unknown> };
        try {
          mod = (await import("@huggingface/transformers")) as never;
        } catch (e) {
          throw new Error(
            "LocalEmbeddingProvider needs the optional dependency @huggingface/transformers " +
              `(npm i @huggingface/transformers). Original error: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (this.cacheDir && mod.env) mod.env.cacheDir = this.cacheDir;
        return mod.pipeline("feature-extraction", this.model);
      })();
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extract = await this.pipeline();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts
        .slice(i, i + BATCH)
        // An empty string yields NaNs after mean-pooling, which then poison
        // every cosine it touches. A single space embeds cleanly instead.
        .map((t) => (t.trim() ? t.slice(0, MAX_EMBED_CHARS) : " "));
      const tensor = await extract(batch, { pooling: "mean", normalize: true });
      const width = tensor.dims[tensor.dims.length - 1] ?? this.dim;
      if (width !== this.dim) {
        throw new Error(
          `Local model ${this.model} returned ${width}-dim vectors but the provider is configured for ${this.dim}. ` +
            "Set the matching `dim` in your config (and reindex).",
        );
      }
      for (let row = 0; row < batch.length; row++) {
        const vec = new Float32Array(width);
        for (let c = 0; c < width; c++) vec[c] = Number(tensor.data[row * width + c]);
        // Already normalised by the pipeline; re-normalising is cheap and keeps
        // the contract true regardless of what a swapped-in model returns.
        out.push(l2normalize(vec));
      }
    }
    return out;
  }
}
