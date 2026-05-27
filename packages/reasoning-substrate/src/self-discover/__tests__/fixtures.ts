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
    id: 'eviction-tz-dsm',
    taskClass: 'eviction',
    jurisdiction: 'TZ-DSM',
    samples: [
      {
        description: 'Tenant t_8821 has 4 missed payments; landlord requests eviction; mediation_opt_in=true.',
        variables: { tenantId: 't_8821', missedPayments: 4, mediationOptIn: true },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'check-payment-history',
      'identify-relevant-rules',
      'apply-tz-rental-act',
      'check-mediation-clause',
      'consider-alternatives',
      'propose-and-verify',
      'check-pii-boundary',
    ],
    expectedMinSteps: 8,
  },
  {
    id: 'lease-renewal-ke-nrb',
    taskClass: 'lease-renewal',
    jurisdiction: 'KE-NRB',
    samples: [
      {
        description: 'Compute renewal date for lease L-4422 (started 2025-04-01, 12-mo term).',
        variables: { leaseId: 'L-4422' },
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
    id: 'rent-collection-global',
    taskClass: 'rent-collection',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Generate monthly rent invoice for tenant t_4 unit u_3.',
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
    id: 'tenant-dispute-global',
    taskClass: 'tenant-dispute',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Tenant disputes a charge on their March statement.',
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
        description: 'Late fee for tenant t_8821 — 17 days overdue on KES 32,500.',
        variables: { daysLate: 17, principalKES: 32500 },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'identify-relevant-rules',
      'apply-tz-rental-act',
      'apply-formula',
      'check-currency-chain',
      'verify-with-edge-case',
    ],
    expectedMinSteps: 5,
  },
  {
    id: 'rent-proration-global',
    taskClass: 'rent-proration',
    jurisdiction: 'GLOBAL',
    samples: [
      {
        description: 'Move-in day 12 of a 30-day month; monthly rent KES 24,000.',
        variables: { moveInDay: 12, monthDays: 30, monthlyRentKES: 24000 },
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
    id: 'deposit-refund-tz-dsm',
    taskClass: 'deposit-refund',
    jurisdiction: 'TZ-DSM',
    samples: [
      {
        description: 'Compute deposit refund: KES 60,000 deposit, KES 8,500 damage, no unpaid rent.',
        variables: { depositKES: 60000, damageKES: 8500 },
        jurisdiction: 'TZ-DSM',
      },
    ],
    expectedPrimitives: [
      'gather-relevant-facts',
      'apply-tz-rental-act',
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
        description: 'Prepare KRA-MRI submission for landlord L-12, tax year 2025.',
        variables: { landlordId: 'L-12', taxYear: 2025 },
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
