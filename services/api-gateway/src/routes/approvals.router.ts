/**
 * Approval Workflow API (Wave 26 Agent Z3)
 *
 *   POST /                    → create a pending approval request
 *   GET  /                    → list pending approvals for the current user
 *   GET  /:id                 → fetch one
 *   POST /:id/approve         → record an approval decision
 *   POST /:id/reject          → record a rejection decision
 *   POST /:id/escalate        → escalate to a higher approver
 *   GET  /policies/:type      → fetch the effective policy (overrides + defaults)
 *   PUT  /policies/:type      → upsert a per-tenant policy override (admin)
 *   GET  /history             → filtered, paginated history
 *
 * Integration point with autonomy policy (Wave 18): the autonomy-policy
 * `requireHumanApproval` threshold emits a signal that callers should
 * route through this approval service. Callers can detect the threshold
 * via the service-context shim (`services.autonomy.policyService`) and
 * POST a request to this router's root when the policy demands a human.
 *
 * Wired to `ApprovalWorkflowService` via the composition root.
 */


import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';
import { asApprovalRequestId } from '@borjie/domain-services/approvals';
import { e400, e404, e503, errorResponse } from '../utils/error-response';
// F10 DecisionTrace — record the approve/reject decision (inputs,
// rule that fired, outcome) so the admin replay UI can audit the
// four-eye gate. Fire-and-forget persistence; never blocks the request.
import { startDecisionTrace } from '@borjie/observability';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function notConfigured(c: any) {
  return e503(
    c,
    'APPROVAL_SERVICE_UNAVAILABLE',
    'ApprovalWorkflowService not configured — DATABASE_URL unset.',
  );
}

function svc(c: any) {
  const services = c.get('services') ?? {};
  return (
    services.approvals?.service ??
    c.get('approvalWorkflowService') ??
    null
  );
}

function correlationIdOf(c: any): string {
  return (
    (c.get('requestId') as string | undefined) ??
    `corr_${Date.now()}`
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const APPROVAL_TYPE = z.enum([
  'maintenance_cost',
  'lease_exception',
  'refund',
  'discount',
  'payment_flexibility',
]);

const CreateRequestSchema = z.object({
  type: APPROVAL_TYPE,
  justification: z.string().min(1).max(2000),
  details: z.record(z.string(), z.unknown()),
});

const ApproveSchema = z.object({
  comments: z.string().max(2000).nullable().optional(),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(2000),
});

const EscalateSchema = z.object({
  toUserId: z.string().min(1),
  reason: z.string().min(1).max(2000),
});

const PolicySchema = z.object({
  thresholds: z.array(z.any()),
  autoApproveRules: z.array(z.any()),
  approvalChain: z.array(z.any()),
  defaultTimeoutHours: z.number().int().positive(),
  autoEscalateToRole: z.string().nullable(),
});

const HistoryQuerySchema = z.object({
  type: APPROVAL_TYPE.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'escalated']).optional(),
  requesterId: z.string().optional(),
  approverId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  minAmount: z.coerce.number().optional(),
  maxAmount: z.coerce.number().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// POST / — create
// ---------------------------------------------------------------------------
app.post('/', zValidator('json', CreateRequestSchema), withSecurityEvents({ action: 'approval.create', resource: 'approval', severity: 'info' }, async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const body = c.req.valid('json');
  try {
    const result = await service.createApprovalRequest(
      tenantId,
      body.type,
      body.details,
      userId,
      body.justification,
      correlationIdOf(c),
      userId,
    );
    if (!result.success) {
      return e400(c, result.error.code, result.error.message);
    }
    return c.json({ success: true, data: result.data }, 201);
  } catch (err) {
    return routeCatch(c, err, {
      code: 'APPROVAL_CREATE_FAILED',
      status: 500,
      fallback: 'Failed to create approval request',
    });
  }
}));

// ---------------------------------------------------------------------------
// GET / — pending for current user
// ---------------------------------------------------------------------------
app.get('/', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  try {
    const result = await service.getPendingApprovals(userId, tenantId);
    if (!result.success) {
      return e400(c, result.error.code, result.error.message);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'APPROVAL_LIST_FAILED',
      status: 500,
      fallback: 'Failed to list pending approvals',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /history — filtered paginated history
// ---------------------------------------------------------------------------
app.get(
  '/history',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('query', HistoryQuerySchema),
  async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const q = c.req.valid('query');
    try {
      const result = await service.getApprovalHistory(
        tenantId,
        {
          type: q.type,
          status: q.status,
          requesterId: q.requesterId,
          approverId: q.approverId,
          fromDate: q.fromDate,
          toDate: q.toDate,
          minAmount: q.minAmount,
          maxAmount: q.maxAmount,
        },
        { page: q.page, pageSize: q.pageSize },
      );
      if (!result.success) {
        return e400(c, result.error.code, result.error.message);
      }
      return c.json({ success: true, ...result.data });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'APPROVAL_HISTORY_FAILED',
        status: 500,
        fallback: 'Failed to fetch approval history',
      });
    }
  },
);

// ---------------------------------------------------------------------------
// GET /:id — fetch one
// ---------------------------------------------------------------------------
app.get('/:id', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const id = asApprovalRequestId(c.req.param('id'));
  try {
    // Service doesn't expose a direct getById; reach into its repo via
    // the private constructor field so we avoid rewriting the service.
    const repo = (service as any).requestRepo;
    if (!repo?.findById) return notConfigured(c);
    const row = await repo.findById(id, tenantId);
    if (!row) {
      return e404(c, 'REQUEST_NOT_FOUND', 'Approval request not found');
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'APPROVAL_READ_FAILED',
      status: 500,
      fallback: 'Failed to read approval request',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/approve
// ---------------------------------------------------------------------------
app.post(
  '/:id/approve',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.OWNER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', ApproveSchema),
  withSecurityEvents({ action: 'approval.create', resource: 'approval', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const id = asApprovalRequestId(c.req.param('id'));
    const body = c.req.valid('json');
    // F10 DecisionTrace — bracket the approval decision. We add two
    // alternative branches (approve / reject) so the admin replay UI can
    // surface counterfactuals; we then call `choose('approve')` because
    // this is the approve handler.
    const trace = startDecisionTrace('approvals.approve', {
      inputs: { approvalId: id, comments: body.comments ?? null },
      context: {
        tenantId,
        userId,
        requestId: correlationIdOf(c),
      },
    });
    trace.addBranch({
      id: 'approve',
      label: 'Approve the request',
      rationale: 'four-eye approver explicitly chose approve',
    });
    trace.addBranch({
      id: 'reject',
      label: 'Reject the request',
      rationale: 'counterfactual — not chosen on this path',
    });
    trace.choose('approve', 'approver clicked approve');
    try {
      const result = await service.approveRequest(
        id,
        userId,
        body.comments ?? null,
        tenantId,
        correlationIdOf(c),
      );
      if (!result.success) {
        const status =
          result.error.code === 'REQUEST_NOT_FOUND'
            ? 404
            : result.error.code === 'UNAUTHORIZED_APPROVER'
              ? 403
              : 409;
        trace.finalize({
          outcome: 'rejected',
          output: { code: result.error.code, status },
        });
        return errorResponse(c, status, result.error.code, result.error.message);
      }
      trace.finalize({ outcome: 'approved', output: result.data });
      return c.json({ success: true, data: result.data });
    } catch (err) {
      if (!trace.isFinalised()) {
        trace.finalize({
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return routeCatch(c, err, {
        code: 'APPROVAL_APPROVE_FAILED',
        status: 500,
        fallback: 'Failed to approve request',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /:id/reject
// ---------------------------------------------------------------------------
app.post(
  '/:id/reject',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.OWNER,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', RejectSchema),
  withSecurityEvents({ action: 'approval.create', resource: 'approval', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const id = asApprovalRequestId(c.req.param('id'));
    const body = c.req.valid('json');
    // F10 DecisionTrace — same bracket as the approve handler but
    // `choose('reject')`. Reason text is the rule-that-fired.
    const trace = startDecisionTrace('approvals.reject', {
      inputs: { approvalId: id, reason: body.reason },
      context: {
        tenantId,
        userId,
        requestId: correlationIdOf(c),
      },
    });
    trace.addBranch({
      id: 'approve',
      label: 'Approve the request',
      rationale: 'counterfactual — not chosen on this path',
    });
    trace.addBranch({
      id: 'reject',
      label: 'Reject the request',
      rationale: body.reason,
    });
    trace.choose('reject', body.reason);
    try {
      const result = await service.rejectRequest(
        id,
        userId,
        body.reason,
        tenantId,
        correlationIdOf(c),
      );
      if (!result.success) {
        const status =
          result.error.code === 'REQUEST_NOT_FOUND'
            ? 404
            : result.error.code === 'UNAUTHORIZED_APPROVER'
              ? 403
              : 409;
        trace.finalize({
          outcome: 'failed',
          output: { code: result.error.code, status },
        });
        return errorResponse(c, status, result.error.code, result.error.message);
      }
      trace.finalize({ outcome: 'rejected', output: result.data });
      return c.json({ success: true, data: result.data });
    } catch (err) {
      if (!trace.isFinalised()) {
        trace.finalize({
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return routeCatch(c, err, {
        code: 'APPROVAL_REJECT_FAILED',
        status: 500,
        fallback: 'Failed to reject request',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /:id/escalate
// ---------------------------------------------------------------------------
app.post(
  '/:id/escalate',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', EscalateSchema),
  withSecurityEvents({ action: 'approval.create', resource: 'approval', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const id = asApprovalRequestId(c.req.param('id'));
    const body = c.req.valid('json');
    try {
      const result = await service.escalateRequest(
        id,
        body.toUserId,
        body.reason,
        tenantId,
        correlationIdOf(c),
        userId,
      );
      if (!result.success) {
        const status =
          result.error.code === 'REQUEST_NOT_FOUND'
            ? 404
            : result.error.code === 'UNAUTHORIZED_APPROVER'
              ? 403
              : 409;
        return errorResponse(c, status, result.error.code, result.error.message);
      }
      return c.json({ success: true, data: result.data });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'APPROVAL_ESCALATE_FAILED',
        status: 500,
        fallback: 'Failed to escalate request',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /policies/:type — fetch effective policy
// ---------------------------------------------------------------------------
app.get('/policies/:type', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const type = c.req.param('type');
  try {
    const result = await service.getApprovalPolicy(tenantId, type as any);
    if (!result.success) {
      return e400(c, result.error.code, result.error.message);
    }
    return c.json({ success: true, data: result.data });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'APPROVAL_POLICY_READ_FAILED',
      status: 500,
      fallback: 'Failed to read approval policy',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /policies/:type — upsert override (admin)
// ---------------------------------------------------------------------------
app.put(
  '/policies/:type',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', PolicySchema),
  withSecurityEvents({ action: 'approval.update', resource: 'approval', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const type = c.req.param('type');
    const body = c.req.valid('json');
    try {
      const result = await service.setApprovalPolicy(
        tenantId,
        type as any,
        body,
        userId,
      );
      if (!result.success) {
        return e400(c, result.error.code, result.error.message);
      }
      return c.json({ success: true, data: result.data });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'APPROVAL_POLICY_WRITE_FAILED',
        status: 500,
        fallback: 'Failed to update approval policy',
      });
    }
  }),
);

export default app;
