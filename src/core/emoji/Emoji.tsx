"use client";

/**
 * <Emoji /> — accessible emoji primitive.
 *
 * Renders a Unicode emoji wrapped in role="img" + aria-label so screen
 * readers announce a meaningful name (per WCAG H86 / ARIA6). Visual
 * emoji are decorative by default; pass `aria-hidden` for purely decorative
 * uses where a sibling already conveys the meaning.
 *
 * Pure presentational. No state. No mutation.
 */

import * as React from "react";
import {
  emojiLabel,
  getEmoji,
  safeEmojiChar,
  type EmojiKey,
} from "./universal-set";

export interface EmojiProps {
  readonly emoji: EmojiKey;
  readonly lang?: "en" | "sw";
  readonly channel?: "default" | "west-africa";
  /**
   * Override the aria-label. Use sparingly; prefer the universal-set label
   * unless the emoji's contextual meaning differs from its default label.
   */
  readonly label?: string;
  /** When true, emoji is hidden from assistive tech (decorative only). */
  readonly decorative?: boolean;
  readonly className?: string;
}

export function Emoji({
  emoji,
  lang = "en",
  channel = "default",
  label,
  decorative = false,
  className,
}: EmojiProps): React.ReactElement {
  const char = safeEmojiChar(emoji, channel);
  const resolvedLabel = label ?? emojiLabel(emoji, lang);

  if (decorative) {
    return (
      <span aria-hidden="true" className={className}>
        {char}
      </span>
    );
  }

  return (
    <span role="img" aria-label={resolvedLabel} className={className}>
      {char}
    </span>
  );
}

/** Convenience: returns just the unicode char for an emoji key (no JSX). */
export function emojiChar(
  key: EmojiKey,
  channel: "default" | "west-africa" = "default",
): string {
  return safeEmojiChar(key, channel);
}

/** Convenience: returns "char  Title" string for plain-text surfaces. */
export function emojiPrefix(
  key: EmojiKey,
  text: string,
  channel: "default" | "west-africa" = "default",
): string {
  return `${safeEmojiChar(key, channel)} ${text}`;
}

export default Emoji;
export { getEmoji };
