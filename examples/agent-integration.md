# Wiring engram into any agent

engram is deliberately tiny to integrate. The pattern is always the same:

1. **On startup / nightly:** index your agent's notes once (or re-index on change).
2. **Before each turn:** recall the top-k relevant memories for the incoming message.
3. **Inject** them into the system/context prompt.
4. **After the turn:** write new memories back.

## Minimal integration (any framework)

```ts
import { Engram } from "engram";

const memory = new Engram({ dbPath: "agent-memory.db" });
await memory.indexDirectory("./memories"); // run once, or when files change

// --- per turn ---
async function handleMessage(userText: string) {
  const hits = await memory.recall(userText, { k: 5, markUsed: true });
  const context = memory.toContextBlock(hits);

  const systemPrompt = [
    "You are an assistant with long-term memory.",
    context, // <- recalled memories injected here
  ].join("\n\n");

  const reply = await yourLLM.chat({ system: systemPrompt, user: userText });

  // remember salient outcomes
  await memory.add({
    content: `User asked: "${userText}". Outcome: ${summarize(reply)}`,
    tier: "episodic",
    importance: 5,
  });

  return reply;
}
```

## Upgrading to true semantic recall

The default hashing embedder is offline and lexical-ish. For "dentist" ~ "tooth pain"
semantics, pass a real provider:

```ts
const memory = new Engram({
  dbPath: "agent-memory.db",
  embedding: { provider: "openai", model: "text-embedding-3-small" }, // reads OPENAI_API_KEY
});
```

…or implement the `EmbeddingProvider` interface for a local model (e.g. `@xenova/transformers`),
Cohere, Voyage, etc. Nothing else changes.

## Exposing memory as a tool

If your agent uses tool/function calling, expose two tools backed by engram:

- `recall_memory(query, k)` → `engram.recall(query, { k })`
- `remember(text, importance, tier)` → `engram.add({ content, importance, tier })`

That gives the model explicit control over its own memory, MemGPT-style.
