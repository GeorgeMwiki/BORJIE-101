/**
 * Compliance traffic-light emoji.
 *
 * The 🟢 🟡 🔴 triad is the canonical compliance signal across COASCO,
 * BoT, FATF dashboards. Used on officer case headers + admin compliance
 * pages to give a one-glance status.
 *
 * Risk thresholds align with the bank-grade anomaly engine: < 0.4 green,
 * 0.4-0.7 yellow, >= 0.7 red.
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type ComplianceLevel = "clear" | "watch" | "blocked";

const LEVEL_TO_KEY: Readonly<Record<ComplianceLevel, EmojiKey>> = Object.freeze(
  {
    clear: "lightGreen",
    watch: "lightYellow",
    blocked: "lightRed",
  },
);

const LEVEL_LABELS_EN: Readonly<Record<ComplianceLevel, string>> =
  Object.freeze({
    clear: "All clear",
    watch: "Watch",
    blocked: "Blocked",
  });

const LEVEL_LABELS_SW: Readonly<Record<ComplianceLevel, string>> =
  Object.freeze({
    clear: "Salama",
    watch: "Tahadhari",
    blocked: "Imezuiwa",
  });

export interface CompliancePayload {
  readonly level: ComplianceLevel;
  readonly char: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly emojiAriaLabelEn: string;
  readonly emojiAriaLabelSw: string;
}

/**
 * Convert a 0..1 risk score to a compliance level.
 * Defensive: clamps NaN / out-of-range to "watch".
 */
export function riskScoreToLevel(score: number): ComplianceLevel {
  if (!Number.isFinite(score)) return "watch";
  const clamped = Math.max(0, Math.min(1, score));
  if (clamped >= 0.7) return "blocked";
  if (clamped >= 0.4) return "watch";
  return "clear";
}

/** Resolve a level to the full display payload. */
export function complianceLight(level: ComplianceLevel): CompliancePayload {
  const key = LEVEL_TO_KEY[level];
  return {
    level,
    char: safeEmojiChar(key),
    labelEn: LEVEL_LABELS_EN[level],
    labelSw: LEVEL_LABELS_SW[level],
    emojiAriaLabelEn: emojiLabel(key, "en"),
    emojiAriaLabelSw: emojiLabel(key, "sw"),
  };
}

/** Compose a header string like "🟢 All clear (0.12)" for officer case views. */
export function complianceHeader(
  score: number,
  lang: "en" | "sw" = "en",
): string {
  const level = riskScoreToLevel(score);
  const payload = complianceLight(level);
  const label = lang === "sw" ? payload.labelSw : payload.labelEn;
  const formatted = Number.isFinite(score) ? score.toFixed(2) : "n/a";
  return `${payload.char} ${label} (${formatted})`;
}
