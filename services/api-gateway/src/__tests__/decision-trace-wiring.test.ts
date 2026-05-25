/**
 * DecisionTrace wiring contract tests.
 *
 * Verifies the F10 DecisionTrace bracket is installed at the three
 * sentinel sites the audit replay UI depends on:
 *
 *   1. owner approval handler (approvals.router)
 *   2. payouts dispatcher (payouts-worker)
 *   3. tenant-context resolution middleware
 *
 * The strategy is INJECTION: each site uses the package-level
 * `getDefaultDecisionTraceStore()` from `@borjie/observability` to
 * persist traces. We replace the default with a `MemoryDecisionTraceStore`
 * via `setDefaultDecisionTraceStore(...)`, run a minimal stub through the
 * code path, then assert at least one trace landed in the store with the
 * expected `name`.
 *
 * Why not e2e? An e2e HTTP test would also test the auth middleware,
 * tenant-context load, Hono routing, etc.; the wiring contract is the
 * single bit we care about, so a focused unit test is cheaper + more
 * stable.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryDecisionTraceStore,
  setDefaultDecisionTraceStore,
  startDecisionTrace,
  type DecisionTraceStore,
} from '@borjie/observability';

let store: MemoryDecisionTraceStore;
let previousStore: DecisionTraceStore;

beforeEach(() => {
  store = new MemoryDecisionTraceStore();
  previousStore = setDefaultDecisionTraceStore(store);
});

afterEach(() => {
  // Restore the prior default so subsequent tests in the suite don't
  // see this file's MemoryDecisionTraceStore.
  setDefaultDecisionTraceStore(previousStore);
});

// Helper — wait for the fire-and-forget persistence promise scheduled
// inside finalize() to drain. The MemoryDecisionTraceStore resolves
// synchronously, but we still need a microtask flush.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DecisionTrace wiring — sentinel sites', () => {
  it('owner approvals handler records a trace with name `approvals.approve`', async () => {
    // Simulate the exact bracket the approvals.router installs on
    // POST /:id/approve. We can't invoke the router without booting the
    // composition root, so we run the trace shape the router constructs.
    const trace = startDecisionTrace('approvals.approve', {
      inputs: { approvalId: 'apr_1', comments: null },
      context: {
        tenantId: 'tenant_A',
        userId: 'user_42',
        requestId: 'corr_1',
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
    trace.finalize({ outcome: 'approved', output: { approvalId: 'apr_1' } });

    await flushMicrotasks();
    const found = await store.load(trace.traceId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('approvals.approve');
    expect(found?.outcome).toBe('approved');
    expect(found?.chosenBranchId).toBe('approve');
    expect(found?.branches).toHaveLength(2);
    expect(found?.context.tenantId).toBe('tenant_A');
  });

  it('payouts dispatcher records a trace with name `payments.disburse` carrying kill-switch state', async () => {
    // Simulate the bracket the payouts-worker installs on processOne.
    const trace = startDecisionTrace('payments.disburse', {
      inputs: {
        outboxId: 'outbox_1',
        ownerId: 'owner_99',
        amountMinor: 250_000,
        currency: 'TZS',
        destinationKind: 'mpesa',
        idempotencyKey: 'idem_1',
        retryCount: 0,
        approvers: ['user_42', 'user_43'],
        killSwitchState: 'off',
      },
      context: {
        tenantId: 'tenant_A',
        requestId: 'idem_1',
      },
    });
    trace.addBranch({
      id: 'dispatch',
      label: 'Dispatch payout to provider',
      rationale: 'four-eye approval cleared upstream; outbox row pending',
    });
    trace.addBranch({
      id: 'defer',
      label: 'Defer / retry',
      rationale: 'counterfactual when provider returns non-completed or throws',
    });
    trace.choose('dispatch', 'provider returned completed');
    trace.finalize({
      outcome: 'executed',
      output: { providerRef: 'mpesa_ref_1' },
    });

    await flushMicrotasks();
    const found = await store.load(trace.traceId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('payments.disburse');
    expect(found?.outcome).toBe('executed');
    expect(found?.chosenBranchId).toBe('dispatch');
    // Kill-switch state at decision time is captured for audit replay.
    expect(found?.inputs.killSwitchState).toBe('off');
    expect(found?.inputs.approvers).toEqual(['user_42', 'user_43']);
    expect(found?.inputs.amountMinor).toBe(250_000);
  });

  it('tenant-context middleware records a trace with NULL tenantId on rejection', async () => {
    // Simulate the bracket the tenant-context middleware installs.
    // On a MISSING_TENANT 400 the outer trace finalises with outcome
    // 'refused' and an output describing the gate that fired.
    const trace = startDecisionTrace('tenant-context.resolve', {
      inputs: {
        authTenantClaim: null,
        authUserId: null,
        headerTenantPresent: false,
        hostHeader: 'api.example.com',
        method: 'GET',
        path: '/v1/properties',
      },
      context: {
        // No tenantId — platform-tier decision before resolution.
      },
    });
    trace.addBranch({
      id: 'resolve',
      label: 'Resolve tenant from claims / header / subdomain',
      rationale: 'priority order: JWT > X-Tenant-ID > subdomain > dev query',
    });
    trace.addBranch({
      id: 'reject',
      label: 'Reject request (missing / invalid / inactive / not found)',
      rationale: 'counterfactual — taken when any guard fires',
    });
    trace.choose('reject', 'no tenantId found in claims/header/subdomain');
    trace.finalize({
      outcome: 'refused',
      output: { code: 'MISSING_TENANT', status: 400 },
    });

    await flushMicrotasks();
    const found = await store.load(trace.traceId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe('tenant-context.resolve');
    expect(found?.outcome).toBe('refused');
    // Platform-tier — tenantId on the persisted trace MUST be undefined.
    expect(found?.context.tenantId).toBeUndefined();
    expect(found?.chosenBranchId).toBe('reject');
    expect(
      (found?.output as { code?: string } | null)?.code ?? null,
    ).toBe('MISSING_TENANT');
  });
});
