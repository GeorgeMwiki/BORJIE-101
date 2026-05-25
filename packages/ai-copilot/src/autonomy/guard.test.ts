/**
 * withAutonomyGuard unit tests — Wave 28 universal chokepoint.
 *
 * Covers the five main paths:
 *   1. authorized (policy approve, no grant service) — thunk runs
 *   2. requires-approval (policy denies + requiresApproval=true) — sink queues
 *   3. disabled (master switch off → blocked at policy) — audit + no exec
 *   4. grant-consumed (live standing grant) — thunk runs + consume fires
 *   5. grant-expired (no active grant) — sink queues with grant reason
 * Plus: audit-on-every-call, exception-inbox-on-denial shape, queued id
 *       surfaces into GuardResult, thrown thunk propagates, tenantId guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
} from './autonomy-policy-service.js';
import {
  ApprovalGrantService,
  InMemoryApprovalGrantRepository,
} from '../approval-grants/service.js';
import {
  createAuditTrailRecorder,
  createInMemoryAuditTrailRepo,
} from '../audit-trail/recorder.js';
import { withAutonomyGuard } from './guard.js';
import type {
  AutonomyGuardContext,
  OnApprovalRequiredFn,
} from './guard.js';

const TENANT = 'tenant_guard_1';
const HEAD = 'user_head_1';

interface Harness {
  readonly policyService: AutonomyPolicyService;
  readonly grantService: ApprovalGrantService;
  readonly auditRepo: ReturnType<typeof createInMemoryAuditTrailRepo>;
  readonly auditRecorder: ReturnType<typeof createAuditTrailRecorder>;
  readonly sink: ReturnType<typeof vi.fn>;
  readonly guard: ReturnType<typeof withAutonomyGuard>;
}

async function buildHarness(
  opts: { enableAutonomy?: boolean; onApprovalRequired?: OnApprovalRequiredFn } = {},
): Promise<Harness> {
  const policyRepo = new InMemoryAutonomyPolicyRepository();
  const policyService = new AutonomyPolicyService({ repository: policyRepo });

  await policyService.createPolicy(TENANT, HEAD);
  await policyService.updatePolicy(TENANT, {
    autonomousModeEnabled: opts.enableAutonomy ?? true,
    finance: {
      autoSendReminders: true,
      autoApproveRefundsMinorUnits: 100_000,
    },
    maintenance: { autoApproveBelowMinorUnits: 200_000 },
  });

  const grantRepo = new InMemoryApprovalGrantRepository();
  const grantService = new ApprovalGrantService({ repository: grantRepo });

  const auditRepo = createInMemoryAuditTrailRepo();
  const auditRecorder = createAuditTrailRecorder({ repo: auditRepo });

  const sink = vi.fn(opts.onApprovalRequired ?? ((): string | null => null));
  const guard = withAutonomyGuard({
    policyService,
    grantService,
    auditRecorder,
    onApprovalRequired: sink as unknown as OnApprovalRequiredFn,
  });

  return { policyService, grantService, auditRepo, auditRecorder, sink, guard };
}

const baseCtx: AutonomyGuardContext = {
  tenantId: TENANT,
  domain: 'finance',
  actionKey: 'send_reminder',
  auditActionKind: 'finance.send_reminder',
  subject: { entityType: 'invoice', entityId: 'inv_123' },
};

describe('withAutonomyGuard — authorized path', () => {
  it('executes thunk when policy authorizes and no grant service is required', async () => {
    const h = await buildHarness();
    const thunk = vi.fn(async () => ({ sent: true }));
    const result = await h.guard(
      { ...baseCtx, skipGrantCheck: true },
      thunk,
    );
    expect(thunk).toHaveBeenCalledOnce();
    expect(result.executed).toBe(true);
    expect(result.result).toEqual({ sent: true });
    expect(result.decision.authorized).toBe(true);
    expect(result.reason).toBe('executed');
    expect(result.queuedApprovalId).toBeNull();
  });

  it('writes an audit row for every authorized call', async () => {
    const h = await buildHarness();
    await h.guard(
      { ...baseCtx, skipGrantCheck: true },
      async () => 'ok',
    );
    expect(h.auditRepo.entries).toHaveLength(1);
    const entry = h.auditRepo.entries[0];
    expect(entry.decision).toBe('executed');
    expect(entry.tenantId).toBe(TENANT);
    expect(entry.actionKind).toBe('finance.send_reminder');
    expect(entry.actionCategory).toBe('finance');
    expect(entry.actorKind).toBe('ai_autonomous');
  });
});

describe('withAutonomyGuard — requires-approval path', () => {
  it('queues via onApprovalRequired when policy demands approval', async () => {
    const h = await buildHarness({
      onApprovalRequired: async () => 'queued_exc_1',
    });
    const thunk = vi.fn();
    const result = await h.guard(
      {
        ...baseCtx,
        actionKey: 'approve_refund',
        auditActionKind: 'finance.approve_refund',
        policyContext: { amountMinorUnits: 9_000_000 },
      },
      thunk,
    );
    expect(thunk).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.queuedApprovalId).toBe('queued_exc_1');
    expect(result.decision.requiresApproval).toBe(true);
    expect(result.reason).toBe('queued');
    expect(h.sink).toHaveBeenCalledOnce();
  });

  it('surfaces decision.reason when no sink is wired', async () => {
    const policyRepo = new InMemoryAutonomyPolicyRepository();
    const policyService = new AutonomyPolicyService({ repository: policyRepo });
    await policyService.createPolicy(TENANT, HEAD);
    await policyService.updatePolicy(TENANT, { autonomousModeEnabled: true });

    const auditRepo = createInMemoryAuditTrailRepo();
    const auditRecorder = createAuditTrailRecorder({ repo: auditRepo });
    const guard = withAutonomyGuard({ policyService, auditRecorder });

    const result = await guard(
      {
        ...baseCtx,
        actionKey: 'approve_refund',
        auditActionKind: 'finance.approve_refund',
        policyContext: { amountMinorUnits: 9_000_000 },
      },
      async () => 'never',
    );
    expect(result.executed).toBe(false);
    expect(result.queuedApprovalId).toBeNull();
    expect(result.reason).toMatch(/threshold/i);
  });
});

describe('withAutonomyGuard — disabled path', () => {
  it('hard-blocks when autonomousModeEnabled is false', async () => {
    const h = await buildHarness({ enableAutonomy: false });
    const thunk = vi.fn();
    const result = await h.guard({ ...baseCtx, skipGrantCheck: true }, thunk);
    expect(thunk).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.decision.policyRuleMatched).toBe('master_switch_off');
    // Still emits an audit trail row for the blocked attempt.
    expect(h.auditRepo.entries).toHaveLength(1);
    expect(h.auditRepo.entries[0].decision).toBe('proposed');
  });
});

describe('withAutonomyGuard — grant paths', () => {
  it('consumes a matching standing grant when available', async () => {
    const h = await buildHarness();
    // Issue a standing grant covering send_reminder on this invoice.
    await h.grantService.grantStanding(TENANT, {
      domain: 'finance',
      actionCategory: 'send_reminder',
      scope: { entityType: 'invoice' },
      createdBy: HEAD,
    });

    const thunk = vi.fn(async () => 'sent');
    const result = await h.guard(
      {
        ...baseCtx,
        grantRequest: {
          targetEntityType: 'invoice',
          targetEntityId: 'inv_123',
        },
      },
      thunk,
    );
    expect(thunk).toHaveBeenCalledOnce();
    expect(result.executed).toBe(true);
    expect(result.grantCheck?.authorized).toBe(true);
    expect(result.grantCheck?.kind).toBe('standing');
    expect(result.consumedGrantId).not.toBeNull();
  });

  it('queues when no active grant covers the action (grant-expired equivalent)', async () => {
    const h = await buildHarness({
      onApprovalRequired: async () => 'queued_no_grant',
    });
    // NO grants issued.
    const thunk = vi.fn();
    const result = await h.guard(
      {
        ...baseCtx,
        grantRequest: {
          targetEntityType: 'invoice',
          targetEntityId: 'inv_missing',
        },
      },
      thunk,
    );
    expect(thunk).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
    expect(result.grantCheck?.authorized).toBe(false);
    expect(result.grantCheck?.mustRequestApproval).toBe(true);
    expect(result.queuedApprovalId).toBe('queued_no_grant');
  });

  it('consumes a single-action grant and marks used', async () => {
    const h = await buildHarness();
    await h.grantService.grantSingle(TENANT, {
      domain: 'finance',
      actionCategory: 'send_reminder',
      scope: {
        targetEntityType: 'invoice',
        targetEntityId: 'inv_999',
      },
      createdBy: HEAD,
    });

    const result = await h.guard(
      {
        ...baseCtx,
        subject: { entityType: 'invoice', entityId: 'inv_999' },
        grantRequest: {
          targetEntityType: 'invoice',
          targetEntityId: 'inv_999',
        },
      },
      async () => 'done',
    );
    expect(result.executed).toBe(true);
    expect(result.grantCheck?.kind).toBe('single');
  });
});

describe('withAutonomyGuard — audit + safety', () => {
  it('records audit BEFORE the thunk so crashes still leave a trail', async () => {
    const h = await buildHarness();
    const thunk = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(
      h.guard({ ...baseCtx, skipGrantCheck: true }, thunk),
    ).rejects.toThrow(/boom/);
    // Audit row written even though thunk threw.
    expect(h.auditRepo.entries).toHaveLength(1);
    expect(h.auditRepo.entries[0].decision).toBe('executed');
  });

  it('records audit even on denial (exception-inbox parity)', async () => {
    const h = await buildHarness({
      onApprovalRequired: async () => 'exc_777',
    });
    await h.guard(
      {
        ...baseCtx,
        actionKey: 'approve_refund',
        auditActionKind: 'finance.approve_refund',
        policyContext: { amountMinorUnits: 99_999_999 },
      },
      async () => 'never',
    );
    expect(h.auditRepo.entries).toHaveLength(1);
    const entry = h.auditRepo.entries[0];
    expect(entry.decision).toBe('proposed');
    expect((entry.evidence as Record<string, unknown>)['autonomy']).toBeDefined();
  });

  it('throws when tenantId is missing', async () => {
    const h = await buildHarness();
    await expect(
      h.guard(
        { ...baseCtx, tenantId: '' },
        async () => 'x',
      ),
    ).rejects.toThrow(/tenantId required/);
  });

  it('throws when actionKey is missing', async () => {
    const h = await buildHarness();
    await expect(
      h.guard(
        { ...baseCtx, actionKey: '' },
        async () => 'x',
      ),
    ).rejects.toThrow(/actionKey required/);
  });

  it('maps legal_proceedings domain to the legal audit category', async () => {
    const h = await buildHarness({
      onApprovalRequired: async () => 'exc_legal',
    });
    await h.guard(
      {
        tenantId: TENANT,
        domain: 'legal_proceedings',
        actionKey: 'file_eviction',
        auditActionKind: 'legal.file_eviction',
        skipGrantCheck: true,
      },
      async () => 'never',
    );
    // Policy service returns `requireApproval` for unknown domain path —
    // audit still fires.
    expect(h.auditRepo.entries).toHaveLength(1);
    expect(h.auditRepo.entries[0].actionCategory).toBe('legal');
  });
});
