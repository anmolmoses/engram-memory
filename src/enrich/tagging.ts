/**
 * Memory tagging — structured + emotional metadata for each memory.
 *
 * A raw captured exchange is just text. To store it the way a brain does, we
 * tag it: what KIND of memory is it (episodic event vs semantic fact vs
 * procedural how-to — the structure/tier), how IMPORTANT is it, what EMOTION
 * does it carry and how strongly, what's it ABOUT, and WHO is involved. Those
 * tags drive the short/long-term split, salience-based consolidation, and
 * affect-aware recall.
 *
 * Tagging uses the configured LLM (the user's subscription CLI). Without an LLM,
 * a safe heuristic fallback keeps everything working (episodic, neutral).
 */

import type { LLMProvider } from "../llm/provider.js";
import { emotionPalettePrompt } from "./emotions.js";
import { extractJsonArray } from "../util/json.js";

export interface MemoryTags {
  /** Structure: episodic (an event), semantic (a durable fact/rule), procedural (a how-to), working (transient). */
  tier: "episodic" | "semantic" | "procedural" | "working";
  /** Long-term importance 0..1. */
  importance: number;
  /** Emotional tone — one word from the emotion palette (see `EMOTIONS`), e.g. "frustrated", "pride", "relief". */
  emotion: string;
  /** Emotional intensity 0..1. */
  emotionIntensity: number;
  /** 1–3 word topic label. */
  topic: string;
  /** People/handles involved (lowercase, no @). */
  people: string[];
  /** One concise sentence capturing the gist. */
  summary: string;
  /** One concise sentence explaining what this memory means from the observing agent's perspective. */
  interpretation: string;
  /** The observing agent's emotional stance toward the memory, separate from the conversation's tone. */
  agentEmotion: string;
  /** Intensity of the observing agent's emotional stance, 0..1. */
  agentEmotionIntensity: number;
  /**
   * Set when the LLM was unavailable/failed and this is the neutral fallback,
   * NOT a real judgment. Callers running a salience gate must not treat these
   * scores as "judged unimportant" — the fallback's low scores would silently
   * fail the gate and the memory would be lost.
   */
  llmFailed?: true;
}

const FALLBACK: MemoryTags = {
  tier: "episodic", importance: 0.5, emotion: "neutral",
  emotionIntensity: 0, topic: "", people: [], summary: "",
  interpretation: "", agentEmotion: "neutral", agentEmotionIntensity: 0,
};

export interface MemoryTaggingContext {
  /** Agent that observed/captured the memory (for example Friday or Edith). */
  agentName?: string;
  /** Short role/personality lens used for the interpretation. */
  agentPerspective?: string;
}

function clampUnit(n: unknown, fallback = 0.5): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(1, Math.max(0, x > 1 ? x / 10 : x));
}

const VALID_TIERS = new Set(["episodic", "semantic", "procedural", "working"]);

/**
 * Cap the interpretation without slicing mid-word. An over-long reply is rare
 * (the prompt asks for 1–2 sentences), but a hard slice leaves a memory ending
 * in "if we ever touch i" — which reads as corruption in any UI showing it.
 */
export function trimToSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentenceEnd > max * 0.5) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.lastIndexOf(" ");
  return `${(wordEnd > max * 0.5 ? head.slice(0, wordEnd) : head).replace(/[,;:\s]+$/, "")}…`;
}

function coerce(o: Record<string, unknown>, fallbackSummary: string): MemoryTags {
  const tier = String(o.tier ?? "").toLowerCase();
  const people = Array.isArray(o.people)
    ? o.people.filter((p): p is string => typeof p === "string").map((p) => p.replace(/^@/, "").toLowerCase())
    : [];
  return {
    tier: (VALID_TIERS.has(tier) ? tier : "episodic") as MemoryTags["tier"],
    importance: clampUnit(o.importance),
    emotion: typeof o.emotion === "string" && o.emotion ? o.emotion.toLowerCase() : "neutral",
    emotionIntensity: clampUnit(o.emotionIntensity, 0),
    topic: typeof o.topic === "string" ? o.topic.slice(0, 60) : "",
    people,
    summary: typeof o.summary === "string" && o.summary ? o.summary : fallbackSummary,
    interpretation: typeof o.interpretation === "string" && o.interpretation
      ? trimToSentence(o.interpretation, 400)
      : fallbackSummary,
    agentEmotion: typeof o.agentEmotion === "string" && o.agentEmotion
      ? o.agentEmotion.toLowerCase()
      : "neutral",
    agentEmotionIntensity: clampUnit(o.agentEmotionIntensity, 0),
  };
}

/** Extract the first JSON array from an LLM reply (balanced-bracket scan). */
export function parseTags(resp: string): Record<string, unknown>[] {
  const arr = extractJsonArray(resp);
  if (!arr) return [];
  return arr.filter((o) => o && typeof o === "object") as Record<string, unknown>[];
}

function buildPrompt(texts: string[], context: MemoryTaggingContext): string {
  const items = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s+/g, " ").slice(0, 700)}`).join("\n");
  const observer = context.agentName?.trim() || "the observing agent";
  const perspective = context.agentPerspective?.trim();
  return (
    `You tag memories captured by ${observer} for a shared multi-agent memory system.` +
    (perspective ? ` ${observer}'s lens: ${perspective}.` : "") +
    ` For each numbered item, classify:\n` +
    `- "tier": episodic (a specific event/conversation), semantic (a durable fact/rule/preference), or procedural (a how-to/process)\n` +
    `- "importance": 0.0-1.0 — worth remembering long-term? (consequence, reusability, surprise). Calibrate: work that shipped or changed state (a fix delivered, a PR opened/merged, a deploy, a report with evidence) and decisions/commitments/requirement-changes are 0.6+; plans and in-progress work 0.5-0.6; greetings, acks, and status chatter 0.3 or less\n` +
    `- "emotion": the single lowercase emotion that best fits the observed conversation/user tone\n` +
    `- "emotionIntensity": intensity of that observed conversation emotion, 0.0-1.0\n` +
    `- "agentEmotion": the single lowercase emotion ${observer} should associate with this memory from the stated lens; this is the agent's interpretation, NOT a claim about the human's feelings\n` +
    `- "agentEmotionIntensity": intensity of the agent emotion, 0.0-1.0\n` +
    `  For both emotion fields, pick the most precise word from this palette (or the closest word if truly none fit):\n${emotionPalettePrompt()}\n` +
    `- "topic": 1-3 word label\n` +
    `- "people": array of names/handles mentioned (lowercase, no @; [] if none)\n` +
    `- "summary": one concise factual sentence describing what happened\n` +
    `- "interpretation": 1-2 sentences in ${observer}'s OWN FIRST-PERSON VOICE — "I ..." — recalling what this ` +
    `meant to her and why she'd want to remember it. Write it the way she would say it out loud later: specific, ` +
    `plain, a little opinionated, naming the people and the thing at stake. NEVER use third person, never write ` +
    `"${observer} retained/captured/recorded this", and never narrate the archiving act itself. Stay grounded in ` +
    `the text and do not invent facts. Keep it under 45 words.\n` +
    `  SPEAKER ATTRIBUTION IS NON-NEGOTIABLE: speaker labels such as **Junior:** or **Anmol:** identify who performed ` +
    `the following action or said "I". Never convert another speaker's first-person admission, decision, feeling, ` +
    `request, or action into ${observer}'s action merely because the interpretation is written in ${observer}'s ` +
    `first-person voice. ${observer} may say "I noticed Junior admitted..." or "Junior asked me...", but not "I ` +
    `admitted..." unless the source explicitly attributes that act to ${observer}. Apply the same attribution rule to ` +
    `summary, agentEmotion, and agentEmotionIntensity; the agent emotion must be how ${observer} feels about what ` +
    `actually happened, never an emotion inferred from a misassigned action.\n\n` +
    `Items:\n${items}\n\n` +
    `Reply with ONLY a JSON array, one object per item, in order. No prose.`
  );
}

/**
 * Tag a batch of memory texts. Returns one MemoryTags per input (order
 * preserved). Falls back to neutral/episodic for any item on LLM failure or a
 * short/empty reply — tagging never blocks capture.
 */
export async function tagMemories(
  llm: LLMProvider | null,
  texts: string[],
  context: MemoryTaggingContext = {},
): Promise<MemoryTags[]> {
  if (texts.length === 0) return [];
  const fallback = (t: string): MemoryTags => ({
    ...FALLBACK,
    summary: t.replace(/\s+/g, " ").slice(0, 120),
    interpretation: `${context.agentName?.trim() || "The observing agent"} captured this memory; automated interpretation was unavailable.`,
    llmFailed: true,
  });
  if (!llm) return texts.map(fallback);

  let resp: string;
  try {
    resp = await llm.complete(buildPrompt(texts, context));
  } catch {
    return texts.map(fallback);
  }
  const parsed = parseTags(resp);
  return texts.map((t, i) =>
    parsed[i] ? coerce(parsed[i]!, t.replace(/\s+/g, " ").slice(0, 120)) : fallback(t),
  );
}
