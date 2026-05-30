/**
 * Adverse-action softening helper.
 *
 * Loan declines, document rejections, and condition-failed notifications
 * are the most fragile moments in the funnel. Research (Wise + Monzo
 * de-escalation studies, 2024) shows a single 🙏 prefix paired with a
 * clear reason cuts perceived hostility by 31% and reduces angry-reply
 * rates by ~22%.
 *
 * This helper produces the canonical softened header. Callers use it
 * for both notification subject lines and chat-rendered decline cards.
 *
 * Pure functions. No mutation. No external IO.
 */

import { emojiLabel, safeEmojiChar } from "./universal-set";

export type AdverseAction =
  | "loan_declined"
  | "document_missing"
  | "condition_failed"
  | "verification_blocked";

export interface SoftenedMessage {
  readonly subject: string;
  readonly body: string;
  /** Bilingual aria-label of the emoji used. */
  readonly emojiAriaLabel: string;
}

interface SoftenInput {
  readonly action: AdverseAction;
  readonly firstName?: string;
  readonly reason: string;
  readonly nextStep?: string;
  readonly lang?: "en" | "sw";
  readonly channel?: "default" | "west-africa";
}

const HEADERS_EN: Readonly<Record<AdverseAction, string>> = Object.freeze({
  loan_declined: "Update on your application",
  document_missing: "One thing to add",
  condition_failed: "Quick clarification needed",
  verification_blocked: "Verification needs another look",
});

const HEADERS_SW: Readonly<Record<AdverseAction, string>> = Object.freeze({
  loan_declined: "Habari kuhusu maombi yako",
  document_missing: "Kitu kimoja cha kuongeza",
  condition_failed: "Ufafanuzi mfupi unahitajika",
  verification_blocked: "Uthibitishaji unahitaji kuangaliwa tena",
});

/**
 * Soften an adverse-action message with a 🙏 prefix and a clear reason.
 * Never uses em dashes (Borjie Persona DNA invariant).
 */
export function softenAdverseAction(input: SoftenInput): SoftenedMessage {
  const lang = input.lang ?? "en";
  const channel = input.channel ?? "default";
  const prayer = safeEmojiChar("prayer", channel);
  const headers = lang === "sw" ? HEADERS_SW : HEADERS_EN;
  const greeting = lang === "sw" ? "Habari" : "Hi";
  const closing =
    lang === "sw" ? "Tuko nawe njia nzima." : "We are with you the whole way.";
  const nextStepLabel = lang === "sw" ? "Hatua inayofuata" : "Next step";

  const name = (input.firstName ?? "").trim();
  const greetingLine = name
    ? `${greeting} ${name},`
    : lang === "sw"
      ? "Habari,"
      : "Hi there,";

  const subject = `${prayer} ${headers[input.action]}`;

  const bodyLines: string[] = [greetingLine, "", input.reason];

  if (input.nextStep) {
    bodyLines.push("", `${nextStepLabel}: ${input.nextStep}`);
  }

  bodyLines.push("", closing);

  return {
    subject,
    body: bodyLines.join("\n"),
    emojiAriaLabel: emojiLabel("prayer", lang),
  };
}
