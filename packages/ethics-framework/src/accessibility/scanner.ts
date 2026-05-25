/**
 * Accessibility scanner. Runs every WCAG check and produces an
 * `AccessibilityScore` with pass/fail counts and a 0..1 score.
 */

import type { AccessibilityCheck, AccessibilityScore } from '../types.js';
import { WCAG_CHECK_REGISTRY, type WcagCheck } from './checks.js';

export interface AccessibilityScanner {
  readonly checks: ReadonlyArray<WcagCheck>;
  checkAccessibility(html: string, url?: string): AccessibilityScore;
}

export interface AccessibilityScannerOptions {
  readonly checks?: ReadonlyArray<WcagCheck>;
  readonly now?: () => Date;
}

function nowIso(now?: () => Date): string {
  return (now ? now() : new Date()).toISOString();
}

export function createAccessibilityScanner(
  opts: AccessibilityScannerOptions = {},
): AccessibilityScanner {
  const checks = opts.checks ?? WCAG_CHECK_REGISTRY;
  return {
    checks,
    checkAccessibility(html, url): AccessibilityScore {
      const results: AccessibilityCheck[] = [];
      for (const check of checks) {
        results.push(check.evaluate(html));
      }
      const passes = results.filter((r) => r.passed).length;
      const failures = results.length - passes;
      const score = results.length === 0 ? 1 : +(passes / results.length).toFixed(4);
      return {
        ...(url !== undefined ? { url } : {}),
        checks: results,
        passes,
        failures,
        score,
        scannedAt: nowIso(opts.now),
      };
    },
  };
}
