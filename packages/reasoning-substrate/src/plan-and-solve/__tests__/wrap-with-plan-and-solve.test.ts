/**
 * Plan-and-Solve+ tests.
 *
 * Ten sample tasks covering the MD's everyday workload:
 *   1. royalty proration
 *   2. late-fee compute
 *   3. offtake-renewal date math
 *   4. currency convert (KES→TZS)
 *   5. KRA-MRI submit (high-stakes, all-or-fail strictness)
 *   6. licence-suspension-notice math (high-stakes)
 *   7. performance-bond-refund split
 *   8. mediation-offer drafting
 *   9. payment-plan structuring
 *  10. portfolio-level royalty-roll consolidation
 *
 * Each task asserts:
 *   - the canonical 4-step skeleton is present
 *   - the strictness directive matches the config
 *   - required variables are listed
 *   - the caller's prompt sits ABOVE the skeleton
 *   - the wrapper is deterministic / pure (same input → same output)
 */

import { describe, expect, it } from 'vitest';
import {
  wrapWithPlanAndSolve,
  planAndSolveSkeleton,
  DEFAULT_EXTRACTION_STRICTNESS,
} from '../wrap-with-plan-and-solve.js';
import type { PlanAndSolveConfig } from '../types.js';

interface PlanAndSolveTask {
  readonly id: string;
  readonly description: string;
  readonly callerPrompt: string;
  readonly config: PlanAndSolveConfig;
  readonly mustInclude: ReadonlyArray<string>;
}

const TASKS: ReadonlyArray<PlanAndSolveTask> = [
  {
    id: 'royalty-proration',
    description: 'Royalty proration — strict, requires mobilisation day + monthly royalty.',
    callerPrompt: 'You are BORJIE MD computing prorated royalty.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['mobilisationDay', 'monthDays', 'monthlyRoyaltyKES'],
    },
    mustInclude: ['Step 1 — Plan', 'mobilisationDay', 'monthlyRoyaltyKES', 'TENTATIVE'],
  },
  {
    id: 'late-fee-compute',
    description: 'Late-fee — strict, jurisdiction-aware.',
    callerPrompt: 'You are BORJIE MD computing late fees under TZ Mining Act.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['daysLate', 'principalKES', 'jurisdiction'],
      addendum: 'Cap late fee at 10% of monthly royalty (TZ Mining Act §11).',
    },
    mustInclude: ['daysLate', 'jurisdiction', 'Cap late fee at 10%'],
  },
  {
    id: 'offtake-renewal',
    description: 'Offtake renewal — lenient, only one required variable.',
    callerPrompt: 'You are BORJIE MD computing offtake renewal dates.',
    config: {
      extractionStrictness: 'lenient',
      requiredVariables: ['offtakeStartDate'],
    },
    mustInclude: ['You may proceed to Step 3', 'offtakeStartDate'],
  },
  {
    id: 'currency-convert',
    description: 'KES→TZS conversion — strict.',
    callerPrompt: 'You are BORJIE MD converting display currency.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['fromCurrency', 'toCurrency', 'amountMinorUnits'],
    },
    mustInclude: ['fromCurrency', 'toCurrency', 'amountMinorUnits'],
  },
  {
    id: 'kra-mri-submit',
    description: 'KRA-MRI submit — all-or-fail (no UNKNOWN allowed).',
    callerPrompt: 'You are BORJIE MD preparing KRA-MRI rental income submission.',
    config: {
      extractionStrictness: 'all-or-fail',
      requiredVariables: ['ownerKraPin', 'taxYear', 'grossRoyaltyKES', 'allowableExpensesKES'],
    },
    mustInclude: [
      'If ANY required variable is UNKNOWN, STOP at Step 2',
      'ownerKraPin',
      'taxYear',
    ],
  },
  {
    id: 'licence-suspension-notice-math',
    description: 'Licence-suspension notice — all-or-fail; nothing can be UNKNOWN.',
    callerPrompt: 'You are BORJIE MD evaluating licence-suspension notice lawfulness.',
    config: {
      extractionStrictness: 'all-or-fail',
      requiredVariables: [
        'counterpartyId',
        'jurisdiction',
        'unpaidAmount',
        'daysLate',
        'curePeriodDays',
        'mediationOptIn',
      ],
    },
    mustInclude: [
      'If ANY required variable is UNKNOWN, STOP at Step 2',
      'mediationOptIn',
      'curePeriodDays',
    ],
  },
  {
    id: 'bond-refund',
    description: 'Performance-bond refund split — strict.',
    callerPrompt: 'You are BORJIE MD computing performance-bond refunds on close-out.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['bondKES', 'damageCostKES', 'unpaidRoyaltyKES'],
    },
    mustInclude: ['damageCostKES', 'unpaidRoyaltyKES'],
  },
  {
    id: 'mediation-offer-draft',
    description: 'Mediation offer drafting — strict, with addendum.',
    callerPrompt: 'You are BORJIE MD drafting mediation offers.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['counterpartyId', 'outstandingRoyaltiesKES', 'mediationDeadline'],
      addendum: 'Tone: firm but non-threatening. No threats of escalation in the body.',
    },
    mustInclude: ['Tone: firm but non-threatening', 'outstandingRoyaltiesKES', 'mediationDeadline'],
  },
  {
    id: 'payment-plan-structure',
    description: 'Payment plan — strict, multiple money + date vars.',
    callerPrompt: 'You are BORJIE MD proposing payment plans.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['outstandingRoyaltiesKES', 'planMonths', 'aprPercent', 'firstInstallmentDate'],
    },
    mustInclude: ['planMonths', 'aprPercent'],
  },
  {
    id: 'portfolio-royalty-roll',
    description: 'Portfolio royalty-roll consolidation — lenient (multi-unit, missing data tolerable).',
    callerPrompt: 'You are BORJIE MD consolidating portfolio royalty-roll.',
    config: {
      extractionStrictness: 'lenient',
      requiredVariables: ['estateId', 'period'],
    },
    mustInclude: ['You may proceed to Step 3', 'estateId', 'period'],
  },
];

describe('wrapWithPlanAndSolve — 10 task scenarios', () => {
  for (const task of TASKS) {
    it(`task '${task.id}': ${task.description}`, () => {
      const out = wrapWithPlanAndSolve(task.callerPrompt, task.config);
      expect(out).toContain(task.callerPrompt);
      // Canonical structure present.
      expect(out).toContain('Step 1 — Plan');
      expect(out).toContain('Step 2 — Extract variables');
      expect(out).toContain('Step 3 — Solve');
      expect(out).toContain('Step 4 — Reflect');
      // Task-specific assertions.
      for (const needle of task.mustInclude) {
        expect(out).toContain(needle);
      }
      // Caller prompt sits ABOVE the skeleton.
      const promptIdx = out.indexOf(task.callerPrompt);
      const step1Idx = out.indexOf('Step 1 — Plan');
      expect(promptIdx).toBeGreaterThanOrEqual(0);
      expect(step1Idx).toBeGreaterThan(promptIdx);
      // Deterministic — same input twice = same output.
      const out2 = wrapWithPlanAndSolve(task.callerPrompt, task.config);
      expect(out2).toBe(out);
    });
  }
});

describe('wrapWithPlanAndSolve — defaults + edge cases', () => {
  it('defaults to strict strictness when not supplied', () => {
    const out = wrapWithPlanAndSolve('You are MD.');
    expect(out).toContain('List UNKNOWN variables explicitly');
    expect(DEFAULT_EXTRACTION_STRICTNESS).toBe('strict');
  });

  it('skips the "Required variables" line when no variables supplied', () => {
    const out = wrapWithPlanAndSolve('You are MD.', { extractionStrictness: 'strict' });
    expect(out).not.toContain('Required variables for this task');
  });

  it('handles an empty caller prompt — skeleton still emitted', () => {
    const out = wrapWithPlanAndSolve('', { extractionStrictness: 'lenient' });
    expect(out).toContain('Step 1 — Plan');
    expect(out).toContain('You may proceed to Step 3');
  });

  it('planAndSolveSkeleton returns just the skeleton without caller prompt', () => {
    const sk = planAndSolveSkeleton();
    expect(sk.startsWith('## Plan-and-Solve+ reasoning protocol')).toBe(true);
  });

  it('appends addendum AFTER the four steps', () => {
    const out = wrapWithPlanAndSolve('MD.', {
      extractionStrictness: 'strict',
      addendum: 'Cite TZ Mining Act §11.',
    });
    const reflectIdx = out.indexOf('Step 4 — Reflect');
    const addendumIdx = out.indexOf('Cite TZ Mining Act §11.');
    expect(reflectIdx).toBeGreaterThan(0);
    expect(addendumIdx).toBeGreaterThan(reflectIdx);
  });
});
