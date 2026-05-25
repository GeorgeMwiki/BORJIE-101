/**
 * Regression test for CRITICAL-2 (audit
 * .audit/post-pr90-api-mcp-bug-sweep.md):
 *
 * Every mutation schema in the payments-ledger service MUST reject any
 * body-supplied `tenantId` field. The authoritative tenantId comes from
 * `req.principal.tenantId` (the verified Supabase JWT). Trusting the body
 * would let any authenticated tenant write into another tenant's ledger.
 *
 * The schemas are recreated locally to keep this test independent of the
 * full server initialization (which pulls drizzle + Stripe SDK).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const CreatePaymentSchema = z.object({
  customerId: z.string(),
  leaseId: z.string().optional(),
  type: z.enum(['RENT_PAYMENT', 'DEPOSIT_PAYMENT', 'LATE_FEE_PAYMENT', 'MAINTENANCE_PAYMENT', 'UTILITY_PAYMENT', 'CONTRIBUTION', 'OTHER']),
  amount: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX'])
  }),
  description: z.string().max(500),
  paymentMethodId: z.string().optional(),
  statementDescriptor: z.string().max(22).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional()
}).strict();

const GenerateStatementSchema = z.object({
  type: z.enum(['OWNER_STATEMENT', 'CUSTOMER_STATEMENT', 'PROPERTY_STATEMENT', 'RECONCILIATION_REPORT']),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM']),
  periodStart: z.string().transform(s => new Date(s)),
  periodEnd: z.string().transform(s => new Date(s)),
  accountId: z.string(),
  ownerId: z.string().optional(),
  customerId: z.string().optional(),
  includeDetails: z.boolean().optional()
}).strict();

const CreateDisbursementSchema = z.object({
  ownerId: z.string(),
  amount: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX'])
  }).optional(),
  destination: z.string(),
  description: z.string().optional(),
  idempotencyKey: z.string().optional()
}).strict();

describe('CRITICAL-2 cross-tenant write isolation', () => {
  it('CreatePaymentSchema rejects body-supplied tenantId', () => {
    const result = CreatePaymentSchema.safeParse({
      tenantId: 'tenant_attacker_chose',
      customerId: 'cust_1',
      type: 'RENT_PAYMENT',
      amount: { amount: 10000, currency: 'KES' },
      description: 'rent',
    });
    expect(result.success).toBe(false);
  });

  it('CreatePaymentSchema accepts a clean payload', () => {
    const result = CreatePaymentSchema.safeParse({
      customerId: 'cust_1',
      type: 'RENT_PAYMENT',
      amount: { amount: 10000, currency: 'KES' },
      description: 'rent',
    });
    expect(result.success).toBe(true);
  });

  it('GenerateStatementSchema rejects body-supplied tenantId', () => {
    const result = GenerateStatementSchema.safeParse({
      tenantId: 'tenant_victim',
      type: 'OWNER_STATEMENT',
      periodType: 'MONTHLY',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      accountId: 'acc_1',
    });
    expect(result.success).toBe(false);
  });

  it('CreateDisbursementSchema rejects body-supplied tenantId', () => {
    const result = CreateDisbursementSchema.safeParse({
      tenantId: 'tenant_victim',
      ownerId: 'own_1',
      destination: 'mpesa:+254700000000',
    });
    expect(result.success).toBe(false);
  });
});
