/**
 * Application-state journey emoji.
 *
 * Maps loan-application lifecycle states to the seed → sprout → tree
 * growth metaphor. Less culturally fraught than 🟢🟡🔴 traffic light
 * (which can read as political signal in some contexts) and consistent
 * with Khan + Brilliant edtech conventions.
 *
 *   draft / submitted    → 🌱 seedling   (just planted)
 *   under review / docs  → 🌿 sprout     (growing)
 *   approved / disbursed → 🌳 tree       (thriving)
 *   rejected             → 🙏 prayer     (with care, not red)
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type ApplicationJourneyState =
  | "seed"
  | "growing"
  | "thriving"
  | "with_care";

export interface JourneyPayload {
  readonly state: ApplicationJourneyState;
  readonly char: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly tooltipEn: string;
  readonly tooltipSw: string;
}

const STATE_TO_KEY: Readonly<Record<ApplicationJourneyState, EmojiKey>> =
  Object.freeze({
    seed: "seedling",
    growing: "sprout",
    thriving: "tree",
    with_care: "prayer",
  });

const TOOLTIPS_EN: Readonly<Record<ApplicationJourneyState, string>> =
  Object.freeze({
    seed: "Your application is just starting",
    growing: "Your application is moving forward",
    thriving: "Your application is approved",
    with_care: "We are reviewing alternatives with you",
  });

const TOOLTIPS_SW: Readonly<Record<ApplicationJourneyState, string>> =
  Object.freeze({
    seed: "Maombi yako yameanza tu",
    growing: "Maombi yako yanaendelea mbele",
    thriving: "Maombi yako yameidhinishwa",
    with_care: "Tunaangalia njia mbadala pamoja nawe",
  });

/**
 * Map any Borjie application status to the journey state.
 * Intentionally loose: "rejected" routes to with_care (not red, not loud).
 */
export function applicationJourneyState(
  status: string,
): ApplicationJourneyState {
  const s = status.toLowerCase();
  if (s === "approved" || s === "disbursed") return "thriving";
  if (s === "rejected" || s === "declined") return "with_care";
  if (s === "draft" || s === "started" || s === "new") {
    return "seed";
  }
  return "growing";
}

/** Resolve the full display payload for a journey state. */
export function applicationJourneyEmoji(
  state: ApplicationJourneyState,
): JourneyPayload {
  const key = STATE_TO_KEY[state];
  return {
    state,
    char: safeEmojiChar(key),
    labelEn: emojiLabel(key, "en"),
    labelSw: emojiLabel(key, "sw"),
    tooltipEn: TOOLTIPS_EN[state],
    tooltipSw: TOOLTIPS_SW[state],
  };
}

/** Render the 4-state rail in order — for the borrower dashboard timeline. */
export function applicationJourneyRail(): ReadonlyArray<JourneyPayload> {
  return Object.freeze([
    applicationJourneyEmoji("seed"),
    applicationJourneyEmoji("growing"),
    applicationJourneyEmoji("thriving"),
    applicationJourneyEmoji("with_care"),
  ]);
}
