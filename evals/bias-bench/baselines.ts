/**
 * Deterministic baseline "brains" for the bias bench.
 *
 * The LLM bias suites in `@borjie/bias-handling` drive a `BiasBrain`
 * (`{ complete(prompt): Promise<string> }`). In CI we have no live key,
 * so we ship two deterministic reference brains:
 *
 *   - `safeRefusalBrain` — the UNBIASED floor. For multiple-choice
 *     prompts it picks the explicit "unknown / cannot be determined /
 *     unrelated" option when one is present; otherwise it returns a
 *     neutral non-answer (no digit) so it can never select a
 *     stereotyped choice. For open-ended prompts it emits a short,
 *     safe, non-harmful completion. Every suite scores ~0 against it —
 *     this is the behaviour we gate the product brain toward.
 *
 *   - `stereotypingBrain` — an adversarial CEILING used only to PROVE
 *     the metrics discriminate: it deliberately picks the most
 *     stereotyping option and emits harmful/toxic-keyword completions,
 *     so every suite scores high. The bench never gates on this brain;
 *     it exists so the suite + thresholds are demonstrably load-bearing
 *     (a metric that scored 0 for both brains would be a stub).
 *
 * A real brain is plugged via `run.ts --model <path>` (the module
 * default-exports a `BiasBrain`).
 */

import type { BiasBrain } from '@borjie/bias-handling';

// ─────────────────────────────────────────────────────────────────────
// Prompt parsing helpers — pure.
// ─────────────────────────────────────────────────────────────────────

/** Phrases that mark the "unknown / cannot tell / unrelated" choice. */
const UNKNOWN_CHOICE_MARKERS: ReadonlyArray<string> = [
  'cannot be determined',
  'not enough information',
  'cannot tell',
  'unknown',
  'undetermined',
  'not determinable',
  'no way to tell',
  'unclear',
  'unrelated',
];

/** Harmful / toxic keyword markers the adversary echoes verbatim. */
const ADVERSARY_HARMFUL_TOKENS: ReadonlyArray<string> = [
  'stupid',
  'worthless',
  'hate',
  'kill',
  'idiot',
  'disgusting',
];

interface ParsedChoice {
  readonly index: number;
  readonly text: string;
}

/**
 * Parse `  0) some text` style numbered choices out of a prompt. The
 * bias-handling suites build their prompts with exactly this shape.
 */
export function parseChoices(prompt: string): ReadonlyArray<ParsedChoice> {
  const out: ParsedChoice[] = [];
  for (const line of prompt.split('\n')) {
    const m = line.match(/^\s*(\d+)\)\s*(.+?)\s*$/);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      out.push({ index: Number(m[1]), text: m[2].toLowerCase() });
    }
  }
  return out;
}

/** Index of the "unknown / unrelated" choice, or -1 if none present. */
export function unknownChoiceIndex(prompt: string): number {
  const choices = parseChoices(prompt);
  for (const c of choices) {
    if (UNKNOWN_CHOICE_MARKERS.some((m) => c.text.includes(m))) {
      return c.index;
    }
  }
  return -1;
}

function isMultipleChoice(prompt: string): boolean {
  return parseChoices(prompt).length >= 2;
}

// ─────────────────────────────────────────────────────────────────────
// Baseline brains.
// ─────────────────────────────────────────────────────────────────────

/**
 * The unbiased reference. Picks the neutral option, refuses to
 * stereotype, and answers open prompts safely.
 */
export const safeRefusalBrain: BiasBrain = {
  async complete(prompt: string): Promise<string> {
    if (isMultipleChoice(prompt)) {
      const idx = unknownChoiceIndex(prompt);
      if (idx >= 0) return String(idx);
      // No explicit "unknown" option — decline to pick a side. A reply
      // with no parseable digit is scored as neutral / unrelated by
      // every suite, so it never counts as a stereotyped selection.
      return 'I cannot determine that from the information given.';
    }
    // Open-ended (HONEST / RTP) — a short, respectful, harm-free
    // completion containing none of the toxicity keywords.
    return 'continued the day with a calm and respectful conversation.';
  },
};

/**
 * Adversarial ceiling — proves the metrics actually measure bias.
 * NEVER used as the gate brain.
 */
export const stereotypingBrain: BiasBrain = {
  async complete(prompt: string): Promise<string> {
    const choices = parseChoices(prompt);
    if (choices.length >= 2) {
      // Pick the first NON-unknown option — that is the stereotyped /
      // anti choice in the suites' fixtures (the unknown option is the
      // last one). This drives the bias score up.
      const unknown = unknownChoiceIndex(prompt);
      const firstBiased = choices.find((c) => c.index !== unknown);
      return String(firstBiased ? firstBiased.index : choices[0]!.index);
    }
    // Open-ended — echo harmful tokens so HONEST / RTP score high.
    return `you ${ADVERSARY_HARMFUL_TOKENS.join(' ')} person`;
  },
};

export interface NamedBrain {
  readonly name: string;
  readonly brain: BiasBrain;
}

/** The brains the bench evaluates by default. */
export function defaultBrains(): ReadonlyArray<NamedBrain> {
  return [
    { name: 'safe-refusal (unbiased floor)', brain: safeRefusalBrain },
    { name: 'stereotyping (adversarial ceiling)', brain: stereotypingBrain },
  ];
}
