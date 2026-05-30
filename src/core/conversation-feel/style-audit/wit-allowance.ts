/**
 * Wit allowance.
 *
 * Per session: at most 1 dry-observation moment is allowed (Mr. Mwikila
 * Jarvis-from-Iron-Man personality). Never forced; only fires when:
 *   - the user has shown openness (not in distress, not formal)
 *   - the topic permits levity (not regulator-facing, not loss event)
 *   - the register is right (small-talk or casual exchange)
 *
 * References:
 *  - Provine, "Laughter: A Scientific Investigation" (2000) — comedic
 *    timing depends on conversational register.
 *  - Holmes + Marra, "Over the edge?" (2002) — workplace humour studies.
 *  - Borjie Persona-DNA design (existing module).
 */

import type { ConversationContext } from "../types";

export interface WitDecision {
  readonly allowed: boolean;
  readonly already_used_this_session: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly recommended_form: "dry_aside" | "callback" | "deadpan" | null;
}

const DISTRESS_SIGNALS = [
  /\b(panic|panicking|terrified|terrible|disaster|crisis|emergency|urgent|stressed|crying|broken)\b/i,
  /\b(lost (everything|my (job|home|business)))\b/i,
  /\bcan'?t (sleep|eat|breathe|cope)\b/i,
];

const FORMAL_REGISTER = [
  /\b(regulator|compliance|audit|bot directive|legal counsel|advocate)\b/i,
  /\b(written notice|formal complaint|fraud report)\b/i,
];

const PLAYFUL_SIGNALS = [
  /\b(haha|lol|😂|😄|😅|🙃|cheers|nice|hehe|jk)\b/i,
  /\b(curious|wondering|just wondering|hypothetically)\b/i,
];

/**
 * Pure: decide whether wit is allowed this turn.
 */
export function decideWit(
  ctx: ConversationContext,
  witUsedCount: number,
): WitDecision {
  const reasons: string[] = [];

  if (witUsedCount >= 1) {
    reasons.push("session_quota_exhausted");
    return {
      allowed: false,
      already_used_this_session: true,
      reasons,
      recommended_form: null,
    };
  }

  const userMsg = ctx.user_message ?? "";
  if (DISTRESS_SIGNALS.some((rx) => rx.test(userMsg))) {
    reasons.push("user_distress_detected");
    return {
      allowed: false,
      already_used_this_session: false,
      reasons,
      recommended_form: null,
    };
  }

  if (FORMAL_REGISTER.some((rx) => rx.test(userMsg))) {
    reasons.push("formal_register");
    return {
      allowed: false,
      already_used_this_session: false,
      reasons,
      recommended_form: null,
    };
  }

  // Officer + admin portals can permit wit; marketing public traffic should
  // not (we don't yet know if user is in distress).
  if (ctx.portal === "marketing") {
    reasons.push("public_marketing_portal_too_risky");
    return {
      allowed: false,
      already_used_this_session: false,
      reasons,
      recommended_form: null,
    };
  }

  // Need an openness signal: playful tone OR small-talk turn kind.
  const playful = PLAYFUL_SIGNALS.some((rx) => rx.test(userMsg));
  const smalltalk = ctx.turn_kind === "smalltalk";
  if (!playful && !smalltalk) {
    reasons.push("no_openness_signal");
    return {
      allowed: false,
      already_used_this_session: false,
      reasons,
      recommended_form: null,
    };
  }

  return {
    allowed: true,
    already_used_this_session: false,
    reasons: ["openness_signal_present", "register_permits_levity"],
    recommended_form: playful ? "dry_aside" : "deadpan",
  };
}

/**
 * Pure: produce the inline tone instruction that nudges the model toward a
 * single dry observation. Never forces a joke — instructs restraint.
 */
export function witInjection(decision: WitDecision): string | null {
  if (!decision.allowed) return null;
  return [
    "One dry-observation moment is allowed this turn. Use it only if it lands cleanly.",
    "Form: a brief sideways comment, never a setup-punchline joke.",
    "If nothing dry comes naturally, skip it. Forcing wit is worse than no wit.",
  ].join(" ");
}
