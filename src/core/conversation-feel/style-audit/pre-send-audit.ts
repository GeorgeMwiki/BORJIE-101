/**
 * Pre-send style audit middleware.
 *
 * Runs all guards in canonical order on every assistant response BEFORE
 * the user sees it.
 *
 * Order:
 *   1. Anti-pattern strip (silent fix; substance preserved).
 *   2. Honest-uncertainty theatre strip (silent fix on uncertainty lines).
 *   3. Continuity check (request_regen if no link to recent user turns).
 *   4. Position check (request_regen if opinion asked but not given).
 *   5. Sycophancy check (request_regen if agreement contradicts evidence).
 *   6. Brevity check (request_regen if over limit without justification).
 *   7. Specificity check (request_regen if rounded numbers / paraphrased
 *      proper nouns).
 *   8. Rhythm + wit (annotate + tone injection for next turn).
 *
 * Each intervention is hash-chain logged. Caller decides whether to
 * actually re-prompt the model on a request_regen outcome — this module
 * returns the decision; downstream wiring honors it.
 */

import { v4 as uuid } from "uuid";
import type {
  ConversationContext,
  GuardIntervention,
  RemovedPhrase,
  SessionStats,
  TurnKind,
} from "../types";
import {
  shouldRequestRegen,
  stripChatbotFeel,
} from "../guards/anti-pattern-stripper";
import { checkContinuity } from "../continuity/continuity-enforcer";
import { checkPosition } from "../guards/position-taker";
import { checkSycophancy } from "../guards/sycophancy-detector";
import { checkBrevity, inferTurnKind } from "../guards/brevity-guard";
import { checkSpecificity } from "../continuity/specificity-enforcer";
import { stripTheatreFromUncertainty } from "../guards/honest-uncertainty";
import { analyzeRhythm, rhythmInjection } from "./rhythm-analyzer";
import { decideWit, witInjection } from "./wit-allowance";
import { appendIntervention, setSessionStats } from "../audit-log";

export interface AuditOptions {
  readonly turn_kind?: TurnKind;
  readonly wit_uses_so_far?: number;
  readonly enable_audit_log?: boolean;
  readonly request_regen_callback?: (
    instruction: string,
  ) => Promise<string | null>;
}

export interface AuditResult {
  readonly final: string;
  readonly regen_requested: boolean;
  readonly regen_instruction: string | null;
  readonly tone_injection_for_next_turn: string | null;
  readonly interventions: ReadonlyArray<GuardIntervention>;
  readonly stats: SessionStats;
}

/**
 * Pre-send audit. Pure-ish (writes to audit log when enabled).
 */
export async function runPreSendAudit(
  candidate: string,
  ctx: ConversationContext,
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const enableLog = opts.enable_audit_log ?? true;
  const turnKind = opts.turn_kind ?? inferTurnKind(ctx.user_message, candidate);

  let working = candidate;
  const interventions: GuardIntervention[] = [];

  let strips = 0;
  let continuityFixes = 0;
  let positionFixes = 0;
  let sycoPushbacks = 0;
  let brevityViols = 0;
  let specFixes = 0;
  let honestUncertainty = 0;
  let regenRequested = false;
  let regenInstruction: string | null = null;

  // 1. Anti-pattern strip.
  const stripped = stripChatbotFeel(working);
  if (stripped.removed_phrases.length > 0) {
    strips++;
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "anti-pattern-stripper",
          outcome: "silent_fix",
          reason: `removed ${stripped.removed_phrases.length} chatbot-feel phrases`,
          before: working,
          after: stripped.stripped,
          removed: stripped.removed_phrases as RemovedPhrase[],
          metadata: {
            residual_chatbot_score: stripped.residual_chatbot_score,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
    if (shouldRequestRegen(stripped)) {
      regenRequested = true;
      regenInstruction =
        "Most of the previous reply was filler. Re-answer with substance only — " +
        "no openers, no closers, no theatrical apologies.";
    }
    working = stripped.stripped;
  }

  // 2. Honest-uncertainty theatre strip.
  const cleanedUncertainty = stripTheatreFromUncertainty(working);
  if (cleanedUncertainty !== working) {
    honestUncertainty++;
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "honest-uncertainty",
          outcome: "silent_fix",
          reason: "stripped theatrical apology around uncertainty",
          before: working,
          after: cleanedUncertainty,
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
    working = cleanedUncertainty;
  }

  // 3. Continuity check.
  const cont = checkContinuity(working, ctx);
  if (!cont.has_continuity && cont.regen_instruction) {
    continuityFixes++;
    regenRequested = true;
    regenInstruction = combineRegen(regenInstruction, cont.regen_instruction);
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "continuity-enforcer",
          outcome: "request_regen",
          reason: cont.missing_link_reason ?? "no_continuity_link",
          before: working,
          after: working,
          metadata: {
            anchor_kind: cont.anchor_kind,
            suggested_anchor: cont.suggested_anchor,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
  }

  // 4. Position check.
  const pos = checkPosition(working, ctx);
  if (pos.regen_instruction) {
    positionFixes++;
    regenRequested = true;
    regenInstruction = combineRegen(regenInstruction, pos.regen_instruction);
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "position-taker",
          outcome: "request_regen",
          reason: pos.user_asked_for_opinion
            ? "opinion_asked_no_position"
            : "hedge_overload",
          before: working,
          after: working,
          metadata: {
            hedge_count: pos.hedge_count,
            takes_position: pos.response_takes_position,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
  }

  // 5. Sycophancy check.
  const syco = checkSycophancy(working, ctx);
  if (syco.detected && syco.regen_instruction) {
    sycoPushbacks++;
    regenRequested = true;
    regenInstruction = combineRegen(regenInstruction, syco.regen_instruction);
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "sycophancy-detector",
          outcome: "request_regen",
          reason: "agreement_contradicts_known_fact",
          before: working,
          after: working,
          metadata: {
            assertion_key: syco.assertion?.key ?? null,
            true_value: syco.evidence?.true_value ?? null,
            assertion_value: syco.assertion?.asserted_value ?? null,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
  }

  // 6. Brevity check.
  const br = checkBrevity(working, turnKind);
  if (br.regen_instruction) {
    brevityViols++;
    regenRequested = true;
    regenInstruction = combineRegen(regenInstruction, br.regen_instruction);
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "brevity-guard",
          outcome: "request_regen",
          reason: br.bullet_violation
            ? "bullet_under_threshold"
            : "over_word_limit",
          before: working,
          after: working,
          metadata: {
            word_count: br.word_count,
            limit: br.limit,
            justified: br.justified,
            bullets: br.bullet_count,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
  }

  // 7. Specificity check.
  const spec = checkSpecificity(working, ctx);
  if (!spec.is_specific && spec.regen_instruction) {
    specFixes++;
    regenRequested = true;
    regenInstruction = combineRegen(regenInstruction, spec.regen_instruction);
    if (enableLog) {
      interventions.push(
        appendIntervention({
          id: uuid(),
          guard: "specificity-enforcer",
          outcome: "request_regen",
          reason:
            spec.rounded_numbers.length > 0
              ? "rounded_user_amount"
              : spec.missing_user_words.length > 0
                ? "missing_user_proper_noun"
                : "paraphrased_date",
          before: working,
          after: working,
          metadata: {
            missing_words: spec.missing_user_words,
            rounded: spec.rounded_numbers,
          },
          created_at: new Date().toISOString(),
          session_id: ctx.session_id,
        }),
      );
    }
  }

  // Optional regen callback.
  if (regenRequested && opts.request_regen_callback && regenInstruction) {
    try {
      const replacement = await opts.request_regen_callback(regenInstruction);
      if (replacement && replacement.trim().length > 0) {
        // Re-strip only — do not recurse, to bound cost.
        const reStripped = stripChatbotFeel(replacement);
        working = reStripped.stripped;
        regenRequested = false;
        if (enableLog) {
          interventions.push(
            appendIntervention({
              id: uuid(),
              guard: "pre-send-audit",
              outcome: "silent_fix",
              reason: "regen_callback_replaced_response",
              before: candidate,
              after: working,
              created_at: new Date().toISOString(),
              session_id: ctx.session_id,
            }),
          );
        }
      }
    } catch {
      // Swallow; keep working text. The audit record above remains.
    }
  }

  // 8. Rhythm + wit (annotation only; tone injected for next turn).
  const rhythm = analyzeRhythm(ctx.recent_turns);
  let toneInjection: string | null = rhythmInjection(rhythm);
  const witDecision = decideWit(
    { ...ctx, turn_kind: turnKind },
    opts.wit_uses_so_far ?? 0,
  );
  if (witDecision.allowed) {
    const witLine = witInjection(witDecision);
    if (witLine) {
      toneInjection = toneInjection
        ? `${toneInjection}\n\n${witLine}`
        : witLine;
    }
  }

  if ((rhythm.flatlined || witDecision.allowed) && enableLog) {
    interventions.push(
      appendIntervention({
        id: uuid(),
        guard: "rhythm-wit-annotator",
        outcome: "annotate",
        reason: rhythm.flatlined
          ? "rhythm_flatlined"
          : "wit_allowance_available",
        before: working,
        after: working,
        metadata: {
          rhythm,
          wit_allowed: witDecision.allowed,
          wit_reasons: witDecision.reasons,
        },
        created_at: new Date().toISOString(),
        session_id: ctx.session_id,
      }),
    );
  }

  // Stats.
  const chatbotFeelScore = computeChatbotFeelScore({
    strips,
    continuityFixes,
    positionFixes,
    sycoPushbacks,
    brevityViols,
    specFixes,
    rhythmFlatlined: rhythm.flatlined,
  });
  const stats: SessionStats = {
    session_id: ctx.session_id,
    anti_pattern_strips: strips,
    continuity_enforcements: continuityFixes,
    position_taking_interventions: positionFixes,
    sycophancy_pushbacks: sycoPushbacks,
    brevity_violations: brevityViols,
    specificity_fixes: specFixes,
    honest_uncertainty_invocations: honestUncertainty,
    wit_uses: witDecision.allowed ? 1 : 0,
    rhythm,
    chatbot_feel_score: chatbotFeelScore,
  };
  if (enableLog) setSessionStats(stats);

  return {
    final: working,
    regen_requested: regenRequested,
    regen_instruction: regenInstruction,
    tone_injection_for_next_turn: toneInjection,
    interventions,
    stats,
  };
}

function combineRegen(prev: string | null, next: string): string {
  if (!prev) return next;
  return `${prev}\n${next}`;
}

function computeChatbotFeelScore(c: {
  strips: number;
  continuityFixes: number;
  positionFixes: number;
  sycoPushbacks: number;
  brevityViols: number;
  specFixes: number;
  rhythmFlatlined: boolean;
}): number {
  let s = 0;
  s += c.strips * 8;
  s += c.continuityFixes * 12;
  s += c.positionFixes * 10;
  s += c.sycoPushbacks * 18;
  s += c.brevityViols * 6;
  s += c.specFixes * 8;
  if (c.rhythmFlatlined) s += 14;
  return Math.min(100, s);
}

// Re-export for convenience.
export { decideHonestUncertainty } from "../guards/honest-uncertainty";
