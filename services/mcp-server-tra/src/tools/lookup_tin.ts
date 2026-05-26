/**
 * Tool 1/5 — tra.lookup_tin
 *
 * Look up a Tanzanian Tax Identification Number (TIN). TINs issued by
 * TRA follow the `112-XXX-XXX` format (leading "112" identifies the
 * country/issuance series). Stubbed deterministic mock until MVP3+.
 */
import { z } from 'zod';
import type { TraTool } from '../types.js';

export const lookupTinInputSchema = z
  .object({
    tin: z
      .string()
      .regex(/^112-\d{3}-\d{3}$/, 'TIN must match 112-XXX-XXX'),
  })
  .strict();

export const lookupTinOutputSchema = z
  .object({
    _stub: z.literal(true),
    source: z.literal('tra.tin-registry'),
    tin: z.string(),
    status: z.enum(['active', 'dormant', 'cancelled', 'unknown']),
    businessName: z.string(),
    registrationDate: z.string(),
    taxOffice: z.string(),
    fetchedAt: z.string(),
    note: z.string(),
  })
  .strict();

export type LookupTinInput = z.infer<typeof lookupTinInputSchema>;
export type LookupTinOutput = z.infer<typeof lookupTinOutputSchema>;

/**
 * Deterministic stub. The status cycles through a small set based on
 * the trailing digit so eval harnesses can exercise every branch
 * without coordinating fixtures.
 */
function statusFor(tin: string): LookupTinOutput['status'] {
  const last = tin.charAt(tin.length - 1);
  if (last === '0') return 'unknown';
  if (last === '9') return 'cancelled';
  if (last === '8') return 'dormant';
  return 'active';
}

export const lookupTinTool: TraTool<LookupTinInput, LookupTinOutput> =
  Object.freeze({
    name: 'tra.lookup_tin',
    description:
      'Look up a Tanzanian Tax Identification Number (TIN) in the TRA registry. Returns business name, status, registration date, and assigned tax office. TIN format: 112-XXX-XXX.',
    inputSchema: {
      type: 'object',
      properties: {
        tin: {
          type: 'string',
          description: 'TRA TIN in the format 112-XXX-XXX',
        },
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
        status: {
          type: 'string',
          enum: ['active', 'dormant', 'cancelled', 'unknown'],
        },
        businessName: { type: 'string' },
        registrationDate: { type: 'string' },
        taxOffice: { type: 'string' },
        fetchedAt: { type: 'string' },
        note: { type: 'string' },
      },
      required: [
        '_stub',
        'source',
        'tin',
        'status',
        'businessName',
        'registrationDate',
        'taxOffice',
        'fetchedAt',
        'note',
      ],
    },
    zodInput: lookupTinInputSchema,
    zodOutput: lookupTinOutputSchema,
    async execute(input: LookupTinInput): Promise<LookupTinOutput> {
      const status = statusFor(input.tin);
      return Object.freeze({
        _stub: true as const,
        source: 'tra.tin-registry' as const,
        tin: input.tin,
        status,
        businessName: `MOCK Mining Co. (${input.tin})`,
        registrationDate: '2019-04-12',
        taxOffice: 'Dar es Salaam Large Taxpayers Department',
        fetchedAt: new Date(0).toISOString(),
        note: 'stub: TRA TIN registry adapter not yet wired — MVP3+',
      });
    },
  });
