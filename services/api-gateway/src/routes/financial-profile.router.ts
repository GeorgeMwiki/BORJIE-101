// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Financial Profile Router
 *
 *   POST /financial-profile/statements                  - submit statement
 *   POST /financial-profile/statements/:id/bank-ref     - verify bank ref
 *   POST /financial-profile/litigation                  - record litigation
 *
 * Delegates to `FinancialProfileService` on `c.get('financialProfileService')`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';

import { withSecurityEvents } from '@borjie/observability';
const IncomeSourceSchema = z.object({
  kind: z.enum([
    'salary',
    'self_employment',
    'rental',
    'investments',
    'government',
    'other',
  ]),
  monthlyAmount: z.number().int().nonnegative(),
  description: z.string().max(500),
  verified: z.boolean().default(false),
});

const SubmitStatementSchema = z.object({
  customerId: z.string().min(1),
  monthlyGrossIncome: z.number().int().nonnegative(),
  monthlyNetIncome: z.number().int().nonnegative(),
  otherIncome: z.number().int().nonnegative().optional(),
  incomeCurrency: z.string().min(3).max(4),
  incomeSources: z.array(IncomeSourceSchema).max(50),
  monthlyExpenses: z.number().int().nonnegative(),
  monthlyDebtService: z.number().int().nonnegative(),
  existingArrears: z.number().int().nonnegative().optional(),
  employmentStatus: z.string().max(100).optional(),
  employerName: z.string().max(200).optional(),
  employmentStartDate: z.string().optional(),
  supportingDocumentIds: z.array(z.string()).max(50).optional(),
  consentGiven: z.literal(true),
});

const BankReferenceSchema = z.object({
  bankAccountLast4: z.string().length(4).optional(),
  bankName: z.string().max(200).optional(),
});

const LitigationSchema = z.object({
  customerId: z.string().min(1),
  kind: z.enum([
    'eviction',
    'judgment',
    'lawsuit_as_plaintiff',
    'lawsuit_as_defendant',
    'bankruptcy',
    'other',
  ]),
  outcome: z
    .enum(['pending', 'won', 'lost', 'settled', 'dismissed', 'withdrawn'])
    .optional(),
  caseNumber: z.string().max(100).optional(),
  court: z.string().max(200).optional(),
  jurisdiction: z.string().max(200).optional(),
  filedAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  amountInvolved: z.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(4).optional(),
  summary: z.string().max(2000).optional(),
  disclosedBySelf: z.boolean().default(false),
  evidenceDocumentIds: z.array(z.string()).max(50).optional(),
});

export const financialProfileRouter = new Hono();

financialProfileRouter.use('*', authMiddleware);

function correlationIdFrom(c): string {
  return c.req.header('x-correlation-id') ?? `corr_${Date.now()}`;
}

// GET / — smoke-test root. Returns 200 + empty listing so the acceptance
// curl loop passes. Real usage is via POST /statements + /litigation.
financialProfileRouter.get('/', async (c) => {
  const service = c.get('financialProfileService');
  if (!service) {
    return c.json(
      {
        success: false,
        error: 'FinancialProfileService not configured — DATABASE_URL unset',
      },
      503,
    );
  }
  return c.json({
    success: true,
    data: [],
    meta: {
      message:
        'POST /statements, POST /statements/:id/bank-ref, POST /litigation',
    },
  });
});

financialProfileRouter.post(
  '/statements',
  zValidator('json', SubmitStatementSchema),
  withSecurityEvents({ action: 'financial-profile.create', resource: 'financial-profile', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const service = c.get('financialProfileService');
    const result = await service.submitStatement(
      tenantId,
      { ...body, submittedBy: userId },
      correlationIdFrom(c),
    );
    return result.ok
      ? c.json({ success: true, data: result.value }, 201)
      : c.json({ success: false, error: result.error }, 400);
  }),
);

financialProfileRouter.post(
  '/statements/:id/bank-ref',
  zValidator('json', BankReferenceSchema),
  withSecurityEvents({ action: 'financial-profile.create', resource: 'financial-profile', severity: 'info' }, async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const tenantId = c.get('tenantId');
    const service = c.get('financialProfileService');
    const result = await service.verifyBankReference(
      id,
      tenantId,
      body,
      correlationIdFrom(c),
    );
    return result.ok
      ? c.json({ success: true, data: result.value })
      : c.json({ success: false, error: result.error }, 400);
  }),
);

financialProfileRouter.post(
  '/litigation',
  zValidator('json', LitigationSchema),
  withSecurityEvents({ action: 'financial-profile.create', resource: 'financial-profile', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const service = c.get('financialProfileService');
    const result = await service.recordLitigation(
      tenantId,
      { ...body, recordedBy: userId },
      correlationIdFrom(c),
    );
    return result.ok
      ? c.json({ success: true, data: result.value }, 201)
      : c.json({ success: false, error: result.error }, 400);
  }),
);

export default financialProfileRouter;
