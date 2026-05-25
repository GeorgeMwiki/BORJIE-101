/**
 * temporal-dispatcher-wiring tests — verify the env-gating, real-client
 * fallback to mock, and the dispatcher adapter surface (start + signal).
 *
 * Tests never touch a real Temporal server; the wiring's fallback to
 * `MockTemporalClient` is exactly the behaviour we exercise.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMockTemporalClient,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from '../durable/temporal/temporal-client.js';
import {
  createTemporalDispatcherFromEnv,
  isTemporalEnabled,
} from '../temporal-dispatcher-wiring.js';

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.TEMPORAL_ADDRESS;
  delete process.env.TEMPORAL_NAMESPACE;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('temporal-dispatcher-wiring — env gating', () => {
  it('isTemporalEnabled is false when TEMPORAL_ADDRESS is unset', () => {
    expect(isTemporalEnabled()).toBe(false);
  });

  it('isTemporalEnabled is true when TEMPORAL_ADDRESS is set', () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.example.com:7233';
    expect(isTemporalEnabled()).toBe(true);
  });

  it('isTemporalEnabled honours forceMock override', () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.example.com:7233';
    expect(isTemporalEnabled({ forceMock: true })).toBe(false);
  });

  it('isTemporalEnabled honours explicit address override', () => {
    expect(isTemporalEnabled({ address: 'temporal.local:7233' })).toBe(true);
    expect(isTemporalEnabled({ address: '' })).toBe(false);
  });
});

describe('temporal-dispatcher-wiring — factory fallback', () => {
  it('returns a mock-backed bundle when TEMPORAL_ADDRESS is unset', async () => {
    const bundle = await createTemporalDispatcherFromEnv();
    expect(bundle.isMock).toBe(true);
    expect(bundle.evictionDispatcher).toBeDefined();
    expect(bundle.ownerPayoutDispatcher).toBeDefined();
    expect(bundle.kraMriDispatcher).toBeDefined();
  });

  it('falls back to mock when real client cannot be loaded', async () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.local:7233';
    const warnings: string[] = [];
    const bundle = await createTemporalDispatcherFromEnv({
      logger: {
        warn: (_meta, msg) => warnings.push(msg),
      },
    });
    // In CI the dep is not installed, so the loader returns null and
    // the bundle is mock-backed. If the dep IS installed (developer
    // env), the connect call will likely throw on the fake address —
    // still fall back to mock.
    expect(bundle.isMock).toBe(true);
  });

  it('honours forceMock even when TEMPORAL_ADDRESS is set', async () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.local:7233';
    const bundle = await createTemporalDispatcherFromEnv({ forceMock: true });
    expect(bundle.isMock).toBe(true);
  });

  it('uses supplied clientOverride verbatim', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    expect(bundle.client).toBe(mock);
    expect(bundle.isMock).toBe(true);
  });
});

describe('temporal-dispatcher-wiring — eviction adapter', () => {
  it('start() forwards to startEvictionWorkflow with the canonical id', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    const handle = await bundle.evictionDispatcher.start({
      tenantId: 't1',
      leaseId: 'lse-1',
      breachKind: 'rent-arrears',
      initiatedByUserId: 'u1',
      evictionDate: '2026-06-01T00:00:00.000Z',
      courtRef: null,
    });
    expect(handle.workflowId).toBe('eviction-lse-1');
    expect(mock.state.starts).toHaveLength(1);
    expect(mock.state.starts[0]?.workflowType).toBe(
      TEMPORAL_WORKFLOW_TYPES.EVICTION,
    );
    expect(mock.state.starts[0]?.taskQueue).toBe(TEMPORAL_TASK_QUEUES.EVICTION);
  });

  it('withdraw() sends a withdrawEviction signal', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    await bundle.evictionDispatcher.withdraw({
      workflowId: 'eviction-lse-1',
      reason: 'operator-override',
    });
    expect(mock.state.signals).toHaveLength(1);
    expect(mock.state.signals[0]?.signalName).toBe('withdrawEviction');
    expect(mock.state.signals[0]?.workflowId).toBe('eviction-lse-1');
  });
});

describe('temporal-dispatcher-wiring — owner-payout adapter', () => {
  it('start() forwards to startOwnerPayoutWorkflow with the canonical id', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    const handle = await bundle.ownerPayoutDispatcher.start({
      tenantId: 't1',
      ownerId: 'o1',
      amount: 1_000_000,
      currency: 'TZS',
      bankAccount: 'TZ-9123',
      idempotencyKey: 'idem-1',
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-04-30T23:59:59.000Z',
      initiatedByUserId: 'u1',
    });
    expect(handle.workflowId).toContain('owner-payout-o1');
    expect(mock.state.starts[0]?.taskQueue).toBe(
      TEMPORAL_TASK_QUEUES.OWNER_PAYOUT,
    );
  });

  it('refund() sends a refundPayout signal', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    await bundle.ownerPayoutDispatcher.refund({
      workflowId: 'wf-refund-1',
      reason: 'rollback',
    });
    expect(mock.state.signals[0]?.signalName).toBe('refundPayout');
  });

  it('estimateUsdCents defaults to amount when no fxEstimator supplied', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    const usd = await bundle.ownerPayoutDispatcher.estimateUsdCents({
      amount: 12_345,
      currency: 'TZS',
    });
    expect(usd).toBe(12_345);
  });

  it('estimateUsdCents threads supplied fxEstimator', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({
      clientOverride: mock,
      fxEstimator: async ({ amount }) => Math.floor(amount / 2500),
    });
    const usd = await bundle.ownerPayoutDispatcher.estimateUsdCents({
      amount: 2_500_000_00,
      currency: 'TZS',
    });
    expect(usd).toBe(100_000); // $1000 in USD cents
  });
});

describe('temporal-dispatcher-wiring — kra-mri adapter', () => {
  it('start() forwards to startKraMriFilingWorkflow with the canonical id', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    const handle = await bundle.kraMriDispatcher.start({
      tenantId: 't1',
      taxPeriodMonth: '2026-04',
      returnPayload: {
        entityTin: '123456789',
        grossRent: 1_000_000,
        deductibleExpenses: 100_000,
        taxableIncome: 900_000,
        taxDue: 90_000,
      },
      initiatedByUserId: 'u1',
    });
    expect(handle.workflowId).toBe('kra-mri-t1-2026-04');
    expect(mock.state.starts[0]?.workflowType).toBe(
      TEMPORAL_WORKFLOW_TYPES.KRA_MRI_FILING,
    );
    expect(mock.state.starts[0]?.taskQueue).toBe(
      TEMPORAL_TASK_QUEUES.KRA_MRI_FILING,
    );
  });

  it('requestRetraction() sends a requestRetraction signal', async () => {
    const mock = createMockTemporalClient();
    const bundle = await createTemporalDispatcherFromEnv({ clientOverride: mock });
    await bundle.kraMriDispatcher.requestRetraction({
      workflowId: 'kra-mri-t1-2026-04',
      reason: 'correction-needed',
    });
    expect(mock.state.signals[0]?.signalName).toBe('requestRetraction');
    expect(mock.state.signals[0]?.workflowId).toBe('kra-mri-t1-2026-04');
  });
});
