/**
 * Borjie Universal Emoji Set
 *
 * Cross-cultural-safe emoji subset with bilingual aria-labels. Every emoji
 * here passed cultural review per Pumble + Remitly's regional matrix and
 * carries an explicit screen-reader name (WCAG H86 + ARIA6).
 *
 * Banned emoji are NOT exported. Conditional emoji (e.g. thumbs-up) are
 * kept but flagged so callers can swap them on West-Africa channels.
 *
 * Pure constants. No runtime mutation.
 */

export type EmojiKey =
  | "heart"
  | "lightbulb"
  | "thinking"
  | "prayer"
  | "seedling"
  | "sprout"
  | "tree"
  | "party"
  | "trophy"
  | "check"
  | "hourglass"
  | "lock"
  | "flag"
  | "inbox"
  | "alert"
  | "lightGreen"
  | "lightYellow"
  | "lightRed"
  | "thumbsUp"
  | "confused"
  | "inspired";

export interface EmojiDef {
  readonly key: EmojiKey;
  readonly char: string;
  readonly labelEn: string;
  readonly labelSw: string;
  /** True if this emoji has known cross-cultural risk and should be swapped on certain channels. */
  readonly conditional: boolean;
}

const DEFS: Readonly<Record<EmojiKey, EmojiDef>> = Object.freeze({
  heart: {
    key: "heart",
    char: "❤️",
    labelEn: "love",
    labelSw: "upendo",
    conditional: false,
  },
  lightbulb: {
    key: "lightbulb",
    char: "💡",
    labelEn: "idea",
    labelSw: "wazo",
    conditional: false,
  },
  thinking: {
    key: "thinking",
    char: "🤔",
    labelEn: "thinking",
    labelSw: "kufikiria",
    conditional: false,
  },
  prayer: {
    key: "prayer",
    char: "🙏",
    labelEn: "thank you",
    labelSw: "asante",
    conditional: false,
  },
  seedling: {
    key: "seedling",
    char: "🌱",
    labelEn: "starting out",
    labelSw: "kuanza",
    conditional: false,
  },
  sprout: {
    key: "sprout",
    char: "🌿",
    labelEn: "growing",
    labelSw: "kukua",
    conditional: false,
  },
  tree: {
    key: "tree",
    char: "🌳",
    labelEn: "thriving",
    labelSw: "kufanikiwa",
    conditional: false,
  },
  party: {
    key: "party",
    char: "🎉",
    labelEn: "celebration",
    labelSw: "sherehe",
    conditional: false,
  },
  trophy: {
    key: "trophy",
    char: "🏆",
    labelEn: "milestone",
    labelSw: "hatua kuu",
    conditional: false,
  },
  check: {
    key: "check",
    char: "✅",
    labelEn: "complete",
    labelSw: "imekamilika",
    conditional: false,
  },
  hourglass: {
    key: "hourglass",
    char: "⏳",
    labelEn: "in progress",
    labelSw: "inaendelea",
    conditional: false,
  },
  lock: {
    key: "lock",
    char: "🔒",
    labelEn: "locked",
    labelSw: "imefungwa",
    conditional: false,
  },
  flag: {
    key: "flag",
    char: "🚩",
    labelEn: "needs attention",
    labelSw: "inahitaji uangalizi",
    conditional: false,
  },
  inbox: {
    key: "inbox",
    char: "📥",
    labelEn: "inbox",
    labelSw: "kikasha",
    conditional: false,
  },
  alert: {
    key: "alert",
    char: "🚨",
    labelEn: "action needed",
    labelSw: "hatua inahitajika",
    conditional: false,
  },
  lightGreen: {
    key: "lightGreen",
    char: "🟢",
    labelEn: "all clear",
    labelSw: "salama",
    conditional: false,
  },
  lightYellow: {
    key: "lightYellow",
    char: "🟡",
    labelEn: "caution",
    labelSw: "tahadhari",
    conditional: false,
  },
  lightRed: {
    key: "lightRed",
    char: "🔴",
    labelEn: "blocked",
    labelSw: "imezuiwa",
    conditional: false,
  },
  thumbsUp: {
    key: "thumbsUp",
    char: "👍",
    labelEn: "helpful",
    labelSw: "imesaidia",
    conditional: true,
  },
  confused: {
    key: "confused",
    char: "🤔",
    labelEn: "confused",
    labelSw: "sina uhakika",
    conditional: false,
  },
  inspired: {
    key: "inspired",
    char: "💡",
    labelEn: "inspired",
    labelSw: "nimepata mwanga",
    conditional: false,
  },
});

/** Frozen list of every supported emoji. */
export const UNIVERSAL_EMOJI: ReadonlyArray<EmojiDef> = Object.freeze(
  Object.values(DEFS),
);

/** Resolve a single emoji definition by key. Throws on unknown key. */
export function getEmoji(key: EmojiKey): EmojiDef {
  const def = DEFS[key];
  if (!def) {
    throw new Error(`Unknown emoji key: ${String(key)}`);
  }
  return def;
}

/** Look up an aria-label in the requested language; falls back to English. */
export function emojiLabel(key: EmojiKey, lang: "en" | "sw"): string {
  const def = getEmoji(key);
  return lang === "sw" ? def.labelSw : def.labelEn;
}

/**
 * Channel-safe character for a key. On West-Africa SMS / WhatsApp channels,
 * `thumbsUp` is rewritten to `check` (✅) per regional cultural matrix.
 */
export function safeEmojiChar(
  key: EmojiKey,
  channel: "default" | "west-africa" = "default",
): string {
  if (channel === "west-africa" && key === "thumbsUp") {
    return DEFS.check.char;
  }
  return getEmoji(key).char;
}
