/**
 * `@borjie/ethics-framework` — public surface.
 *
 * SOTA ethics framework. Eight subsystems:
 *
 *   1. principles-registry      — 12 codified principles (Asilomar, NIST,
 *                                 IEEE P7000, EU AI Act, GDPR,
 *                                 Anthropic RSP, Microsoft RAI v2,
 *                                 Google PAIR)
 *   2. consent                  — append-only consent log + parental
 *                                 consent flows (COPPA 13, GDPR Art 8
 *                                 EU 16, POPIA §35 ZA 18, etc.)
 *   3. vulnerable-populations   — per-jurisdiction vulnerability
 *                                 flagging + safeguard generation
 *   4. right-to-explanation     — GDPR Art 22 + EU AI Act Art 14 —
 *                                 decision log, explanation +
 *                                 counterfactual, opt-out to human review
 *   5. dark-pattern-detector    — Brignull's 14-category taxonomy
 *   6. surveillance-consent     — cameras/sensors in rented units,
 *                                 per-tenant consent that does NOT
 *                                 transfer on tenancy change
 *   7. accessibility            — WCAG 2.2 AA + Section 508 checks (16)
 *   8. createEthicsFramework    — composition root
 *
 * Composes (does not edit) `@borjie/fairness-eval` +
 * `@borjie/compliance-pack`.
 */

import { createConsentService, type ConsentService } from './consent/index.js';
import { createInMemoryStore } from './in-memory-store.js';
import { createVulnerablePopulationsService, type VulnerablePopulationsService } from './vulnerable-populations/index.js';
import { createRightToExplanationService, type RightToExplanationService } from './right-to-explanation/index.js';
import { createDarkPatternDetector, type DarkPatternDetector } from './dark-pattern-detector/index.js';
import { createSurveillanceConsentService, type SurveillanceConsentService } from './surveillance-consent/index.js';
import { createAccessibilityScanner, type AccessibilityScanner } from './accessibility/index.js';
import { PRE_SHIPPED_PRINCIPLES } from './principles-registry/index.js';
import type { EthicsStore, Jurisdiction, EthicsPrinciple } from './types.js';

export * from './types.js';
export { PRE_SHIPPED_PRINCIPLES, principlesFor, findPrinciple } from './principles-registry/index.js';
export {
  ageOfDataConsent,
  needsParentalConsent,
  createConsentService,
} from './consent/index.js';
export type { ConsentService, ConsentServiceDeps } from './consent/index.js';
export {
  createVulnerablePopulationsService,
  getVulnerabilitySafeguards,
} from './vulnerable-populations/index.js';
export type { VulnerablePopulationsService } from './vulnerable-populations/index.js';
export { createRightToExplanationService } from './right-to-explanation/index.js';
export type { RightToExplanationService } from './right-to-explanation/index.js';
export {
  createDarkPatternDetector,
  BRIGNULL_TAXONOMY,
} from './dark-pattern-detector/index.js';
export type {
  DarkPatternDetector,
  ScanInput,
} from './dark-pattern-detector/index.js';
export {
  createSurveillanceConsentService,
  SURVEILLANCE_DISCLOSURE_RULES,
} from './surveillance-consent/index.js';
export type { SurveillanceConsentService } from './surveillance-consent/index.js';
export {
  createAccessibilityScanner,
  WCAG_CHECK_REGISTRY,
} from './accessibility/index.js';
export type {
  AccessibilityScanner,
  WcagCheck,
} from './accessibility/index.js';
export { createInMemoryStore } from './in-memory-store.js';

/**
 * Top-level ethics framework — wires every subsystem against a single
 * store + jurisdiction.
 */
export interface EthicsFramework {
  readonly jurisdiction: Jurisdiction;
  readonly principles: ReadonlyArray<EthicsPrinciple>;
  readonly consent: ConsentService;
  readonly vulnerable: VulnerablePopulationsService;
  readonly rightToExplanation: RightToExplanationService;
  readonly darkPatterns: DarkPatternDetector;
  readonly surveillance: SurveillanceConsentService;
  readonly accessibility: AccessibilityScanner;
}

export interface CreateEthicsFrameworkOptions {
  readonly store?: EthicsStore;
  readonly jurisdiction: Jurisdiction;
  readonly principles?: ReadonlyArray<EthicsPrinciple>;
  readonly now?: () => Date;
}

export function createEthicsFramework(
  opts: CreateEthicsFrameworkOptions,
): EthicsFramework {
  const store = opts.store ?? createInMemoryStore();
  const now = opts.now;
  const consent = createConsentService(now ? { store, now } : { store });
  const vulnerable = createVulnerablePopulationsService(now ? { store, now } : { store });
  const rightToExplanation = createRightToExplanationService(now ? { store, now } : { store });
  const darkPatterns = createDarkPatternDetector();
  const surveillance = createSurveillanceConsentService(now ? { store, now } : { store });
  const accessibility = createAccessibilityScanner(now ? { now } : {});
  return {
    jurisdiction: opts.jurisdiction,
    principles: opts.principles ?? PRE_SHIPPED_PRINCIPLES,
    consent,
    vulnerable,
    rightToExplanation,
    darkPatterns,
    surveillance,
    accessibility,
  };
}
