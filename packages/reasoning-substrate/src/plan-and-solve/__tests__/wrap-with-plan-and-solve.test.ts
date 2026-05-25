/**
 * Plan-and-Solve+ tests.
 *
 * Ten sample tasks covering the MD's everyday workload:
 *   1. rent proration
 *   2. late-fee compute
 *   3. lease-renewal date math
 *   4. currency convert (KES→TZS)
 *   5. KRA-MRI submit (high-stakes, all-or-fail strictness)
 *   6. eviction-notice math (high-stakes)
 *   7. deposit-refund split
 *   8. mediation-offer drafting
 *   9. payment-plan structuring
 *  10. portfolio-level rent-roll consolidation
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
    id: 'rent-proration',
    description: 'Rent proration — strict, requires move-in day + monthly rent.',
    callerPrompt: 'You are BORJIE MD computing prorated rent.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['moveInDay', 'monthDays', 'monthlyRentKES'],
    },
    mustInclude: ['Step 1 — Plan', 'moveInDay', 'monthlyRentKES', 'TENTATIVE'],
  },
  {
    id: 'late-fee-compute',
    description: 'Late-fee — strict, jurisdiction-aware.',
    callerPrompt: 'You are BORJIE MD computing late fees under TZ Rental Act.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['daysLate', 'principalKES', 'jurisdiction'],
      addendum: 'Cap late fee at 10% of monthly rent (TZ Rental Act §11).',
    },
    mustInclude: ['daysLate', 'jurisdiction', 'Cap late fee at 10%'],
  },
  {
    id: 'lease-renewal',
    description: 'Lease renewal — lenient, only one required variable.',
    callerPrompt: 'You are BORJIE MD computing lease renewal dates.',
    config: {
      extractionStrictness: 'lenient',
      requiredVariables: ['leaseStartDate'],
    },
    mustInclude: ['You may proceed to Step 3', 'leaseStartDate'],
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
      requiredVariables: ['landlordKraPin', 'taxYear', 'grossRentKES', 'allowableExpensesKES'],
    },
    mustInclude: [
      'If ANY required variable is UNKNOWN, STOP at Step 2',
      'landlordKraPin',
      'taxYear',
    ],
  },
  {
    id: 'eviction-notice-math',
    description: 'Eviction notice — all-or-fail; nothing can be UNKNOWN.',
    callerPrompt: 'You are BORJIE MD evaluating eviction notice lawfulness.',
    config: {
      extractionStrictness: 'all-or-fail',
      requiredVariables: [
        'tenantId',
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
    id: 'deposit-refund',
    description: 'Deposit refund split — strict.',
    callerPrompt: 'You are BORJIE MD computing deposit refunds on vacate.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['depositKES', 'damageCostKES', 'unpaidRentKES'],
    },
    mustInclude: ['damageCostKES', 'unpaidRentKES'],
  },
  {
    id: 'mediation-offer-draft',
    description: 'Mediation offer drafting — strict, with addendum.',
    callerPrompt: 'You are BORJIE MD drafting mediation offers.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['tenantId', 'arrearsKES', 'mediationDeadline'],
      addendum: 'Tone: firm but non-threatening. No threats of escalation in the body.',
    },
    mustInclude: ['Tone: firm but non-threatening', 'arrearsKES', 'mediationDeadline'],
  },
  {
    id: 'payment-plan-structure',
    description: 'Payment plan — strict, multiple money + date vars.',
    callerPrompt: 'You are BORJIE MD proposing payment plans.',
    config: {
      extractionStrictness: 'strict',
      requiredVariables: ['arrearsKES', 'planMonths', 'aprPercent', 'firstInstallmentDate'],
    },
    mustInclude: ['planMonths', 'aprPercent'],
  },
  {
    id: 'portfolio-rent-roll',
    description: 'Portfolio rent-roll consolidation — lenient (multi-unit, missing data tolerable).',
    callerPrompt: 'You are BORJIE MD consolidating portfolio rent-roll.',
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
      addendum: 'Cite TZ Rental Act §11.',
    });
    const reflectIdx = out.indexOf('Step 4 — Reflect');
    const addendumIdx = out.indexOf('Cite TZ Rental Act §11.');
    expect(reflectIdx).toBeGreaterThan(0);
    expect(addendumIdx).toBeGreaterThan(reflectIdx);
  });
});
