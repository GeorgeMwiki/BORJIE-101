"use client";

/**
 * Sentiment-tap row at the end of teaching responses.
 *
 * 3-bucket emoji feedback (helpful / confused / inspired) gives the
 * teaching policy a richer-than-binary RLHF signal. Avoids the
 * tone-collapse failure mode of binary thumbs (CodeRabbit, 2024).
 *
 * Emits a structured signal callers route to the learning analytics
 * pipeline. NEVER calls a network primitive itself — pure UI.
 */

import * as React from "react";
import { Emoji } from "./Emoji";
import type { EmojiKey } from "./universal-set";

export type SentimentSignal = "helpful" | "confused" | "inspired";

export interface SentimentOption {
  readonly signal: SentimentSignal;
  readonly emoji: EmojiKey;
  readonly labelEn: string;
  readonly labelSw: string;
}

export const SENTIMENT_OPTIONS: ReadonlyArray<SentimentOption> = Object.freeze([
  {
    signal: "helpful",
    emoji: "thumbsUp",
    labelEn: "Helpful",
    labelSw: "Imesaidia",
  },
  {
    signal: "confused",
    emoji: "thinking",
    labelEn: "Confused",
    labelSw: "Sina uhakika",
  },
  {
    signal: "inspired",
    emoji: "lightbulb",
    labelEn: "Inspired",
    labelSw: "Nimepata mwanga",
  },
]);

export interface SentimentTapProps {
  readonly onTap: (signal: SentimentSignal) => void;
  readonly selected?: SentimentSignal | null;
  readonly lang?: "en" | "sw";
  readonly channel?: "default" | "west-africa";
  readonly className?: string;
}

export function SentimentTap({
  onTap,
  selected,
  lang = "en",
  channel = "default",
  className,
}: SentimentTapProps): React.ReactElement {
  const heading =
    lang === "sw" ? "Je, jibu hili lilikusaidia?" : "How was this answer?";

  return (
    <div
      role="group"
      aria-label={heading}
      className={`mt-2 flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}
    >
      <span className="mr-1 select-none">{heading}</span>
      {SENTIMENT_OPTIONS.map((option) => {
        const isSelected = selected === option.signal;
        const label = lang === "sw" ? option.labelSw : option.labelEn;
        return (
          <button
            key={option.signal}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onTap(option.signal)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isSelected
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-background hover:bg-muted"
            }`}
            title={label}
          >
            <Emoji
              emoji={option.emoji}
              lang={lang}
              channel={channel}
              decorative
            />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default SentimentTap;
