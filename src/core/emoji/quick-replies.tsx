"use client";

/**
 * Emoji-only quick replies for low-literacy borrowers.
 *
 * FSDT 2024: 26% of adult Tanzanians cannot read complex financial text
 * but recognize 18+ emoji on first sight. GSMA pilot data: emoji-driven
 * interactions cut M-Pesa user-error rate by 33%.
 *
 * 4 buttons for the universal subset of intents: yes / no / not-sure / help.
 * Bilingual aria-labels. Copper-tinted, subtle, anti-clutter.
 */

import * as React from "react";
import { Emoji } from "./Emoji";
import type { EmojiKey } from "./universal-set";

export type QuickReplyIntent = "yes" | "no" | "not_sure" | "help";

export interface QuickReplyOption {
  readonly intent: QuickReplyIntent;
  readonly emoji: EmojiKey;
  readonly labelEn: string;
  readonly labelSw: string;
}

export const QUICK_REPLIES: ReadonlyArray<QuickReplyOption> = Object.freeze([
  { intent: "yes", emoji: "check", labelEn: "Yes", labelSw: "Ndiyo" },
  { intent: "no", emoji: "lock", labelEn: "No", labelSw: "Hapana" },
  {
    intent: "not_sure",
    emoji: "thinking",
    labelEn: "Not sure",
    labelSw: "Sina uhakika",
  },
  {
    intent: "help",
    emoji: "prayer",
    labelEn: "I need help",
    labelSw: "Nahitaji msaada",
  },
]);

export interface EmojiQuickRepliesProps {
  readonly onSelect: (intent: QuickReplyIntent) => void;
  readonly lang?: "en" | "sw";
  readonly disabled?: boolean;
  readonly className?: string;
}

export function EmojiQuickReplies({
  onSelect,
  lang = "en",
  disabled = false,
  className,
}: EmojiQuickRepliesProps): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={lang === "sw" ? "Majibu ya haraka" : "Quick replies"}
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
    >
      {QUICK_REPLIES.map((option) => {
        const label = lang === "sw" ? option.labelSw : option.labelEn;
        return (
          <button
            key={option.intent}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option.intent)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Emoji emoji={option.emoji} lang={lang} decorative />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default EmojiQuickReplies;
