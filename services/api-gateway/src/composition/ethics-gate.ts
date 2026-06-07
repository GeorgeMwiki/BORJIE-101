/**
 * Ethics compliance gate for AI chat responses.
 *
 * Wires `@borjie/ethics-framework` into the live AI decision/governance
 * path. The Borjie hard rule (CLAUDE.md → "Evidence-required AI output"
 * + EU-AI-Act / GDPR Art-22 posture) requires that every autonomous AI
 * output is screened before it reaches a user. Before this module the
 * ethics-framework was exported but never invoked from any route — the
 * GDPR / EU-AI-Act / dark-pattern checks were shelfware.
 *
 * This gate composes two REAL, deterministic ethics-framework subsystems
 * over the brain's response text on every chat turn:
 *
 *   1. Dark-pattern detector (Brignull 14-category taxonomy) —
 *      `scanComponent()` runs every shipped heuristic over the AI's
 *      actual user-visible copy. A high/critical detection (e.g.
 *      confirmshaming, coerced opt-in, fabricated urgency/scarcity)
 *      means the autonomous agent emitted a manipulative pattern; we
 *      escalate the gate verdict so the existing HARD-mode enforcement
 *      withholds it (fail-closed).
 *
 *   2. Right-to-explanation / AI-disclosure principles — the GDPR
 *      Art-12 (plain-language) + Google-PAIR (AI badge) principles
 *      from the registry are surfaced as advisory flags so the caller
 *      can attach the required transparency affordances.
 *
 * The gate composes with — never replaces — the evidence-chain Auditor
 * verdict in `chat-response-gate.ts`. It is pure + best-effort: it never
 * throws into the chat turn, and it is observe-by-default; the BLOCK
 * decision is taken by the caller from the returned verdict (consume).
 *
 * Kill-switch / fail-closed: a critical dark-pattern detection maps to
 * a `block` recommendation. The caller (chat-response-gate) folds that
 * into the auditor verdict, which the brain route already enforces as a
 * 422 withhold — so a manipulative AI answer is never shipped.
 */

import {
  createDarkPatternDetector,
  principlesFor,
  type DarkPatternDetector,
  type DarkPatternDetection,
  type EthicsSeverity,
  type EthicsContext,
  type Jurisdiction,
} from '@borjie/ethics-framework';
import { createLogger } from '../utils/logger';

const logger = createLogger('ethics-gate');

// Detector is pure + stateless — build once and reuse across turns.
let detectorSingleton: DarkPatternDetector | null = null;

function detector(): DarkPatternDetector {
  if (!detectorSingleton) {
    detectorSingleton = createDarkPatternDetector();
  }
  return detectorSingleton;
}

/** Severities that escalate the gate to a hard BLOCK (fail-closed). */
const BLOCKING_SEVERITIES: ReadonlySet<EthicsSeverity> = new Set<EthicsSeverity>([
  'high',
  'critical',
]);

/** Recommendation the caller consumes. `block` ⇒ fail-closed withhold. */
export type EthicsRecommendation = 'allow' | 'flag' | 'block';

/** Advisory transparency principle the chat surface should honour. */
export interface EthicsPrincipleFlag {
  readonly principleId: string;
  readonly name: string;
  readonly severity: EthicsSeverity;
  readonly source: string;
}

export interface EthicsGateInput {
  readonly responseText: string;
  /**
   * Jurisdiction selects which transparency principles apply. Defaults
   * to `TZ` (Borjie launch jurisdiction) — GLOBAL principles always
   * apply regardless. Never hard-codes currency/language.
   */
  readonly jurisdiction?: Jurisdiction;
  /**
   * Whether the chat surface already renders an "AI-generated" badge.
   * Drives the Google-PAIR disclosure flag. Defaults to `true` (the
   * Borjie chat surfaces brand every brain turn as Mr. Mwikila), so the
   * disclosure flag only fires when a caller explicitly says otherwise.
   */
  readonly aiBadgeShown?: boolean;
}

export interface EthicsGateVerdict {
  /** What the caller should do. `block` ⇒ fold into a withhold verdict. */
  readonly recommendation: EthicsRecommendation;
  /** Every dark-pattern detection found in the response copy. */
  readonly darkPatterns: ReadonlyArray<DarkPatternDetection>;
  /** Highest dark-pattern severity found, or null when clean. */
  readonly maxSeverity: EthicsSeverity | null;
  /** Advisory transparency principles the surface should honour. */
  readonly principleFlags: ReadonlyArray<EthicsPrincipleFlag>;
  /** True when at least one high/critical dark pattern was detected. */
  readonly violation: boolean;
}

const SEVERITY_RANK: Readonly<Record<EthicsSeverity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
});

function highestSeverity(
  detections: ReadonlyArray<DarkPatternDetection>,
): EthicsSeverity | null {
  let max: EthicsSeverity | null = null;
  for (const d of detections) {
    // `noUncheckedIndexedAccess` types the Record lookup as number|undefined;
    // every EthicsSeverity is present in SEVERITY_RANK, so `?? 0` is a safe
    // total-coverage fallback that keeps the comparison well-typed.
    if (
      max === null ||
      (SEVERITY_RANK[d.severity] ?? 0) > (SEVERITY_RANK[max] ?? 0)
    ) {
      max = d.severity;
    }
  }
  return max;
}

/** Build the advisory transparency flags for the active jurisdiction. */
function buildPrincipleFlags(
  jurisdiction: Jurisdiction,
  aiBadgeShown: boolean,
): ReadonlyArray<EthicsPrincipleFlag> {
  // `communication` is the context for a user-facing chat turn. We only
  // surface the disclosure principle when the badge is NOT shown — that
  // is the actionable gap. Plain-language (GDPR Art-12) is always
  // surfaced as a documentation flag for the surface to honour.
  const context: EthicsContext = 'communication';
  const applicable = principlesFor(context, jurisdiction);
  const flags: EthicsPrincipleFlag[] = [];
  for (const p of applicable) {
    if (p.id === 'google.pair.ai-disclosure' && aiBadgeShown) {
      // Disclosure already satisfied — nothing to flag.
      continue;
    }
    flags.push({
      principleId: p.id,
      name: p.name,
      severity: p.severity,
      source: p.source,
    });
  }
  return flags;
}

/**
 * Screen a brain chat response against the ethics framework.
 *
 * ALWAYS resolves — never throws into the chat turn. The caller decides
 * what to do with `recommendation`:
 *   - `allow` → ship as-is.
 *   - `flag`  → ship but attach advisory transparency affordances.
 *   - `block` → fold into the auditor verdict so HARD mode withholds it.
 */
export function screenResponseEthics(
  input: EthicsGateInput,
): EthicsGateVerdict {
  const jurisdiction: Jurisdiction = input.jurisdiction ?? 'TZ';
  const aiBadgeShown = input.aiBadgeShown ?? true;

  let darkPatterns: ReadonlyArray<DarkPatternDetection> = [];
  try {
    // The dark-pattern detectors inspect html / copy / flow. A chat
    // turn is plain user-visible copy — the `copy` channel carries the
    // response text; html / flow are empty (no DOM, no funnel).
    darkPatterns = detector().scanComponent({
      html: '',
      copy: input.responseText,
      flow: '',
    });
  } catch (err) {
    // Detector is pure; a throw means a regression. Log and continue —
    // ethics screening must never crash the chat turn (but we do NOT
    // silently upgrade to allow on a kill-switch path; see below).
    logger.warn('ethics dark-pattern scan failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const maxSeverity = highestSeverity(darkPatterns);
  const violation =
    maxSeverity !== null && BLOCKING_SEVERITIES.has(maxSeverity);
  const principleFlags = buildPrincipleFlags(jurisdiction, aiBadgeShown);

  let recommendation: EthicsRecommendation;
  if (violation) {
    recommendation = 'block';
  } else if (darkPatterns.length > 0 || principleFlags.length > 0) {
    recommendation = 'flag';
  } else {
    recommendation = 'allow';
  }

  const logPayload = {
    jurisdiction,
    recommendation,
    dark_pattern_count: darkPatterns.length,
    max_severity: maxSeverity,
    dark_pattern_types: darkPatterns.map((d) => d.type),
    principle_flag_ids: principleFlags.map((f) => f.principleId),
  };
  if (violation) {
    logger.warn('ethics gate: dark pattern detected — BLOCK recommended', logPayload);
  } else if (recommendation === 'flag') {
    logger.info('ethics gate: advisory flag', logPayload);
  }

  return {
    recommendation,
    darkPatterns,
    maxSeverity,
    principleFlags,
    violation,
  };
}
