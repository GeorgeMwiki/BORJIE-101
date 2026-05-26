/**
 * Tool 3/5 — tra.compute_corporate_tax
 *
 * Compute corporate income tax (CIT) on Tanzanian mining profits.
 *
 * Rates:
 *   standard CIT                          30 %
 *   mining-qualifying (listed on DSE,
 *     local content thresholds met)       25 %
 *
 * The mining-qualifying preferential rate mirrors the Income Tax Act
 * incentive for resident mining companies that publicly list on the
 * Dar es Salaam Stock Exchange.
 */
import { z } from 'zod';
import type { TraTool } from '../types.js';

export const STANDARD_CIT_RATE = 0.3;
export const MINING_QUALIFYING_CIT_RATE = 0.25;

export const computeCorporateTaxInputSchema = z
  .object({
    profit_tzs: z.number().nonnegative().finite(),
    mining_qualifying: z.boolean(),
  })
  .strict();

export const computeCorporateTaxOutputSchema = z
  .object({
    _stub: z.literal(false),
    source: z.literal('tra.cit-schedule'),
    profitTzs: z.number().nonnegative(),
    miningQualifying: z.boolean(),
    rate: z.number().nonnegative(),
    taxTzs: z.number().nonnegative(),
    netProfitTzs: z.number(),
    legalBasis: z.string(),
    computedAt: z.string(),
  })
  .strict();

export type ComputeCorporateTaxInput = z.infer<
  typeof computeCorporateTaxInputSchema
>;
export type ComputeCorporateTaxOutput = z.infer<
  typeof computeCorporateTaxOutputSchema
>;

function roundTzs(value: number): number {
  return Math.round(value * 100) / 100;
}

export const computeCorporateTaxTool: TraTool<
  ComputeCorporateTaxInput,
  ComputeCorporateTaxOutput
> = Object.freeze({
  name: 'tra.compute_corporate_tax',
  description:
    'Compute corporate income tax (CIT) on Tanzanian mining profits. Applies 30% standard rate or 25% mining-qualifying preferential rate (DSE-listed, local content thresholds met).',
  inputSchema: {
    type: 'object',
    properties: {
      profit_tzs: {
        type: 'number',
        minimum: 0,
        description: 'Annual taxable profit, TZS',
      },
      mining_qualifying: {
        type: 'boolean',
        description:
          'true when DSE-listed and meeting local-content thresholds (25% rate)',
      },
    },
    required: ['profit_tzs', 'mining_qualifying'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      _stub: { type: 'boolean' },
      source: { type: 'string' },
      profitTzs: { type: 'number' },
      miningQualifying: { type: 'boolean' },
      rate: { type: 'number' },
      taxTzs: { type: 'number' },
      netProfitTzs: { type: 'number' },
      legalBasis: { type: 'string' },
      computedAt: { type: 'string' },
    },
    required: [
      '_stub',
      'source',
      'profitTzs',
      'miningQualifying',
      'rate',
      'taxTzs',
      'netProfitTzs',
      'legalBasis',
      'computedAt',
    ],
  },
  zodInput: computeCorporateTaxInputSchema,
  zodOutput: computeCorporateTaxOutputSchema,
  async execute(
    input: ComputeCorporateTaxInput,
  ): Promise<ComputeCorporateTaxOutput> {
    const rate = input.mining_qualifying
      ? MINING_QUALIFYING_CIT_RATE
      : STANDARD_CIT_RATE;
    const tax = roundTzs(input.profit_tzs * rate);
    const net = roundTzs(input.profit_tzs - tax);
    return Object.freeze({
      _stub: false as const,
      source: 'tra.cit-schedule' as const,
      profitTzs: input.profit_tzs,
      miningQualifying: input.mining_qualifying,
      rate,
      taxTzs: tax,
      netProfitTzs: net,
      legalBasis:
        'Income Tax Act CAP 332 s.4(1) + Mining Sector preferential rate (Finance Act amendments)',
      computedAt: new Date(0).toISOString(),
    });
  },
});
