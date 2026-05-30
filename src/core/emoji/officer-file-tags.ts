/**
 * Officer file-tag emoji.
 *
 * Officers reviewing borrower files need a lightweight collab signal that
 * surfaces concerns / ideas / verifications to teammates without forcing
 * a comment thread. Modelled on Slack reacji culture (Slack 2024 survey:
 * 71% of teams use reacji to speed work).
 *
 * 4 tags. Never more — anti-clutter on case workspace.
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type OfficerTag = "risk" | "idea" | "verified" | "blocked";

export interface OfficerTagDef {
  readonly id: OfficerTag;
  readonly emoji: EmojiKey;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly tone: "warning" | "info" | "success" | "danger";
}

export const OFFICER_TAGS: ReadonlyArray<OfficerTagDef> = Object.freeze([
  {
    id: "risk",
    emoji: "flag",
    labelEn: "Risk",
    labelSw: "Hatari",
    tone: "warning",
  },
  {
    id: "idea",
    emoji: "lightbulb",
    labelEn: "Idea",
    labelSw: "Wazo",
    tone: "info",
  },
  {
    id: "verified",
    emoji: "check",
    labelEn: "Verified",
    labelSw: "Imethibitishwa",
    tone: "success",
  },
  {
    id: "blocked",
    emoji: "lock",
    labelEn: "Blocked",
    labelSw: "Imezuiwa",
    tone: "danger",
  },
]);

const TAG_BY_ID: Readonly<Record<OfficerTag, OfficerTagDef>> = Object.freeze(
  Object.fromEntries(OFFICER_TAGS.map((t) => [t.id, t])) as Record<
    OfficerTag,
    OfficerTagDef
  >,
);

/** Resolve a tag to its display payload. */
export function officerTag(id: OfficerTag): OfficerTagDef {
  const def = TAG_BY_ID[id];
  if (!def) {
    throw new Error(`Unknown officer tag: ${String(id)}`);
  }
  return def;
}

/** Plain-text rendering for case-note exports + audit trail. */
export function officerTagPrefix(
  id: OfficerTag,
  lang: "en" | "sw" = "en",
): string {
  const def = officerTag(id);
  const char = safeEmojiChar(def.emoji);
  const label = lang === "sw" ? def.labelSw : def.labelEn;
  return `${char} ${label}`;
}

/** Aria-label for a tag (used in screen-reader-friendly buttons). */
export function officerTagAriaLabel(
  id: OfficerTag,
  lang: "en" | "sw" = "en",
): string {
  const def = officerTag(id);
  const tagLabel = lang === "sw" ? def.labelSw : def.labelEn;
  const emojiName = emojiLabel(def.emoji, lang);
  return `${tagLabel} (${emojiName})`;
}
