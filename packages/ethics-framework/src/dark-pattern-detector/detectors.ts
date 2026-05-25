/**
 * Detectors — one heuristic per dark-pattern type. Each detector
 * inspects the html, the user-visible copy, and the flow string and
 * returns either null (clean) or a `DarkPatternDetection`.
 *
 * Detectors are conservative: they should produce at most a small
 * number of false positives in clean code. Operators can extend by
 * passing their own detectors to `createDarkPatternDetector`.
 *
 * The shipped detectors are intentionally regex-based and pure (no
 * DOM parsing) so they run anywhere — including build-time CI scans
 * over compiled HTML files or even copy fixtures.
 */

import type { DarkPatternDetection } from '../types.js';
import { specFor } from './taxonomy.js';

export interface ScanInput {
  readonly html: string;
  readonly copy: string;
  readonly flow: string;
}

export type Detector = (input: ScanInput) => DarkPatternDetection | null;

function detection(
  type: Parameters<typeof specFor>[0],
  evidence: string,
  location: string,
  recommendedFix: string,
): DarkPatternDetection {
  const spec = specFor(type);
  return {
    type,
    severity: spec.severity,
    evidence,
    location,
    recommendedFix,
    source: spec.source,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Individual detectors
// ─────────────────────────────────────────────────────────────────────

export const sneakingDetector: Detector = (input) => {
  // Pre-checked opt-in boxes are the classic sneak.
  if (/<input[^>]*type=["']?checkbox["']?[^>]*checked/i.test(input.html)) {
    return detection(
      'sneaking',
      'Pre-checked checkbox detected.',
      'html:checkbox',
      'Uncheck by default. Subject must take an affirmative action (GDPR Art. 7(4)).',
    );
  }
  return null;
};

export const urgencyDetector: Detector = (input) => {
  if (/expires?\s+in\s+\d|hurry|only\s+\d+\s+(left|minute|second|hour)/i.test(input.copy)) {
    return detection(
      'urgency',
      'Time-pressure copy detected.',
      'copy:urgency-phrase',
      'Show real expiry/stock data or remove urgency language entirely.',
    );
  }
  return null;
};

export const misdirectionDetector: Detector = (input) => {
  // Primary button + tiny "no thanks" link signal.
  const hasPrimary = /class=["'][^"']*(primary|cta|btn-primary)/i.test(input.html);
  const hasTinyDecline = /<(a|button)[^>]*>\s*(no thanks|maybe later)\s*</i.test(input.html);
  if (hasPrimary && hasTinyDecline) {
    return detection(
      'misdirection',
      'Prominent accept + low-visibility decline.',
      'html:button-visual-weight',
      'Match the visual weight of accept and decline (Refactoring UI §5).',
    );
  }
  return null;
};

export const socialProofDetector: Detector = (input) => {
  if (/\b\d+\s+(people|customers|users)\s+(just|are|right now)\b/i.test(input.copy)) {
    return detection(
      'social-proof',
      'Live-count social proof copy detected.',
      'copy:social-proof',
      'Only show real counts sourced from analytics; otherwise remove.',
    );
  }
  return null;
};

export const scarcityDetector: Detector = (input) => {
  if (/only\s+\d+\s+left|low stock|almost gone/i.test(input.copy)) {
    return detection(
      'scarcity',
      'Stock-scarcity language detected.',
      'copy:scarcity-phrase',
      'Show actual inventory or remove the language.',
    );
  }
  return null;
};

export const obstructionDetector: Detector = (input) => {
  if (/cancel(lation)?\s+only\s+(by|via)\s+(phone|call|email)/i.test(input.flow)) {
    return detection(
      'obstruction',
      'Cancellation gated behind phone/email — not parity with sign-up channel.',
      'flow:cancel-channel',
      'Provide cancellation in the same channel as signup (FTC Click-to-Cancel 2024).',
    );
  }
  return null;
};

export const forcedActionDetector: Detector = (input) => {
  if (/must\s+(agree|opt[\s-]?in)\s+to\s+(marketing|sms|email)\s+to\s+(continue|proceed)/i.test(input.copy)) {
    return detection(
      'forced-action',
      'Marketing opt-in coerced as condition of service (GDPR Art. 7(4) violation).',
      'copy:forced-opt-in',
      'Decouple service access from marketing consent.',
    );
  }
  return null;
};

export const roachMotelDetector: Detector = (input) => {
  const easySignup = /sign[\s-]?up\s+in\s+(\d+|one|a)\s+click|one[\s-]?click\s+sign[\s-]?up/i.test(input.flow);
  const hardCancel = /(\d+|multiple|several)\s+(steps?|pages?)\s+to\s+cancel/i.test(input.flow);
  if (easySignup && hardCancel) {
    return detection(
      'roach-motel',
      'Easy signup paired with multi-step cancellation.',
      'flow:signup-vs-cancel-asymmetry',
      'Mirror signup and cancellation effort.',
    );
  }
  return null;
};

export const privacyZuckeringDetector: Detector = (input) => {
  if (/share\s+(all|my)(\s+\w+){0,2}\s+(contacts|posts|friends|location|messages|photos)/i.test(input.copy)) {
    return detection(
      'privacy-zuckering',
      'Broad data-sharing copy without granular control.',
      'copy:share-scope',
      'Offer granular per-permission opt-in (GDPR Art. 5(1)(c) data minimisation).',
    );
  }
  return null;
};

export const priceComparisonPreventionDetector: Detector = (input) => {
  if (
    /per\s+month/i.test(input.copy) &&
    /(billed\s+(annually|yearly)|annual\s+plan\s+only)/i.test(input.flow)
  ) {
    return detection(
      'price-comparison-prevention',
      'Monthly price advertised but billing is annual-only.',
      'flow:billing-cycle-mismatch',
      'Show the headline price using the billing cycle that will actually be charged.',
    );
  }
  return null;
};

export const hiddenCostsDetector: Detector = (input) => {
  if (/service\s+fee|processing\s+fee|convenience\s+fee/i.test(input.copy) && /at\s+checkout/i.test(input.flow)) {
    return detection(
      'hidden-costs',
      'Fee disclosed only at checkout — total price not shown earlier.',
      'flow:fee-disclosure-timing',
      'Disclose all-in price on the listing page (FTC Junk Fees Rule 2024 / EU 2011/83/EU Art. 6).',
    );
  }
  return null;
};

export const baitAndSwitchDetector: Detector = (input) => {
  if (
    /<button[^>]*>\s*(close|x|cancel|no)\s*<\/button>/i.test(input.html) &&
    /(close|cancel)\s+(button|x)\s+triggers\s+(sign[\s-]?up|subscribe|opt[\s-]?in)/i.test(input.flow)
  ) {
    return detection(
      'bait-and-switch',
      'Close / cancel button is wired to a signup action.',
      'flow:button-vs-action-mismatch',
      'Make button labels match their action exactly.',
    );
  }
  return null;
};

export const confirmshamingDetector: Detector = (input) => {
  if (
    /no thanks[,]?\s+i\s+(don['’]t|do not)\s+(want|like|need)/i.test(input.copy) ||
    /no[,]?\s+i\s+prefer\s+to\s+(pay|miss\s+out)/i.test(input.copy)
  ) {
    return detection(
      'confirmshaming',
      'Decline option phrased to shame the user.',
      'copy:decline-label',
      'Use neutral decline copy: "No thanks".',
    );
  }
  return null;
};

export const disguisedAdsDetector: Detector = (input) => {
  if (/data-ad|class=["'][^"']*\bad\b|class=["'][^"']*sponsored/i.test(input.html) && !/aria-label=["'][^"']*ad/i.test(input.html)) {
    return detection(
      'disguised-ads',
      'Sponsored content lacks ARIA label disclosure.',
      'html:ad-disclosure',
      'Add aria-label="advertisement" + visible "Ad" badge (FTC .com Disclosures).',
    );
  }
  return null;
};

export const DEFAULT_DETECTORS: ReadonlyArray<Detector> = Object.freeze([
  sneakingDetector,
  urgencyDetector,
  misdirectionDetector,
  socialProofDetector,
  scarcityDetector,
  obstructionDetector,
  forcedActionDetector,
  roachMotelDetector,
  privacyZuckeringDetector,
  priceComparisonPreventionDetector,
  hiddenCostsDetector,
  baitAndSwitchDetector,
  confirmshamingDetector,
  disguisedAdsDetector,
]);
