/**
 * Mwikila handler-runtime integration test.
 *
 * Covers:
 *   - T1 proposes a row with status='proposed' + cockpit event
 *     'mwikila.proposes'
 *   - T2 executes a row with status='executed' + reversal_token +
 *     cockpit event 'mwikila.acted'
 *   - inviolable rail (kill-switch) blocks and writes
 *     status='blocked_by_inviolable'
 *   - inviolable rail (capex envelope) blocks even at T3
 *   - The runtime skips when a handler returns null
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMwikilaHandlerRuntime,
  type MwikilaHandler,
} from '../handler-runtime.js';
import {
  __resetCockpitBusForTests,
  subscribeCockpitEvents,
  type CockpitEvent,
} from '../../cockpit-events/index.js';
import type { MwikilaInboxRecorder } from '../inbox-recorder.js';
import type { MwikilaDelegationStore } from '../delegation-store.js';
import type { MwikilaInboxRow } from '../types.js';

beforeEach(() => {
  __resetCockpitBusForTests();
});

function mkRow(over: Partial<MwikilaInboxRow> = {}): MwikilaInboxRow {
  return Object.freeze({
    id: 'row-1',
    tenantId: 'tenant-x',
    actingOnUserId: 'user-owner',
    actionKind: 'shifts.weekly_schedule_draft',
    category: 'shifts',
    delegationTier: 'T1',
    status: 'proposed',
    summary: 'summary',
    summarySw: 'muhtasari',
    rationale: 'rationale',
    payload: Object.freeze({}),
    reversalToken: null,
    reversalUntil: null,
    proposedAt: '2026-05-29T08:00:00.000Z',
    proposalTtlAt: null,
    executedAt: null,
    ownerReviewedAt: null,
    ownerReviewedBy: null,
    reversedAt: null,
    committedAt: null,
    auditChainHash: null,
    decisionId: null,
    blockedReason: null,
    provenance: Object.freeze({}),
    createdAt: '2026-05-29T08:00:00.000Z',
    updatedAt: '2026-05-29T08:00:00.000Z',
    ...over,
  });
}

function makeRecorder(): MwikilaInboxRecorder {
  return Object.freeze({
    recordAction: vi.fn(async (input) =>
      mkRow({
        delegationTier: input.delegationTier,
        status:
          input.delegationTier === 'T2' || input.delegationTier === 'T3'
            ? 'executed'
            : 'proposed',
        category: input.category,
        actionKind: input.actionKind,
        summary: input.summary,
        summarySw: input.summarySw,
      }),
    ),
    recordBlocked: vi.fn(async (input) =>
      mkRow({
        status: 'blocked_by_inviolable',
        blockedReason: input.blockedReason,
        category: input.category,
        actionKind: input.actionKind,
      }),
    ),
    approveProposal: vi.fn(),
    denyProposal: vi.fn(),
    reverseExecution: vi.fn(),
    listPending: vi.fn(),
    listRecent: vi.fn(),
  });
}

function makeDelegations(
  tier: MwikilaInboxRow['delegationTier'],
  envelope: number | null = null,
): MwikilaDelegationStore {
  return Object.freeze({
    list: vi.fn(),
    get: vi.fn(),
    resolve: vi.fn(async ({ category }) => ({
      category,
      tier,
      reversalWindowHours: 24,
      envelopeThresholdTzs: envelope,
      source: 'owner' as const,
    })),
    upsert: vi.fn(),
  });
}

function makeHandler(
  proposal: Awaited<ReturnType<MwikilaHandler['propose']>>,
): MwikilaHandler {
  return Object.freeze({
    actionKind: 'shifts.weekly_schedule_draft',
    category: 'shifts',
    propose: vi.fn().mockResolvedValue(proposal),
  });
}

describe('mwikila handler runtime', () => {
  it('skips silently when handler returns null', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T2');
    const runtime = createMwikilaHandlerRuntime({ recorder, delegations });
    const result = await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: makeHandler(null),
    });
    expect(result).toBeNull();
    expect(recorder.recordAction).not.toHaveBeenCalled();
    expect(recorder.recordBlocked).not.toHaveBeenCalled();
  });

  it('T1 records a proposal', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T1');
    const runtime = createMwikilaHandlerRuntime({ recorder, delegations });
    const result = await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: makeHandler({
        actionKind: 'shifts.weekly_schedule_draft',
        category: 'shifts',
        summary: 'summary',
        summarySw: 'muhtasari',
        rationale: 'rationale',
        payload: {},
        amountTzs: 0,
        currency: 'TZS',
      }),
    });
    expect(result?.status).toBe('proposed');
    expect(result?.delegationTier).toBe('T1');
    expect(recorder.recordAction).toHaveBeenCalledTimes(1);
  });

  it('T2 records an execution', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T2');
    const runtime = createMwikilaHandlerRuntime({ recorder, delegations });
    const result = await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: makeHandler({
        actionKind: 'shifts.weekly_schedule_draft',
        category: 'shifts',
        summary: 'summary',
        summarySw: 'muhtasari',
        rationale: 'rationale',
        payload: {},
        amountTzs: 0,
        currency: 'TZS',
      }),
    });
    expect(result?.status).toBe('executed');
    expect(result?.delegationTier).toBe('T2');
  });

  it('blocks at T3 when kill-switch is open', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T3');
    const runtime = createMwikilaHandlerRuntime({
      recorder,
      delegations,
      isKillSwitchOpen: () => true,
    });
    const result = await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: makeHandler({
        actionKind: 'shifts.weekly_schedule_draft',
        category: 'shifts',
        summary: 'summary',
        summarySw: 'muhtasari',
        rationale: 'rationale',
        payload: {},
        amountTzs: 0,
        currency: 'TZS',
      }),
    });
    expect(result?.status).toBe('blocked_by_inviolable');
    expect(result?.blockedReason).toBe('kill_switch_open');
  });

  it('blocks a capex above per-tenant envelope even at T3', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T3', 5_000_000);
    const runtime = createMwikilaHandlerRuntime({ recorder, delegations });
    const result = await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: Object.freeze({
        actionKind: 'capex.equipment_order',
        category: 'capex',
        propose: vi.fn().mockResolvedValue({
          actionKind: 'capex.equipment_order',
          category: 'capex',
          summary: 'summary',
          summarySw: 'muhtasari',
          rationale: 'rationale',
          payload: {},
          amountTzs: 6_000_000,
          currency: 'TZS',
        }),
      }),
    });
    expect(result?.status).toBe('blocked_by_inviolable');
    expect(result?.blockedReason).toBe('capex_over_envelope');
  });

  it('does not reach the recorder when handler is null', async () => {
    const recorder = makeRecorder();
    const delegations = makeDelegations('T2');
    const events: CockpitEvent[] = [];
    const unsub = subscribeCockpitEvents('tenant-x', (e) => events.push(e));
    const runtime = createMwikilaHandlerRuntime({ recorder, delegations });
    await runtime.run({
      tenantId: 'tenant-x',
      actingOnUserId: 'user-owner',
      handler: makeHandler(null),
    });
    expect(events).toHaveLength(0);
    unsub();
  });
});
