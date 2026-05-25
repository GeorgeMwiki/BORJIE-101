/**
 * Power-tool registry shape + tier-gating tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  createPowerToolRegistry,
  createInMemoryPowerToolAuditSink,
  type PowerToolRegistry,
  type InMemoryPowerToolAuditSink,
} from '../registry.js';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
} from '../types.js';

function makeTool(
  overrides: Partial<PowerTool<{ value: number }, { doubled: number }>> = {},
): PowerTool<{ value: number }, { doubled: number }> {
  return {
    id: 'noop',
    name: 'No-op',
    description: 'Doubles the input.',
    requiredTier: 'tenant-resident',
    requiresApproval: false,
    auditDestination: 'audit-events',
    schema: z.object({ value: z.number() }),
    async execute(
      _ctx: PowerToolContext,
      args: { value: number },
    ): Promise<PowerToolResult<{ doubled: number }>> {
      return { kind: 'ok', output: { doubled: args.value * 2 } };
    },
    ...overrides,
  };
}

function makeCtx(
  overrides: Partial<PowerToolContext> = {},
): PowerToolContext {
  const fixedDate = new Date('2026-01-01T00:00:00Z');
  return {
    callerId: 'u_test',
    tier: 'tenant-resident',
    tenantId: 't_1',
    threadId: 'thread_1',
    approvalRecordId: null,
    auditSink: null,
    clock: () => fixedDate,
    ...overrides,
  };
}

describe('createPowerToolRegistry', () => {
  let registry: PowerToolRegistry;
  let sink: InMemoryPowerToolAuditSink;

  beforeEach(() => {
    registry = createPowerToolRegistry();
    sink = createInMemoryPowerToolAuditSink();
  });

  it('registers a tool and lists it back', () => {
    registry.register(makeTool());
    const all = registry.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('noop');
  });

  it('refuses duplicate ids', () => {
    registry.register(makeTool());
    expect(() => registry.register(makeTool())).toThrow(/already registered/);
  });

  it('refuses empty id', () => {
    expect(() =>
      registry.register(makeTool({ id: '   ' as unknown as string })),
    ).toThrow(/id is required/);
  });

  it('invoke fails fast on unknown id', async () => {
    const result = await registry.invoke('missing', {}, makeCtx());
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toContain('Unknown');
    }
  });

  it('refuses when caller tier is below requiredTier', async () => {
    registry.register(makeTool({ requiredTier: 'org-admin' }));
    const result = await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({ tier: 'tenant-resident' }),
    );
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('TIER_TOO_LOW');
    }
  });

  it('allows caller tier above requiredTier', async () => {
    registry.register(makeTool({ requiredTier: 'owner-advisor' }));
    const result = await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({ tier: 'platform-sovereign' }),
    );
    expect(result.kind).toBe('ok');
  });

  it('refuses when requiresApproval=true and approvalRecordId is null', async () => {
    registry.register(makeTool({ requiresApproval: true }));
    const result = await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({ tier: 'platform-sovereign' }),
    );
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') {
      expect(result.reasonCode).toBe('APPROVAL_MISSING');
    }
  });

  it('allows when requiresApproval=true and approval id is threaded', async () => {
    registry.register(makeTool({ requiresApproval: true }));
    const result = await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({
        tier: 'platform-sovereign',
        approvalRecordId: 'appr_1',
      }),
    );
    expect(result.kind).toBe('ok');
  });

  it('validates args via Zod and fails on schema mismatch', async () => {
    registry.register(makeTool());
    const result = await registry.invoke(
      'noop',
      { value: 'not a number' },
      makeCtx(),
    );
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toContain('value');
    }
  });

  it('emits an audit row on success', async () => {
    registry.register(makeTool());
    await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({ auditSink: sink }),
    );
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0].outcome).toBe('ok');
    expect(sink.rows[0].toolId).toBe('noop');
    expect(sink.rows[0].destination).toBe('audit-events');
  });

  it('emits an audit row on tier refusal', async () => {
    registry.register(makeTool({ requiredTier: 'org-admin' }));
    await registry.invoke(
      'noop',
      { value: 5 },
      makeCtx({ auditSink: sink }),
    );
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0].outcome).toBe('refused');
  });

  it('listForTier respects the tier ladder', () => {
    registry.register(makeTool({ id: 'low', requiredTier: 'tenant-resident' }));
    registry.register(makeTool({ id: 'med', requiredTier: 'org-admin' }));
    registry.register(
      makeTool({ id: 'high', requiredTier: 'platform-sovereign' }),
    );
    const visibleToManager = registry
      .listForTier('estate-manager')
      .map((t) => t.id);
    expect(visibleToManager).toContain('low');
    expect(visibleToManager).not.toContain('med');
    expect(visibleToManager).not.toContain('high');
  });

  it('clear() resets the registry', () => {
    registry.register(makeTool());
    expect(registry.list()).toHaveLength(1);
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('does not crash when execute throws — wraps in failed outcome', async () => {
    registry.register(
      makeTool({
        async execute(): Promise<PowerToolResult<{ doubled: number }>> {
          throw new Error('boom');
        },
      }),
    );
    const result = await registry.invoke('noop', { value: 5 }, makeCtx());
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.message).toBe('boom');
    }
  });
});
