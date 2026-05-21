#!/usr/bin/env node
import { Engram } from "./engram.js";
import { loadConfig } from "./config.js";
import type { EmbeddingConfig } from "./embeddings/provider.js";
import type { LLMConfig } from "./llm/provider.js";

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else if (a.startsWith("-") && a.length === 2) {
      const key = a.slice(1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

const HELP = `engram — plug-and-play associative memory for any agent

USAGE
  engram <command> [options]

COMMANDS
  index <dir>          Index a directory of .md/.txt files into the memory store
  recall <query...>    Retrieve the most relevant memories for a query
  add <text...>        Add a single memory
  stats                Show index statistics
  help                 Show this help

COMMON OPTIONS
  --db <path>          SQLite file (default: $ENGRAM_DB or ./engram.db)
  --config <path>      Load settings from a JSON config (default: ./engram.config.json)
  --provider <name>    Embedding provider: hashing (default, offline) | openai
  --model <name>       Embedding model (openai), e.g. text-embedding-3-small
  --dim <n>            Embedding dimensions
  --openai-key <key>   OpenAI API key (or set OPENAI_API_KEY)

LLM OPTIONS (use your subscription — no API key)
  --llm <name>         claude | codex | none   (powers --rerank)
  --llm-model <name>   Model: claude e.g. sonnet|opus|haiku; codex e.g. gpt-5-codex
  --tmux               Invoke the LLM CLI via a silent tmux session

index OPTIONS
  --chunk <mode>       auto (default) | file | paragraph | heading
  --fresh              Wipe the index before indexing (clean rebuild)

recall OPTIONS
  -k <n>               Number of results (default: 8)
  --tier <tier>        Restrict to a tier (episodic|semantic|procedural|...)
  --rerank             Rerank candidates with the configured LLM (better recall)
  --mark-used          Bump recency/use counters on returned memories
  --json               Output raw JSON

EXAMPLES
  engram index ./memories
  engram recall "what went wrong with the last deploy?" -k 5
  engram recall "trust an agent that says it's done?" --llm claude --llm-model sonnet --rerank
  engram add "Prod broke when we skipped the migration step" --tier episodic --importance 9
  engram stats
`;

/** Build an embedding config from flags, or undefined to fall back to config/default. */
function embeddingFromFlags(flags: Record<string, string | boolean>): EmbeddingConfig | undefined {
  if (!flags.provider && !flags.dim) return undefined;
  const provider = (flags.provider as string) || "hashing";
  const dim = flags.dim ? Number(flags.dim) : undefined;
  if (provider === "openai") {
    return {
      provider: "openai",
      apiKey: (flags["openai-key"] as string) || process.env.OPENAI_API_KEY,
      model: (flags.model as string) || undefined,
      dim,
    };
  }
  return { provider: "hashing", dim };
}

/** Build an LLM config from flags, or undefined to fall back to config/none. */
function llmFromFlags(flags: Record<string, string | boolean>): LLMConfig | undefined {
  const llm = flags.llm as string | undefined;
  if (!llm) return undefined;
  if (llm === "none") return { provider: "none" };
  const model = (flags["llm-model"] as string) || undefined;
  const useTmux = Boolean(flags.tmux);
  if (llm === "claude" || llm === "claude-cli") return { provider: "claude-cli", model, useTmux };
  if (llm === "codex" || llm === "codex-cli") return { provider: "codex-cli", model, useTmux };
  return undefined;
}

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || cmd === "help" || flags.help) {
    process.stdout.write(HELP);
    return;
  }

  const config = loadConfig(flags.config as string | undefined);
  const dbPath = (flags.db as string) || config.dbPath || process.env.ENGRAM_DB || "engram.db";
  const engram = new Engram({
    dbPath,
    embedding: embeddingFromFlags(flags) ?? config.embedding,
    llm: llmFromFlags(flags) ?? config.llm,
  });

  try {
    switch (cmd) {
      case "index": {
        const dir = positionals[1];
        if (!dir) throw new Error("index requires a <dir> argument");
        const res = await engram.indexDirectory(dir, {
          chunk: (flags.chunk as never) || "auto",
          fresh: Boolean(flags.fresh),
        });
        process.stdout.write(
          `Indexed ${res.memories} memories from ${res.files} files ` +
            `in ${res.directory} (${res.durationMs}ms, pruned ${res.pruned}, model ${res.embeddingModel}).\n`,
        );
        break;
      }

      case "recall": {
        const query = positionals.slice(1).join(" ");
        if (!query) throw new Error('recall requires a query, e.g. recall "how do I X"');
        const rerank = flags.rerank !== undefined ? Boolean(flags.rerank) : Boolean(config.rerank);
        if (rerank && !engram.llm) {
          process.stderr.write("Note: --rerank requested but no LLM configured; using hybrid order.\n");
        }
        const results = await engram.recall(query, {
          k: flags.k ? Number(flags.k) : undefined,
          tier: (flags.tier as string) || undefined,
          markUsed: Boolean(flags["mark-used"]),
          rerank,
        });
        if (flags.json) {
          process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
          break;
        }
        if (results.length === 0) {
          process.stdout.write("No memories found.\n");
          break;
        }
        process.stdout.write(`\nTop ${results.length} memories for: "${query}"\n\n`);
        results.forEach((r, i) => {
          const snippet = r.content.replace(/\s+/g, " ").slice(0, 240);
          process.stdout.write(
            `${i + 1}. [score ${r.score.toFixed(4)}] ${snippet}\n` +
              `   ↳ ${r.why}${r.source ? ` · ${r.source}` : ""}\n\n`,
          );
        });
        break;
      }

      case "add": {
        const text = positionals.slice(1).join(" ");
        if (!text) throw new Error("add requires text");
        const id = await engram.add({
          content: text,
          source: (flags.source as string) || null,
          tier: (flags.tier as string) || null,
          importance: flags.importance ? Number(flags.importance) : undefined,
        });
        process.stdout.write(flags.json ? `${JSON.stringify({ id })}\n` : `Added memory ${id}\n`);
        break;
      }

      case "stats": {
        const s = engram.stats();
        process.stdout.write(`${JSON.stringify(s, null, 2)}\n`);
        break;
      }

      default:
        process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exitCode = 1;
    }
  } finally {
    engram.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
