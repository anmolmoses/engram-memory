#!/usr/bin/env node
import { Engram } from "./engram.js";
import type { EmbeddingConfig } from "./embeddings/provider.js";

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
  --provider <name>    Embedding provider: hashing (default, offline) | openai
  --model <name>       Embedding model (openai), e.g. text-embedding-3-small
  --dim <n>            Embedding dimensions
  --openai-key <key>   OpenAI API key (or set OPENAI_API_KEY)

index OPTIONS
  --chunk <mode>       auto (default) | file | paragraph | heading
  --fresh              Wipe the index before indexing (clean rebuild)

recall OPTIONS
  -k <n>               Number of results (default: 8)
  --tier <tier>        Restrict to a tier (episodic|semantic|procedural|...)
  --mark-used          Bump recency/use counters on returned memories
  --json               Output raw JSON

EXAMPLES
  engram index ./memories
  engram recall "what went wrong with the last deploy?" -k 5
  engram add "Prod broke when we skipped the migration step" --tier episodic --importance 9
  engram stats
`;

function embeddingFromFlags(flags: Record<string, string | boolean>): EmbeddingConfig {
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

async function main(): Promise<void> {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (!cmd || cmd === "help" || flags.help) {
    process.stdout.write(HELP);
    return;
  }

  const dbPath = (flags.db as string) || process.env.ENGRAM_DB || "engram.db";
  const engram = new Engram({ dbPath, embedding: embeddingFromFlags(flags) });

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
        const results = await engram.recall(query, {
          k: flags.k ? Number(flags.k) : undefined,
          tier: (flags.tier as string) || undefined,
          markUsed: Boolean(flags["mark-used"]),
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
