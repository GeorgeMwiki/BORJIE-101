/**
 * Self-Discover task-class fixtures.
 *
 * Eight task classes covering the MD's high-stakes + routine work.
 * Each fixture pairs:
 *   - the (taskClass, jurisdiction) pair
 *   - sample task inputs the SELECT/ADAPT/IMPLEMENT pipeline grounds on
 *   - the expected primitive ids the SELECT phase should pick
 *   - the expected step count of the IMPLEMENT output
 */

import type { BorjieTaskClass, TaskSampleInput } from '../types.js';

export interface SelfDiscoverFixture {
  readonly id: string;
  readonly taskClass: BorjieTaskClass;
  readonly jurisdiction: string;
  readonly samples: ReadonlyArray<TaskSampleInput>;
  readonly expectedPrimitives: ReadonlyArray<string>;
  readonly expectedMinSteps: number;
}

export const FIXTURES: ReadonlyArray<SelfDiscoverFixture> = [
  {
    id: 'licence-suspension-tz-dsm',
    taskClass: 'licence-suspension',
    jurisdiction: 'TZ-DSM',
    samples: [
      {
        description: 'Counterparty c_8821 has 4 missed payments; owner requests licence suspension; mediation_opt_in=true.',
        variables: { counterpartyId: 'c_8821', missedPayments: 4, mediationOptIn: true },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'check-payment-history',
      'identify-relevant-rules',
      'apply-tz-mining-act',
      'check-mediation-clause',
      'consider-alternatives',
      'propose-and-verify',
      'check-pii-boundary',
    ],
    expectedMinSteps: 8,
  },
  {
    id: 'offtake-renewal-ke-nrb',
    taskClass: 'offtake-renewal',
    jurisdiction: 'KE-NRB',
    samples: [
      {
        description: 'Compute renewal date for offtake O-4422 (started 2025-04-01, 12-mo term).',
        variables: { offtakeId: 'O-4422' },
        jurisdiction: 'KE-NRB',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'apply-formula',
      'check-output-format',
    ],
    expectedMinSteps: 3,
  },
  {
    id: 'royalty-collection-global',
    taskClass: 'royalty-collection',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Generate monthly royalty invoice for counterparty c_4 unit u_3.',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'check-payment-history',
      'apply-formula',
      'check-currency-chain',
      'check-output-format',
    ],
    expectedMinSteps: 5,
  },
  {
    id: 'counterparty-dispute-global',
    taskClass: 'counterparty-dispute',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Counterparty disputes a charge on their March statement.',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'identify-core-issue',
      'consider-alternatives',
      'propose-and-verify',
      'check-pii-boundary',
    ],
    expectedMinSteps: 5,
  },
  {
    id: 'late-fee-tz-dsm',
    taskClass: 'late-fee-compute',
    jurisdiction: 'TZ-DSM',
    samples: [
      {
        description: 'Late fee for counterparty c_8821 — 17 days overdue on KES 32,500.',
        variables: { daysLate: 17, principalKES: 32500 },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'identify-relevant-rules',
      'apply-tz-mining-act',
      'apply-formula',
      'check-currency-chain',
      'verify-with-edge-case',
    ],
    expectedMinSteps: 5,
  },
  {
    id: 'royalty-proration-global',
    taskClass: 'royalty-proration',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Mobilisation day 12 of a 30-day month; monthly royalty KES 24,000.',
        variables: { mobilisationDay: 12, monthDays: 30, monthlyRoyaltyKES: 24000 },
      },
    ],
    expectedPrimitives: [
      'apply-formula',
      'verify-with-edge-case',
      'check-output-format',
    ],
    expectedMinSteps: 3,
  },
  {
    id: 'bond-refund-tz-dsm',
    taskClass: 'bond-refund',
    jurisdiction: 'TZ-DSM',
    samples: [
      {
        description: 'Compute performance-bond refund: KES 60,000 bond, KES 8,500 damage, no unpaid royalty.',
        variables: { bondKES: 60000, damageKES: 8500 },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'apply-tz-mining-act',
      'apply-formula',
      'check-output-format',
    ],
    expectedMinSteps: 4,
  },
  {
    id: 'kra-mri-submit-ke',
    taskClass: 'kra-mri-submit',
    jurisdiction: 'KE-NRB',
    samples: [
      {
        description: 'Prepare KRA-MRI submission for owner L-12, tax year 2025.',
        variables: { ownerId: 'L-12', taxYear: 2025 },
        jurisdiction: 'KE-NRB',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'identify-relevant-rules',
      'apply-formula',
      'check-output-format',
    ],
    expectedMinSteps: 4,
  },
];
