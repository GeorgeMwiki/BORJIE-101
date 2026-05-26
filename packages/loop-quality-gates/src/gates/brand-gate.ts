/**
 * Brand gate — Layer 4 gate #3.
 *
 * Two checks composed:
 *
 *   (a) Mr. Mwikila identity discipline — user-facing text must use
 *       the canonical persona name and must not contain any of the
 *       forbidden brand-leak substrings ("I am the bot", "as an AI",
 *       …).
 *   (b) Brand-lock token discipline — any rendered UI / template text
 *       must not contain raw hex colors. This mirrors the
 *       `borjie/no-non-token-style` ESLint rule. Rather than embed an
 *       ESLint runtime here, we apply the same hex regex inline; the
 *       gate emits a hit list which the loop runner can route into
 *       the lint-rule's auto-fix pipeline if it wants.
 *
 * The gate is intentionally permissive about text that contains no
 * persona claim at all (e.g. raw structured output, tool result
 * envelopes). The persona check only fires when the text is meant for
 * a user.
 *
 * Spec: Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md §3.4 #3.
 */

import {
  DEFAULT_SIGNAL_WEIGHT,
  HEX_COLOR_RE,
  QualityGateError,
  REJECTED_BRAND_SUBSTRINGS,
  REQUIRED_PERSONA_NAME,
  type QualityGateResult,
  type QualitySignal,
} from '../types.js';

export interface BrandInput {
  /**
   * The user-facing portion of the output. Empty string ⇒ the
   * persona check is skipped (e.g. machine-only outputs).
   */
  readonly userFacingText: string;
  /**
   * Rendered UI / template text (the HTML/JSX or CSS surface). Empty
   * string ⇒ the brand-lock check is skipped.
   */
  readonly renderedSurface: string;
  /**
   * Whether the text is meant to be sent to the user. Defaults to
   * `userFacingText.length > 0`.
   */
  readonly isUserFacing?: boolean;
  /** Override the required persona name (rarely used). */
  readonly requiredPersonaName?: string;
  /** Override the rejected substrings (rarely used). */
  readonly rejectedBrandSubstrings?: ReadonlyArray<string>;
}

const SIGNAL_NAME = 'brand';

function makeSignal(
  score: number,
  evidence: Readonly<Record<string, unknown>>,
): QualitySignal {
  return Object.freeze({
    signal: SIGNAL_NAME,
    score,
    weight: DEFAULT_SIGNAL_WEIGHT,
    evidence,
  });
}

export function brandGate(input: BrandInput): QualityGateResult {
  if (!input) {
    throw new QualityGateError(
      'brand gate received null input',
      'INVALID_INPUT',
    );
  }

  const requiredPersona = input.requiredPersonaName ?? REQUIRED_PERSONA_NAME;
  const rejectedSubs =
    input.rejectedBrandSubstrings ?? REJECTED_BRAND_SUBSTRINGS;
  const isUserFacing = input.isUserFacing ?? input.userFacingText.length > 0;

  const personaIssues: string[] = [];
  const tokenIssues: string[] = [];

  // ── Persona discipline ───────────────────────────────────────────────────
  if (isUserFacing) {
    const textLower = input.userFacingText.toLowerCase();
    for (const sub of rejectedSubs) {
      if (textLower.includes(sub.toLowerCase())) {
        personaIssues.push(`rejected-substring:${sub}`);
      }
    }
    // If the text claims a persona at all, that persona must be Mr. Mwikila.
    // Heuristic: any "I am X" or "I'm X" must include the required name.
    const personaClaims = textLower.match(/\b(i am|i'm)\b[^.!?\n]*/g);
    if (personaClaims) {
      const requiredLower = requiredPersona.toLowerCase();
      for (const claim of personaClaims) {
        if (!claim.includes(requiredLower)) {
          personaIssues.push(`mis-identified-persona:${claim.trim()}`);
        }
      }
    }
  }

  // ── Token discipline ─────────────────────────────────────────────────────
  if (input.renderedSurface.length > 0) {
    // Find every hex color literal in the rendered surface.
    const hexRegex = new RegExp(HEX_COLOR_RE.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = hexRegex.exec(input.renderedSurface)) !== null) {
      tokenIssues.push(m[0]);
    }
  }

  if (personaIssues.length === 0 && tokenIssues.length === 0) {
    return Object.freeze({
      pass: true,
      signal: makeSignal(1.0, { isUserFacing }),
      reason: 'pass:persona-and-tokens-clean',
    });
  }

  const totalIssues = personaIssues.length + tokenIssues.length;
  return Object.freeze({
    pass: false,
    signal: makeSignal(0.0, {
      personaIssues: Object.freeze([...personaIssues]),
      tokenIssues: Object.freeze([...tokenIssues]),
      totalIssues,
    }),
    reason: `fail:${personaIssues.length}-persona-issues:${tokenIssues.length}-token-issues`,
  });
}
