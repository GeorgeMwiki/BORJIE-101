/**
 * `brand-lock` verifier — confirm the trace's UI fragment passes the
 * brand-lock guardrail.
 *
 * Brand-lock is normally enforced as an ESLint rule, but during RLVR
 * we need a programmatic check. The verifier accepts an injected
 * `BrandLockChecker` port so the real ESLint rule can be wired in
 * production while tests inject a deterministic function. Mr. Mwikila
 * lives in a strict design system; brand-lock failures must not leak
 * into the training set.
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

export interface BrandLockViolation {
  readonly ruleId: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface BrandLockChecker {
  (sourceFragment: string): Promise<ReadonlyArray<BrandLockViolation>>;
}

/**
 * Default brand-lock checker — pattern-based detection of disallowed
 * inline style values. Production wiring overrides this with the real
 * ESLint adapter.
 */
const defaultChecker: BrandLockChecker = async (
  sourceFragment: string,
) => {
  const violations: BrandLockViolation[] = [];
  const lines = sourceFragment.split('\n');
  lines.forEach((line, idx) => {
    // Hex literal colors (#fff, #abc123) — forbidden, use tokens.
    const hexMatch = line.match(/#[0-9a-fA-F]{3,8}\b/);
    if (hexMatch !== null) {
      violations.push({
        ruleId: 'brand/no-hex-literals',
        message: `Hex colour literal '${hexMatch[0]}' — use a design-system token`,
        line: idx + 1,
        column: hexMatch.index !== undefined ? hexMatch.index + 1 : 1,
      });
    }
    // Inline rgb(...) — forbidden.
    if (/rgba?\(/i.test(line)) {
      violations.push({
        ruleId: 'brand/no-rgb-literals',
        message: 'Inline rgb()/rgba() — use a design-system token',
        line: idx + 1,
      });
    }
  });
  return Object.freeze(violations);
};

export interface BrandLockConfig {
  readonly checker?: BrandLockChecker;
}

export function createBrandLockVerifier(
  config: BrandLockConfig = {},
): Verifier {
  const checker = config.checker ?? defaultChecker;

  return {
    name: 'brand-lock',
    version: '1.0.0',

    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      return typeof meta['ui_fragment'] === 'string';
    },

    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const fragment = meta['ui_fragment'];
      if (typeof fragment !== 'string') {
        return Object.freeze({
          verifierName: 'brand-lock',
          verdict: 'skip' as const,
          reward: 0,
          evidence: Object.freeze({ reason: 'no_ui_fragment' }),
          confidence: 0,
        });
      }

      const violations = await checker(fragment);
      if (violations.length === 0) {
        return Object.freeze({
          verifierName: 'brand-lock',
          verdict: 'pass' as const,
          reward: 1,
          evidence: Object.freeze({ violations: 0 }),
          confidence: 1,
        });
      }
      return Object.freeze({
        verifierName: 'brand-lock',
        verdict: 'fail' as const,
        reward: 0,
        evidence: Object.freeze({
          violations: violations.length,
          ruleIds: Object.freeze(
            Array.from(new Set(violations.map((v) => v.ruleId))),
          ),
          details: Object.freeze(violations),
        }),
        confidence: 1,
      });
    },
  };
}
