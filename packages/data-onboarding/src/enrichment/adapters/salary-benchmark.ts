/**
 * Salary benchmark — market-rate enrichment via research-tools.
 *
 * Production: hits Korn Ferry / Mercer / Payscale feeds via 18D
 * research-tools adapter. Scaffold: deterministic fake that returns
 * a synthetic benchmark band when role + location are present.
 */

import type { EnrichedField } from '../../types.js';

export interface SalaryBenchmarker {
  benchmark(args: {
    readonly role: string;
    readonly location: string;
  }): Promise<ReadonlyArray<EnrichedField>>;
}

export function createInMemorySalaryBenchmarker(): SalaryBenchmarker {
  return Object.freeze({
    async benchmark(args: {
      readonly role: string;
      readonly location: string;
    }): Promise<ReadonlyArray<EnrichedField>> {
      if (args.role.trim().length === 0 || args.location.trim().length === 0) {
        return Object.freeze([]);
      }
      return Object.freeze([
        Object.freeze({
          field: 'salary_market_p25',
          value: 500_000,
          source: 'salary_benchmark',
          confidence: 0.6,
        }),
        Object.freeze({
          field: 'salary_market_p50',
          value: 750_000,
          source: 'salary_benchmark',
          confidence: 0.6,
        }),
        Object.freeze({
          field: 'salary_market_p75',
          value: 1_100_000,
          source: 'salary_benchmark',
          confidence: 0.6,
        }),
      ]);
    },
  });
}
