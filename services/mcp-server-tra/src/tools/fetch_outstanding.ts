/**
 * Tool 5/5 — tra.fetch_outstanding
 *
 * Fetch the outstanding tax balance for a TIN. In the real surface
 * this hits TRA's e-filing arrears endpoint; here we return a
 * deterministic mock with a realistic per-tax-head breakdown.
 */
import { z } from 'zod';
import type { TraTool } from '../types.js';

export const fetchOutstandingInputSchema = z
  .object({
    tin: z
      .string()
      .regex(/^112-\d{3}-\d{3}$/, 'TIN must match 112-XXX-XXX'),
  })
  .strict();

const lineItemSchema = z.object({
  taxHead: z.enum(['CIT', 'VAT', 'PAYE', 'WHT', 'ROYALTY', 'SDL']),
  period: z.string(),
  principalTzs: z.number().nonnegative(),
  penaltyTzs: z.number().nonnegative(),
  interestTzs: z.number().nonnegative(),
});

export const fetchOutstandingOutputSchema = z
  .object({
    _stub: z.literal(true),
    source: z.literal('tra.efiling.arrears'),
    tin: z.string(),
    totalOutstandingTzs: z.number().nonnegative(),
    currency: z.literal('TZS'),
    items: z.array(lineItemSchema),
    fetchedAt: z.string(),
    note: z.string(),
  })
  .strict();

export type FetchOutstandingInput = z.infer<typeof fetchOutstandingInputSchema>;
export type FetchOutstandingOutput = z.infer<typeof fetchOutstandingOutputSchema>;

/**
 * Deterministic mock breakdown. Three line items spanning two heads
 * and a small penalty/interest each so downstream renderers can
 * exercise their formatting paths.
 */
function buildMockItems(tin: string): ReadonlyArray<{
  readonly taxHead: 'CIT' | 'VAT' | 'PAYE' | 'WHT' | 'ROYALTY' | 'SDL';
  readonly period: string;
  readonly principalTzs: number;
  readonly penaltyTzs: number;
  readonly interestTzs: number;
}> {
  const tail = Number.parseInt(tin.slice(-3), 10);
  const base = 1_000_000 + (tail % 100) * 75_000;
  return Object.freeze([
    {
      taxHead: 'VAT' as const,
      period: '2026-02',
      principalTzs: base,
      penaltyTzs: Math.round(base * 0.05),
      interestTzs: Math.round(base * 0.02),
    },
    {
      taxHead: 'CIT' as const,
      period: '2025-Q4',
      principalTzs: base * 4,
      penaltyTzs: Math.round(base * 0.05 * 4),
      interestTzs: Math.round(base * 0.02 * 4),
    },
    {
      taxHead: 'ROYALTY' as const,
      period: '2026-03',
      principalTzs: Math.round(base * 0.6),
      penaltyTzs: 0,
      interestTzs: 0,
    },
  ]);
}

export const fetchOutstandingTool: TraTool<
  FetchOutstandingInput,
  FetchOutstandingOutput
> = Object.freeze({
  name: 'tra.fetch_outstanding',
  description:
    'Fetch the outstanding tax balance for a TIN, broken down by tax head (CIT, VAT, PAYE, WHT, ROYALTY, SDL) with principal + penalty + interest in TZS. Stubbed deterministic mock.',
  inputSchema: {
    type: 'object',
    properties: {
      tin: { type: 'string', description: 'TRA TIN, format 112-XXX-XXX' },
    },
    required: ['tin'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      _stub: { type: 'boolean' },
      source: { type: 'string' },
      tin: { type: 'string' },
      totalOutstandingTzs: { type: 'number' },
      currency: { type: 'string' },
      items: { type: 'array' },
      fetchedAt: { type: 'string' },
      note: { type: 'string' },
    },
    required: [
      '_stub',
      'source',
      'tin',
      'totalOutstandingTzs',
      'currency',
      'items',
      'fetchedAt',
      'note',
    ],
  },
  zodInput: fetchOutstandingInputSchema,
  zodOutput: fetchOutstandingOutputSchema,
  async execute(
    input: FetchOutstandingInput,
  ): Promise<FetchOutstandingOutput> {
    const items = buildMockItems(input.tin);
    const total = items.reduce(
      (sum, it) => sum + it.principalTzs + it.penaltyTzs + it.interestTzs,
      0,
    );
    return {
      _stub: true as const,
      source: 'tra.efiling.arrears' as const,
      tin: input.tin,
      totalOutstandingTzs: total,
      currency: 'TZS' as const,
      items: items.map((it) => ({ ...it })),
      fetchedAt: new Date(0).toISOString(),
      note: 'stub: TRA arrears adapter not yet wired — MVP3+',
    };
  },
});
