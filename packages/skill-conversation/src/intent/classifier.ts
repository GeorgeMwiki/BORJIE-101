/**
 * NL → IntentVerdict classifier.
 *
 * The classifier is **deterministic** (no LLM call) and **conservative**.
 * The job is to route NL into one of four buckets:
 *
 *   - `recurring`   — every X / each Y → compile an AOP with a cron trigger
 *   - `conditional` — if/when/once X   → compile an AOP with an event trigger
 *   - `ad-hoc`     — imperative now    → ai-copilot's one-off tool path
 *   - `question`   — what/who/show me  → ai-copilot's Q&A path
 *
 * Decisions are made by aggregating Signal weights. We deliberately leave
 * a "needs-confirmation" mid-band (0.30–0.85) where we surface a prompt to
 * the owner before compiling — this is the single most important guardrail
 * in the vision: the MD never silently sets up recurring autonomous behaviour
 * without an explicit yes.
 */

import { extractSignals, type Signal, type SignalKind } from './signals.js';
import type { ConfirmationPrompt, IntentKind, IntentVerdict } from '../types.js';

/**
 * Weight matrix: how much each signal moves the classifier toward each
 * IntentKind. Symmetric weights (negative entries) keep the model honest —
 * e.g. a "?" at the end strongly demotes "recurring".
 *
 * Frozen for immutability.
 */
const SIGNAL_WEIGHTS: Readonly<Record<SignalKind, Readonly<Record<IntentKind, number>>>> =
  Object.freeze({
    'recurring-cadence': Object.freeze({
      recurring: 0.55,
      conditional: 0.05,
      'ad-hoc': -0.2,
      question: -0.25,
    }),
    'conditional-trigger': Object.freeze({
      recurring: 0.1,
      conditional: 0.6,
      'ad-hoc': -0.15,
      question: -0.2,
    }),
    'imperative-now': Object.freeze({
      recurring: -0.15,
      conditional: -0.1,
      'ad-hoc': 0.5,
      question: -0.2,
    }),
    'question-marker': Object.freeze({
      recurring: -0.25,
      conditional: -0.2,
      'ad-hoc': -0.15,
      question: 0.65,
    }),
    'destructive-verb': Object.freeze({
      // Destructive verbs are neutral on intent kind — they're flagged at the
      // AOP layer. We give a tiny conditional bump because real-world
      // destructive workflows tend to be conditional ("if X then evict").
      recurring: 0.0,
      conditional: 0.1,
      'ad-hoc': 0.05,
      question: -0.05,
    }),
    'recipient-self-reference': Object.freeze({
      // "send me X" or "remind me" — usually recurring/conditional ("send me
      // a brief every Monday" / "alert me when cash drops below X"). Not a
      // hard signal on its own but it stacks.
      recurring: 0.15,
      conditional: 0.1,
      'ad-hoc': 0.0,
      question: -0.05,
    }),
  });

const INTENT_KINDS: ReadonlyArray<IntentKind> = Object.freeze([
  'recurring',
  'conditional',
  'ad-hoc',
  'question',
]);

interface ScoreCard {
  readonly recurring: number;
  readonly conditional: number;
  readonly 'ad-hoc': number;
  readonly question: number;
}

const emptyScoreCard = (): ScoreCard =>
  Object.freeze({
    recurring: 0,
    conditional: 0,
    'ad-hoc': 0,
    question: 0,
  });

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

function aggregate(signals: ReadonlyArray<Signal>): ScoreCard {
  // Sum weighted contributions, then sigmoid-normalise so we get a confidence
  // in [0, 1] per kind. Pure: same signals → same scorecard.
  const raw: Record<IntentKind, number> = {
    recurring: 0,
    conditional: 0,
    'ad-hoc': 0,
    question: 0,
  };

  for (const signal of signals) {
    const weights = SIGNAL_WEIGHTS[signal.kind];
    for (const kind of INTENT_KINDS) {
      raw[kind] += weights[kind];
    }
  }

  return Object.freeze({
    recurring: sigmoid(raw.recurring),
    conditional: sigmoid(raw.conditional),
    'ad-hoc': sigmoid(raw['ad-hoc']),
    question: sigmoid(raw.question),
  });
}

/**
 * Returns the highest-scoring intent kind, along with its confidence.
 *
 * Tie-breaking order (in descending priority):
 *   1. `recurring` — owner-as-programmer is the higher-stakes path; we'd
 *       rather ask for confirmation than misclassify it as ad-hoc.
 *   2. `conditional` — same reasoning, second-most stakes.
 *   3. `ad-hoc`
 *   4. `question`
 */
function pickWinner(score: ScoreCard): { kind: IntentKind; confidence: number } {
  const ordered: ReadonlyArray<IntentKind> = [
    'recurring',
    'conditional',
    'ad-hoc',
    'question',
  ];
  let winner: IntentKind = 'question';
  let best = -Infinity;
  for (const k of ordered) {
    if (score[k] > best + 1e-6) {
      winner = k;
      best = score[k];
    }
  }
  return { kind: winner, confidence: best };
}

/**
 * Build the confirmation prompt the chat surface shows the owner before
 * compiling. The summary is intentionally short and human — never echoes
 * back the technical intent kind.
 */
function buildConfirmation(
  nl: string,
  kind: IntentKind,
): ConfirmationPrompt {
  const trimmed = nl.trim();
  const echo = trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;

  const action =
    kind === 'recurring'
      ? 'set up a recurring task'
      : kind === 'conditional'
        ? 'set up a conditional rule'
        : 'set up an automation';

  return Object.freeze({
    summary: `I think you want me to ${action}: "${echo}"`,
    plan:
      kind === 'recurring'
        ? 'I will compile this into a scheduled skill, run it on its cadence, and report back here each time it runs. Reply "pause" any time to stop it.'
        : 'I will compile this into an event-triggered skill. It will run only when the trigger condition matches. Reply "pause" any time to disarm it.',
    approvalKeywords: Object.freeze([
      'yes',
      'y',
      'confirm',
      'go ahead',
      'set it up',
      'do it',
      'ok',
      'okay',
      'sawa',
      'ndio',
      'ndiyo',
    ]),
    rejectionKeywords: Object.freeze([
      'no',
      'n',
      'cancel',
      'stop',
      'never mind',
      'nevermind',
      'hapana',
      'siyo',
    ]),
  });
}

export interface ClassifyOptions {
  /**
   * Confidence floor below which we go to "ad-hoc" by default. The classifier
   * never raises this on its own; only ai-copilot's settings can.
   */
  readonly minCompileConfidence?: number;
  /**
   * Confidence floor above which we skip confirmation. Default 0.85 — kept
   * conservative deliberately.
   */
  readonly skipConfirmationAt?: number;
}

/**
 * Pure classifier. No I/O, no clock, no LLM. Same input → same verdict.
 *
 * Decision flow:
 *   1. Extract signals.
 *   2. Aggregate to scorecard.
 *   3. Pick winner.
 *   4. If winner is recurring/conditional:
 *        - confidence < 0.30 → demote to 'ad-hoc' (too weak)
 *        - 0.30 ≤ confidence < skipConfirmationAt → emit confirmation prompt
 *        - confidence ≥ skipConfirmationAt → compile-eligible, no confirmation
 *      (The mid-band is the most common case — most owners write a recipe
 *       that's clearly recurring but with enough ambiguity that we should
 *       echo it back. Default is 0.30..0.85.)
 *   5. If winner is ad-hoc or question: never compile, never confirm.
 */
export function classifyIntent(
  nl: string,
  options: ClassifyOptions = {},
): IntentVerdict {
  const minCompileConfidence = options.minCompileConfidence ?? 0.3;
  const skipConfirmationAt = options.skipConfirmationAt ?? 0.85;

  if (!nl.trim()) {
    return Object.freeze({
      kind: 'question' as IntentKind,
      confidence: 0,
      signals: Object.freeze([]),
      confirmation: null,
      compileEligible: false,
    });
  }

  const signals = extractSignals(nl);
  const score = aggregate(signals);
  const { kind, confidence } = pickWinner(score);

  // Compile path is only ever recurring or conditional.
  const isCompileKind = kind === 'recurring' || kind === 'conditional';

  if (!isCompileKind) {
    return Object.freeze({
      kind,
      confidence,
      signals: Object.freeze(signals.map((s) => `${s.kind}:${s.matched}`)),
      confirmation: null,
      compileEligible: false,
    });
  }

  // Weak compile-kind signal — demote to ad-hoc (treat as one-off).
  if (confidence < minCompileConfidence) {
    return Object.freeze({
      kind: 'ad-hoc' as IntentKind,
      confidence,
      signals: Object.freeze(signals.map((s) => `${s.kind}:${s.matched}`)),
      confirmation: null,
      compileEligible: false,
    });
  }

  // Strong signal — skip confirmation.
  if (confidence >= skipConfirmationAt) {
    return Object.freeze({
      kind,
      confidence,
      signals: Object.freeze(signals.map((s) => `${s.kind}:${s.matched}`)),
      confirmation: null,
      compileEligible: true,
    });
  }

  // Mid-band — emit a confirmation prompt. compileEligible stays true so the
  // chat surface knows to gate on user reply, not throw out the request.
  return Object.freeze({
    kind,
    confidence,
    signals: Object.freeze(signals.map((s) => `${s.kind}:${s.matched}`)),
    confirmation: buildConfirmation(nl, kind),
    compileEligible: true,
  });
}

/**
 * Decide whether the owner's reply to a confirmation prompt counts as
 * approval or rejection. Returns `null` for ambiguous replies — the chat
 * surface should re-ask in that case.
 */
export function evaluateConfirmation(
  reply: string,
  prompt: ConfirmationPrompt,
): 'approved' | 'rejected' | 'ambiguous' {
  const normalised = reply.trim().toLowerCase();
  if (!normalised) return 'ambiguous';
  if (prompt.approvalKeywords.some((k) => normalised === k || normalised.startsWith(`${k} `) || normalised.startsWith(`${k},`))) {
    return 'approved';
  }
  if (prompt.rejectionKeywords.some((k) => normalised === k || normalised.startsWith(`${k} `) || normalised.startsWith(`${k},`))) {
    return 'rejected';
  }
  return 'ambiguous';
}
