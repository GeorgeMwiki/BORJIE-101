/**
 * Voice-mode acknowledgement emoji.
 *
 * During long voice exchanges (Eleven v3 / Scribe v2), borrowers often
 * believe the system has hung. A small visual emoji acknowledgement
 * (rendered in the UI ONLY — never spoken by TTS) gives parallel
 * feedback. Maps voice-pipeline states to safe emoji.
 *
 * Critical: the AI's spoken text is NOT modified — emoji are visual
 * overlay only. ElevenLabs ignores emoji in TTS by default but we
 * defensively strip them upstream; see `voiceText()` below.
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "completed"
  | "error";

const STATE_TO_KEY: Readonly<Record<VoicePipelineState, EmojiKey>> =
  Object.freeze({
    idle: "lock",
    listening: "hourglass",
    transcribing: "hourglass",
    thinking: "thinking",
    speaking: "lightbulb",
    completed: "check",
    error: "flag",
  });

export interface VoiceAckPayload {
  readonly char: string;
  readonly labelEn: string;
  readonly labelSw: string;
}

const STATE_LABELS_EN: Readonly<Record<VoicePipelineState, string>> =
  Object.freeze({
    idle: "ready",
    listening: "listening",
    transcribing: "transcribing",
    thinking: "thinking",
    speaking: "speaking",
    completed: "done",
    error: "needs attention",
  });

const STATE_LABELS_SW: Readonly<Record<VoicePipelineState, string>> =
  Object.freeze({
    idle: "tayari",
    listening: "ninasikiliza",
    transcribing: "ninanukuu",
    thinking: "ninafikiri",
    speaking: "ninazungumza",
    completed: "imekamilika",
    error: "inahitaji uangalizi",
  });

/** Resolve a pipeline state to its visual ack payload. */
export function voiceAckEmoji(state: VoicePipelineState): VoiceAckPayload {
  const key = STATE_TO_KEY[state];
  return {
    char: safeEmojiChar(key),
    labelEn: STATE_LABELS_EN[state],
    labelSw: STATE_LABELS_SW[state],
  };
}

/** Strip emoji from text destined for TTS so the synthesizer never reads them. */
export function voiceText(text: string): string {
  // Conservative emoji + variation-selector strip. Keeps punctuation + word chars.
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "")
    .replace(/[\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** All available state keys (for exhaustive iteration in tests). */
export const VOICE_STATES: ReadonlyArray<VoicePipelineState> = Object.freeze([
  "idle",
  "listening",
  "transcribing",
  "thinking",
  "speaking",
  "completed",
  "error",
]);

/** Expose label tables for callers that already have the state. */
export function voiceStateLabel(
  state: VoicePipelineState,
  lang: "en" | "sw",
): string {
  return lang === "sw" ? STATE_LABELS_SW[state] : STATE_LABELS_EN[state];
}

/** Expose the underlying universal-set aria-label (stable across surfaces). */
export function voiceAckAriaLabel(
  state: VoicePipelineState,
  lang: "en" | "sw",
): string {
  return emojiLabel(STATE_TO_KEY[state], lang);
}
