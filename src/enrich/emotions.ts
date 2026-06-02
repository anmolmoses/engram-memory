/**
 * Emotion taxonomy — a comprehensive palette of human emotions the tagger can
 * assign to a memory, plus the metadata the dashboard uses to tint a "neuron"
 * by how it feels.
 *
 * Memories aren't affect-neutral: a prod outage is remembered with stress, a
 * shipped feature with pride, a kind word with warmth. Tagging that lets recall
 * and consolidation be affect-aware, and lets the visualiser colour the graph
 * by mood. The old tagger only suggested a handful of words to the LLM, so it
 * picked arbitrary, inconsistent labels. This module gives it a real vocabulary
 * grounded in emotion research (Plutchik's wheel + Cowen & Keltner's 27
 * categories + everyday affect terms), grouped into families with a valence and
 * a hue so colouring is consistent.
 *
 * The palette is broad on purpose — the goal is to cover the full range of what
 * a person actually feels, not just six "basic" emotions.
 */

export type Valence = "positive" | "negative" | "neutral" | "ambivalent";

export interface EmotionFamily {
  /** Family label (also a valid emotion in its own right). */
  key: string;
  valence: Valence;
  /** Base hue (0–360) for dashboard tinting; saturation scales with intensity. */
  hue: number;
  /** Emotions belonging to this family, fine- to coarse-grained. */
  members: string[];
}

/**
 * The full taxonomy, by family. Order matters only for display; lookup is by
 * member name. Families share a hue so the graph reads as mood-coloured regions.
 */
export const EMOTION_FAMILIES: EmotionFamily[] = [
  { key: "joy", valence: "positive", hue: 48, members: [
    "joy", "happiness", "delight", "glee", "cheerfulness", "elation",
    "euphoria", "ecstasy", "bliss", "jubilation", "pleasure", "enjoyment" ] },
  { key: "amusement", valence: "positive", hue: 52, members: [
    "amusement", "playfulness", "mirth", "silliness", "lightheartedness" ] },
  { key: "love", valence: "positive", hue: 332, members: [
    "love", "affection", "tenderness", "warmth", "fondness", "adoration",
    "compassion", "empathy", "caring", "intimacy", "attraction", "desire",
    "infatuation", "romance" ] },
  { key: "gratitude", valence: "positive", hue: 96, members: [
    "gratitude", "thankfulness", "appreciation", "indebtedness" ] },
  { key: "pride", valence: "positive", hue: 286, members: [
    "pride", "triumph", "accomplishment", "confidence", "self-assurance",
    "satisfaction", "vindication" ] },
  { key: "admiration", valence: "positive", hue: 270, members: [
    "admiration", "respect", "reverence", "esteem" ] },
  { key: "awe", valence: "ambivalent", hue: 264, members: [
    "awe", "wonder", "amazement", "fascination" ] },
  { key: "hope", valence: "positive", hue: 156, members: [
    "hope", "optimism", "anticipation", "eagerness", "enthusiasm", "excitement",
    "exhilaration", "inspiration", "motivation", "determination", "zeal" ] },
  { key: "interest", valence: "neutral", hue: 200, members: [
    "interest", "curiosity", "intrigue", "engagement", "focus", "alertness",
    "contemplation", "concentration" ] },
  { key: "serenity", valence: "positive", hue: 186, members: [
    "serenity", "calmness", "contentment", "peace", "tranquility", "relaxation",
    "relief", "ease", "comfort", "reassurance" ] },
  { key: "surprise", valence: "ambivalent", hue: 60, members: [
    "surprise", "astonishment", "shock", "startle", "disbelief", "realization" ] },
  { key: "nostalgia", valence: "ambivalent", hue: 28, members: [
    "nostalgia", "sentimentality", "wistfulness", "longing", "yearning",
    "homesickness" ] },
  { key: "sadness", valence: "negative", hue: 220, members: [
    "sadness", "sorrow", "grief", "despair", "hopelessness", "disappointment",
    "melancholy", "loneliness", "heartbreak", "gloom", "dejection", "misery",
    "anguish", "mourning", "regret" ] },
  { key: "fear", valence: "negative", hue: 276, members: [
    "fear", "anxiety", "nervousness", "worry", "dread", "apprehension",
    "panic", "terror", "horror", "unease", "insecurity", "vulnerability",
    "trepidation" ] },
  { key: "stress", valence: "negative", hue: 14, members: [
    "stress", "overwhelm", "pressure", "tension", "distress", "helplessness",
    "burnout", "exhaustion", "frazzled" ] },
  { key: "anger", valence: "negative", hue: 2, members: [
    "anger", "frustration", "irritation", "annoyance", "rage", "fury",
    "resentment", "indignation", "hostility", "bitterness", "exasperation",
    "outrage", "agitation" ] },
  { key: "disgust", valence: "negative", hue: 104, members: [
    "disgust", "revulsion", "distaste", "aversion", "loathing", "contempt",
    "disdain", "scorn" ] },
  { key: "shame", valence: "negative", hue: 22, members: [
    "shame", "guilt", "embarrassment", "humiliation", "remorse",
    "self-consciousness", "mortification", "sheepishness" ] },
  { key: "envy", valence: "negative", hue: 116, members: [
    "envy", "jealousy", "covetousness" ] },
  { key: "confusion", valence: "neutral", hue: 290, members: [
    "confusion", "doubt", "uncertainty", "ambivalence", "conflicted",
    "skepticism", "suspicion", "distrust", "hesitation", "bewilderment" ] },
  { key: "boredom", valence: "negative", hue: 210, members: [
    "boredom", "apathy", "indifference", "disinterest", "weariness", "fatigue",
    "numbness", "listlessness", "restlessness" ] },
  { key: "neutral", valence: "neutral", hue: 0, members: [ "neutral" ] },
];

interface EmotionInfo {
  family: string;
  valence: Valence;
  hue: number;
}

const META = new Map<string, EmotionInfo>();
for (const fam of EMOTION_FAMILIES) {
  for (const m of fam.members) {
    if (!META.has(m)) META.set(m, { family: fam.key, valence: fam.valence, hue: fam.hue });
  }
}

/** Every emotion in the palette, flat and de-duplicated (lowercase). */
export const EMOTIONS: string[] = [...META.keys()];

/** Look up an emotion's family/valence/hue, or undefined if unknown. */
export function emotionInfo(emotion: string | undefined | null): EmotionInfo | undefined {
  if (!emotion) return undefined;
  return META.get(emotion.trim().toLowerCase());
}

/** Coarse valence for an emotion (defaults to neutral if unrecognised). */
export function emotionValence(emotion: string | undefined | null): Valence {
  return emotionInfo(emotion)?.valence ?? "neutral";
}

/** Whether a label is a recognised palette emotion. */
export function isKnownEmotion(emotion: string): boolean {
  return META.has(emotion.trim().toLowerCase());
}

/**
 * A compact, grouped rendering of the palette for an LLM prompt — families on
 * one line each so the model sees the full range without a giant flat list.
 */
export function emotionPalettePrompt(): string {
  return EMOTION_FAMILIES.map((f) => `  ${f.key}: ${f.members.join(", ")}`).join("\n");
}
