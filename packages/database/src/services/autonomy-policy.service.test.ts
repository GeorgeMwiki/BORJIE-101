/**
 * Unit tests for createPgAutonomyPolicyService.
 *
 * Mocks the Drizzle DatabaseClient with a small chain that returns a
 * pre-staged row OR throws. We assert:
 *   1. Lookup hit with action rule → returns rule verbatim.
 *   2. Lookup hit with stakes rule → returns rule verbatim.
 *   3. Lookup miss → falls back to default-allow-low-stakes.
 *   4. Autonomous-mode disabled → falls back.
 *   5. Malformed policy_json → falls back.
 *   6. Query throws → falls back (DB error path).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPgAutonomyPolicyService,
  type AutonomyPolicyDecision,
} from './autonomy-policy.service.js';
import type { DatabaseClient } from '../client.js';

interface StubRow {
  autonomousModeEnabled: boolean;
  policyJson: unknown;
}

interface StubDb {
  client: DatabaseClient;
  pendingRows: StubRow[] | null;
  pendingError: Error | null;
  whereCalls: number;
}

function makeStubDb(): StubDb {
  const state: StubDb = {
    client: null as unknown as DatabaseClient,
    pendingRows: [],
    pendingError: null,
    whereCalls: 0,
  };

  const makeChain = (): unknown => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (_predicate: unknown) => {
        state.whereCalls += 1;
        return chain;
      },
      limit: (_n: number) => chain,
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        if (state.pendingError) {
          if (reject) return reject(state.pendingError);
          throw state.pendingError;
        }
        return resolve(state.pendingRows ?? []);
      },
      catch: (
        onReject: (reason: unknown) => unknown,
      ) => {
        if (state.pendingError) return Promise.resolve(onReject(state.pendingError));
        return chain;
      },
      finally: () => chain,
    };
    return chain;
  };

  state.client = {
    select: () => makeChain(),
  } as unknown as DatabaseClient;
  return state;
}

describe('createPgAutonomyPolicyService', () => {
  let stub: StubDb;
  let errorSpy = vi.spyOn(console, 'error');

  beforeEach(() => {
    stub = makeStubDb();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('lookup hit with action rule returns the rule verbatim', async () => {
    stub.pendingRows = [
      {
        autonomousModeEnabled: true,
        policyJson: {
          actions: {
            'rent.send-reminder': {
              authorized: true,
              requiresApproval: false,
            },
          },
        },
      },
    ];
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision: AutonomyPolicyDecision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'medium',
    });

    expect(decision.authorized).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toContain('policy-action-rule');
  });

  it('lookup hit with stakes rule returns the rule verbatim', async () => {
    stub.pendingRows = [
      {
        autonomousModeEnabled: true,
        policyJson: {
          stakes: {
            high: { authorized: false, requiresApproval: true },
          },
        },
      },
    ];
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'arrears.escalate',
      stakes: 'high',
    });

    expect(decision.authorized).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain('policy-stakes-rule');
  });

  it('lookup miss falls back to default-allow-low-stakes', async () => {
    stub.pendingRows = [];
    const svc = createPgAutonomyPolicyService(stub.client);

    const lowDecision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'low',
    });
    expect(lowDecision.authorized).toBe(true);
    expect(lowDecision.requiresApproval).toBe(false);
    expect(lowDecision.reason).toContain('no-row');

    const highDecision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'arrears.escalate',
      stakes: 'high',
    });
    expect(highDecision.authorized).toBe(true);
    expect(highDecision.requiresApproval).toBe(true);
    expect(highDecision.reason).toContain('no-row');
  });

  it('autonomous-mode disabled falls back to default-allow-low-stakes', async () => {
    stub.pendingRows = [
      {
        autonomousModeEnabled: false,
        policyJson: {
          actions: {
            'rent.send-reminder': {
              authorized: true,
              requiresApproval: false,
            },
          },
        },
      },
    ];
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'low',
    });

    expect(decision.authorized).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toContain('autonomous-mode-disabled');
  });

  it('malformed policy_json (no rule match) falls back', async () => {
    stub.pendingRows = [
      {
        autonomousModeEnabled: true,
        policyJson: { weird: 'shape', actions: 'not-an-object' },
      },
    ];
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'medium',
    });

    expect(decision.authorized).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain('no-action-or-stakes-rule');
  });

  it('query error falls back to default-allow-low-stakes', async () => {
    stub.pendingError = new Error('boom');
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision = await svc.decide({
      tenantId: 't1',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'low',
    });

    expect(decision.authorized).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toContain('db-error');
  });

  it('returns default-allow when tenantId is empty (defensive guard)', async () => {
    const svc = createPgAutonomyPolicyService(stub.client);

    const decision = await svc.decide({
      tenantId: '',
      userId: 'u1',
      toolName: 'rent.send-reminder',
      stakes: 'low',
    });

    expect(decision.authorized).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toContain('no-tenant');
  });
});
