/**
 * Tool 2/5 — tra.compute_royalty
 *
 * Compute a mineral-royalty due to TRA using the published Mining Act
 * rate schedule. Royalty is levied on the gross-sales value at the
 * mine gate, per the Mining (Mineral Rights) Regulations.
 *
 * Rates (Sixth Schedule of the Mining Act, as amended):
 *   gold            6.0%
 *   diamond         5.0%
 *   gemstone        6.0%
 *   metallic        4.0%   (e.g. copper, iron-ore, tin)
 *   base_metals     3.0%
 *   industrial      3.0%   (e.g. limestone, gypsum, salt)
 *   coal_uranium    3.0%
 *   building        0.0%   (royalty exempt at federal layer)
 *
 * Pure deterministic computation — no external IO, so the value here
 * is real even though it is exposed alongside stubbed tools.
 */
import { z } from 'zod';
import type { TraTool } from '../types.js';

export const MINERAL_RATES = Object.freeze({
  gold: 0.06,
  diamond: 0.05,
  gemstone: 0.06,
  metallic: 0.04,
  base_metals: 0.03,
  industrial: 0.03,
  coal_uranium: 0.03,
  building: 0.0,
} as const);

export type MineralKind = keyof typeof MINERAL_RATES;

export const computeRoyaltyInputSchema = z
  .object({
    mineral: z.enum([
      'gold',
      'diamond',
      'gemstone',
      'metallic',
      'base_metals',
      'industrial',
      'coal_uranium',
      'building',
    ]),
    gross_value_tzs: z.number().nonnegative().finite(),
  })
  .strict();

export const computeRoyaltyOutputSchema = z
  .object({
    _stub: z.literal(false),
    source: z.literal('tra.royalty-schedule'),
    mineral: z.string(),
    rate: z.number().nonnegative(),
    grossValueTzs: z.number().nonnegative(),
    royaltyTzs: z.number().nonnegative(),
    legalBasis: z.string(),
    computedAt: z.string(),
  })
  .strict();

export type ComputeRoyaltyInput = z.infer<typeof computeRoyaltyInputSchema>;
export type ComputeRoyaltyOutput = z.infer<typeof computeRoyaltyOutputSchema>;

function roundTzs(value: number): number {
  return Math.round(value * 100) / 100;
}

export const computeRoyaltyTool: TraTool<
  ComputeRoyaltyInput,
  ComputeRoyaltyOutput
> = Object.freeze({
  name: 'tra.compute_royalty',
  description:
    'Compute mineral royalty payable to TRA using the published Mining Act rate schedule (e.g. gold 6%, diamond 5%, base metals 3%). Input gross-sales value at the mine gate in TZS; output royalty in TZS rounded to the nearest cent.',
  inputSchema: {
    type: 'object',
    properties: {
      mineral: {
        type: 'string',
        enum: [
          'gold',
          'diamond',
          'gemstone',
          'metallic',
          'base_metals',
          'industrial',
          'coal_uranium',
          'building',
        ],
        description: 'Mineral category from the Sixth Schedule',
      },
      gross_value_tzs: {
        type: 'number',
        minimum: 0,
        description: 'Gross sales value at the mine gate, TZS',
      },
    },
    required: ['mineral', 'gross_value_tzs'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      _stub: { type: 'boolean' },
      source: { type: 'string' },
      mineral: { type: 'string' },
      rate: { type: 'number' },
      grossValueTzs: { type: 'number' },
      royaltyTzs: { type: 'number' },
      legalBasis: { type: 'string' },
      computedAt: { type: 'string' },
    },
    required: [
      '_stub',
      'source',
      'mineral',
      'rate',
      'grossValueTzs',
      'royaltyTzs',
      'legalBasis',
      'computedAt',
    ],
  },
  zodInput: computeRoyaltyInputSchema,
  zodOutput: computeRoyaltyOutputSchema,
  async execute(input: ComputeRoyaltyInput): Promise<ComputeRoyaltyOutput> {
    const rate = MINERAL_RATES[input.mineral as MineralKind];
    const royalty = roundTzs(input.gross_value_tzs * rate);
    return Object.freeze({
      _stub: false as const,
      source: 'tra.royalty-schedule' as const,
      mineral: input.mineral,
      rate,
      grossValueTzs: input.gross_value_tzs,
      royaltyTzs: royalty,
      legalBasis:
        'Mining Act CAP 123, Sixth Schedule (as amended by the Written Laws (Misc. Amend.) Acts)',
      computedAt: new Date(0).toISOString(),
    });
  },
});
