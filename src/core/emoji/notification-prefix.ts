/**
 * Notification subject-line emoji prefix.
 *
 * Empirical CTR uplift in finance vertical: +38-128% (Pushwoosh / Clevertap
 * 2024-2025 industry benchmarks). Wise + Monzo both prefix every push and
 * email subject with a category emoji.
 *
 * Mapping per Borjie notification kind. Conservative — never more than one
 * emoji per subject line, never decorative.
 */

import { emojiLabel, safeEmojiChar, type EmojiKey } from "./universal-set";

export type NotificationKind =
  | "loan_approved"
  | "loan_declined"
  | "document_missing"
  | "appointment_reminder"
  | "milestone_reached"
  | "weekly_digest"
  | "verification_complete"
  | "payment_received"
  | "payment_due_soon";

const PREFIX: Readonly<Record<NotificationKind, EmojiKey>> = Object.freeze({
  loan_approved: "party",
  loan_declined: "prayer",
  document_missing: "inbox",
  appointment_reminder: "hourglass",
  milestone_reached: "trophy",
  weekly_digest: "inbox",
  verification_complete: "check",
  payment_received: "check",
  payment_due_soon: "alert",
});

export interface PrefixedSubject {
  readonly subject: string;
  readonly emoji: EmojiKey;
  readonly emojiAriaLabel: string;
}

interface PrefixInput {
  readonly kind: NotificationKind;
  readonly baseSubject: string;
  readonly lang?: "en" | "sw";
  readonly channel?: "default" | "west-africa";
  /**
   * If true, skip the prefix (used when the body already opens with one,
   * to avoid double-emoji per WCAG max-3 guidance).
   */
  readonly skipIfPrefixed?: boolean;
}

const ALREADY_PREFIXED = /^[\p{Extended_Pictographic}\p{Emoji_Component}]/u;

export function prefixedSubject(input: PrefixInput): PrefixedSubject {
  const lang = input.lang ?? "en";
  const channel = input.channel ?? "default";
  const key = PREFIX[input.kind];

  if (input.skipIfPrefixed && ALREADY_PREFIXED.test(input.baseSubject.trim())) {
    return {
      subject: input.baseSubject,
      emoji: key,
      emojiAriaLabel: emojiLabel(key, lang),
    };
  }

  const char = safeEmojiChar(key, channel);
  return {
    subject: `${char} ${input.baseSubject}`,
    emoji: key,
    emojiAriaLabel: emojiLabel(key, lang),
  };
}

/** All supported kinds (exhaustive iteration for tests). */
export const NOTIFICATION_KINDS: ReadonlyArray<NotificationKind> =
  Object.freeze([
    "loan_approved",
    "loan_declined",
    "document_missing",
    "appointment_reminder",
    "milestone_reached",
    "weekly_digest",
    "verification_complete",
    "payment_received",
    "payment_due_soon",
  ]);
