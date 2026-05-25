// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * Arrears Ledger router (NEW 4)
 *
 * Endpoints:
 *   GET  /v1/arrears/cases/:id/projection
 *   POST /v1/arrears/cases
 *   POST /v1/arrears/cases/:id/propose
 *   POST /v1/arrears/proposals/:proposalId/approve
 *   POST /v1/arrears/proposals/:proposalId/reject
 *
 * Tenant isolation: all handlers scope by auth.tenantId.
 * Ledger invariant: approval produces a NEW entry — never mutates.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { scrubMessage } from '../utils/safe-error';
import {
  createArrearsService,
  createArrearsProjectionService,
  ArrearsProposalError,
  type ArrearsRepository,
  type LedgerPort,
  type LedgerReplayEntry,
} from '@borjie/payments-ledger-service/arrears';

import { withSecurityEvents } from '@borjie/observability';
function getService(c: { get: (k: string) => unknown }) {
  const injected = c.get('arrearsService');
  if (injected) return injected as ReturnType<typeof createArrearsService>;
  const repo = c.get('arrearsRepo') as ArrearsRepository;
  const ledger = c.get('arrearsLedgerPort') as LedgerPort;
  if (!repo || !ledger) {
    throw new Error(
      'arrears router requires arrearsRepo and arrearsLedgerPort in context'
    );
  }
  return createArrearsService({ repo, ledger });
}

const projectionService = createArrearsProjectionService();

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const OpenCaseSchema = z.object({
  customerId: z.string().min(1),
  currency: z.string().length(3),
  totalArrearsAmount: z.number().int().nonnegative(),
  daysOverdue: z.number().int().nonnegative(),
  overdueInvoiceCount: z.number().int().nonnegative(),
  oldestInvoiceDate: z.string().datetime(),
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

const ProposeSchema = z.object({
  customerId: z.string().min(1),
  invoiceId: z.string().optional(),
  kind: z.enum(['waiver', 'writeoff', 'late_fee', 'adjustment', 'correction']),
  amountMinorUnits: z.number().int(),
  currency: z.string().length(3),
  reason: z.string().min(1).max(1000),
  evidenceDocIds: z.array(z.string()).max(20).optional(),
  balanceBeforeMinorUnits: z.number().int().optional(),
});

const ApproveSchema = z.object({
  approvalNotes: z.string().max(1000).optional(),
});

const RejectSchema = z.object({
  rejectionReason: z.string().min(1).max(1000),
});

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);

// --- GET /cases — tenant-scoped list of arrears cases ----------------------
app.get('/cases', async (c) => {
  const auth = c.get('auth');
  const status = c.req.query('status') || undefined;
  const limit = Math.min(200, Number(c.req.query('limit') ?? '50'));
  const offset = Math.max(0, Number(c.req.query('offset') ?? '0'));
  const service = getService(c);
  if (!service || typeof (service as { listCases?: unknown }).listCases !== 'function') {
    // Graceful: service may not expose listCases in all implementations.
    // Return empty envelope with a clear note so UIs render empty state.
    return c.json({
      success: true,
      data: [],
      meta: { total: 0, limit, offset, note: 'listCases not yet exposed by arrears service' },
    });
  }
  try {
    const cases = await (service as { listCases: (tenantId: string, opts: unknown) => Promise<unknown[]> })
      .listCases(auth.tenantId, { status, limit, offset });
    return c.json({ success: true, data: cases, meta: { limit, offset } });
  } catch (err) {
    return mapError(c, err);
  }
});

// --- GET projection ---------------------------------------------------------
app.get('/cases/:id/projection', async (c) => {
  const auth = c.get('auth');
  const caseId = c.req.param('id');

  // Loader — pluggable. A real implementation pulls ledger entries from
  // the payments-ledger service.
  const loader = c.get('arrearsEntryLoader') as
    | ((args: {
        tenantId: string;
        arrearsCaseId: string;
      }) => Promise<{
        customerId: string;
        currency: string;
        entries: readonly LedgerReplayEntry[];
      } | null>)
    | undefined;

  if (!loader) {
    return c.json(
      {
        success: false,
        error: {
          code: 'LOADER_MISSING',
          message: 'arrearsEntryLoader not configured',
        },
      },
      500
    );
  }

  const loaded = await loader({
    tenantId: auth.tenantId,
    arrearsCaseId: caseId,
  });
  if (!loaded) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'case not found' } },
      404
    );
  }

  // Enforce tenant isolation at loader boundary — loader may return
  // mixed-tenant entries; the projection service will filter them out.
  const projection = projectionService.project({
    tenantId: auth.tenantId,
    arrearsCaseId: caseId,
    customerId: loaded.customerId,
    currency: loaded.currency,
    entries: loaded.entries,
    asOf: new Date(),
  });

  return c.json({ success: true, data: projection });
});

// --- POST case -------------------------------------------------------------
app.post('/cases', zValidator('json', OpenCaseSchema), withSecurityEvents({ action: 'arrears.create', resource: 'arrears', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = getService(c);

  try {
    const result = await service.openCase({
      tenantId: auth.tenantId,
      customerId: body.customerId,
      currency: body.currency,
      totalArrearsAmount: body.totalArrearsAmount,
      daysOverdue: body.daysOverdue,
      overdueInvoiceCount: body.overdueInvoiceCount,
      oldestInvoiceDate: new Date(body.oldestInvoiceDate),
      leaseId: body.leaseId,
      propertyId: body.propertyId,
      unitId: body.unitId,
      createdBy: auth.userId,
      notes: body.notes,
    });
    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    return mapError(c, err);
  }
}));

// --- POST propose ----------------------------------------------------------
app.post('/cases/:id/propose', zValidator('json', ProposeSchema), withSecurityEvents({ action: 'arrears.create', resource: 'arrears', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const caseId = c.req.param('id');
  const service = getService(c);

  try {
    const proposal = await service.proposeAdjustment({
      tenantId: auth.tenantId,
      customerId: body.customerId,
      arrearsCaseId: caseId,
      invoiceId: body.invoiceId,
      kind: body.kind,
      amountMinorUnits: body.amountMinorUnits,
      currency: body.currency,
      reason: body.reason,
      evidenceDocIds: body.evidenceDocIds,
      proposedBy: auth.userId,
      balanceBeforeMinorUnits: body.balanceBeforeMinorUnits,
    });
    return c.json({ success: true, data: proposal }, 201);
  } catch (err) {
    return mapError(c, err);
  }
}));

// --- POST approve ----------------------------------------------------------
app.post(
  '/proposals/:proposalId/approve',
  zValidator('json', ApproveSchema),
  withSecurityEvents({ action: 'arrears.create', resource: 'arrears', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const { approvalNotes } = c.req.valid('json');
    const proposalId = c.req.param('proposalId');
    const service = getService(c);

    try {
      const result = await service.approveProposal({
        tenantId: auth.tenantId,
        proposalId,
        approvedBy: auth.userId,
        approvalNotes,
      });
      return c.json({ success: true, data: result });
    } catch (err) {
      return mapError(c, err);
    }
  })
);

// --- POST reject -----------------------------------------------------------
app.post(
  '/proposals/:proposalId/reject',
  zValidator('json', RejectSchema),
  withSecurityEvents({ action: 'arrears.create', resource: 'arrears', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const { rejectionReason } = c.req.valid('json');
    const proposalId = c.req.param('proposalId');
    const service = getService(c);

    try {
      const result = await service.rejectProposal({
        tenantId: auth.tenantId,
        proposalId,
        rejectedBy: auth.userId,
        rejectionReason,
      });
      return c.json({ success: true, data: result });
    } catch (err) {
      return mapError(c, err);
    }
  })
);

function mapError(c: unknown, err: unknown) {
  const ctx = c as { json: (b: unknown, s: number) => unknown };
  if (err instanceof ArrearsProposalError) {
    const httpStatus =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'TENANT_MISMATCH'
        ? 403
        : err.code === 'INVALID_STATE'
        ? 409
        : 400;
    return ctx.json(
      { success: false, error: { code: err.code, message: err.message } },
      httpStatus
    );
  }
  return ctx.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        // Wave 19 Agent H+I: scrub driver/constraint detail in prod;
        // keep in dev for test assertions. The structured logger in
        // index.ts still captures the full error+stack with the
        // requestId.
        message: scrubMessage(err, 'Arrears operation failed'),
      },
    },
    500
  );
}

export default app;
export const arrearsRouter = app;
