/**
 * Stepper status emoji mapping.
 *
 * Maps the canonical 4-state step model to the universally-recognized
 * triad: ✅ done, ⏳ in progress, 🔒 locked, 🚩 needs attention.
 *
 * Used by MiniStepper, ApplicationStepper8Step, and the loan-stepper
 * server-rendered status payloads.
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type StepStatus =
  | "completed"
  | "in_progress"
  | "not_started"
  | "needs_attention";

const MAPPING: Readonly<Record<StepStatus, EmojiKey>> = Object.freeze({
  completed: "check",
  in_progress: "hourglass",
  not_started: "lock",
  needs_attention: "flag",
});

export interface StepEmojiPayload {
  readonly key: EmojiKey;
  readonly char: string;
  readonly labelEn: string;
  readonly labelSw: string;
}

/** Resolve a step's status to its display payload (char + bilingual labels). */
export function stepStatusEmoji(status: StepStatus): StepEmojiPayload {
  const key = MAPPING[status];
  return {
    key,
    char: safeEmojiChar(key),
    labelEn: emojiLabel(key, "en"),
    labelSw: emojiLabel(key, "sw"),
  };
}
