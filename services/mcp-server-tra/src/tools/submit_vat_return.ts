/**
 * Tool 4/5 — tra.submit_vat_return
 *
 * Submit a value-added-tax (VAT) return for a tenant against a tax
 * period (TRA period codes: YYYY-MM, e.g. "2026-04"). Stubbed
 * deterministic call returning a reference number shaped like the
 * real TRA portal format `VAT-YYYY-MM-XXXXXX`.
 */
import { z } from 'zod';
import type { TraTool } from '../types.js';

export const submitVatReturnInputSchema = z
  .object({
    tenant_id: z.string().min(1).max(128),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM'),
  })
  .strict();

export const submitVatReturnOutputSchema = z
  .object({
    _stub: z.literal(true),
    source: z.literal('tra.efiling'),
    tenantId: z.string(),
    period: z.string(),
    referenceNo: z.string(),
    submittedAt: z.string(),
    status: z.enum(['received', 'processing', 'accepted', 'rejected']),
    note: z.string(),
  })
  .strict();

export type SubmitVatReturnInput = z.infer<typeof submitVatReturnInputSchema>;
export type SubmitVatReturnOutput = z.infer<typeof submitVatReturnOutputSchema>;

/**
 * Build a deterministic 6-digit suffix from tenantId + period so the
 * same input always yields the same reference (test reproducibility).
 */
function deterministicSuffix(tenantId: string, period: string): string {
  let h = 0;
  const input = `${tenantId}|${period}`;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(h);
  return String(positive % 1_000_000).padStart(6, '0');
}

export const submitVatReturnTool: TraTool<
  SubmitVatReturnInput,
  SubmitVatReturnOutput
> = Object.freeze({
  name: 'tra.submit_vat_return',
  description:
    'Submit a VAT return for a tenant against a tax period (YYYY-MM). Returns a TRA portal-style reference number `VAT-YYYY-MM-XXXXXX`. Stub: no real submission until MVP3+.',
  inputSchema: {
    type: 'object',
    properties: {
      tenant_id: { type: 'string', description: 'Borjie tenant scope' },
      period: { type: 'string', description: 'TRA period code YYYY-MM' },
    },
    required: ['tenant_id', 'period'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      _stub: { type: 'boolean' },
      source: { type: 'string' },
      tenantId: { type: 'string' },
      period: { type: 'string' },
      referenceNo: { type: 'string' },
      submittedAt: { type: 'string' },
      status: {
        type: 'string',
        enum: ['received', 'processing', 'accepted', 'rejected'],
      },
      note: { type: 'string' },
    },
    required: [
      '_stub',
      'source',
      'tenantId',
      'period',
      'referenceNo',
      'submittedAt',
      'status',
      'note',
    ],
  },
  zodInput: submitVatReturnInputSchema,
  zodOutput: submitVatReturnOutputSchema,
  async execute(input: SubmitVatReturnInput): Promise<SubmitVatReturnOutput> {
    const suffix = deterministicSuffix(input.tenant_id, input.period);
    return Object.freeze({
      _stub: true as const,
      source: 'tra.efiling' as const,
      tenantId: input.tenant_id,
      period: input.period,
      referenceNo: `VAT-${input.period}-${suffix}`,
      submittedAt: new Date(0).toISOString(),
      status: 'received' as const,
      note: 'stub: TRA e-filing adapter not yet wired — MVP3+',
    });
  },
});
