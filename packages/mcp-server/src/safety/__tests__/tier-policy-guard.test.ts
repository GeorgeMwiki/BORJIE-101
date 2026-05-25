import { describe, it, expect } from 'vitest';
import {
  guardScheduledInvocation,
  captureInvocationContext,
  type QueuedInvocationContext,
  type CurrentCallerSnapshot,
} from '../tier-policy-guard.js';

function baseQueued(over: Partial<QueuedInvocationContext> = {}): QueuedInvocationContext {
  return {
    toolName: 'payment:list_for_lease', // minTier: growth in MCP_SAFE_POLICY
    enqueuedAt: '2026-05-20T00:00:00.000Z',
    originalCallerId: 'user-abc',
    originalPortalId: 'estate-manager',
    originalUserRole: 'estate_manager',
    originalTier: 'enterprise',
    tenantId: 'tenant-trc',
    ...over,
  };
}

function baseCurrent(over: Partial<CurrentCallerSnapshot> = {}): CurrentCallerSnapshot {
  return {
    callerId: 'user-abc',
    currentTier: 'enterprise',
    currentPortalId: 'estate-manager',
    currentUserRole: 'estate_manager',
    stillAttachedToTenant: true,
    ...over,
  };
}

describe('guardScheduledInvocation', () => {
  it('allows when nothing changed since enqueue', () => {
    const decision = guardScheduledInvocation(baseQueued(), baseCurrent());
    expect(decision.allow).toBe(true);
  });

  it('denies when caller id mismatches (rehydration bug defense)', () => {
    const decision = guardScheduledInvocation(
      baseQueued(),
      baseCurrent({ callerId: 'user-XYZ' }),
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.reason).toBe('caller-id-mismatch');
  });

  it('denies when caller detached from tenant', () => {
    const decision = guardScheduledInvocation(
      baseQueued(),
      baseCurrent({ stillAttachedToTenant: false }),
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.reason).toBe('caller-detached-from-tenant');
  });

  it('denies when tool is removed from MCP_SAFE_POLICY altogether', () => {
    const decision = guardScheduledInvocation(
      baseQueued({ toolName: 'unknown_tool_removed_from_policy' }),
      baseCurrent(),
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.reason).toBe('tool-no-longer-in-policy');
  });

  it('denies when tool was flipped to mcpSafe=false (e.g. quarantined)', () => {
    const decision = guardScheduledInvocation(
      baseQueued({ toolName: 'simulate_decision' }), // mcpSafe: false
      baseCurrent(),
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.reason).toBe('tool-removed-from-mcp-safe');
    expect(decision.detail).toContain('citation');
  });

  it('denies when caller tier downgraded below minTier (privilege laundering)', () => {
    const decision = guardScheduledInvocation(
      baseQueued({ originalTier: 'enterprise' }),
      baseCurrent({ currentTier: 'free' }), // payment:list_for_lease requires growth
    );
    expect(decision.allow).toBe(false);
    if (decision.allow) return;
    expect(decision.reason).toBe('tier-downgraded-since-enqueue');
    expect(decision.detail).toContain('growth');
  });

  it('allows when caller upgraded their tier (any-direction safety: only downgrade blocks)', () => {
    const decision = guardScheduledInvocation(
      baseQueued({ originalTier: 'growth' }),
      baseCurrent({ currentTier: 'enterprise' }),
    );
    expect(decision.allow).toBe(true);
  });

  it('allows tools without a minTier on any tier', () => {
    const decision = guardScheduledInvocation(
      baseQueued({ toolName: 'property:list_for_tenant' }), // no minTier
      baseCurrent({ currentTier: 'free' }),
    );
    expect(decision.allow).toBe(true);
  });
});

describe('captureInvocationContext', () => {
  it('builds a stable snapshot from enqueue-time data', () => {
    const ctx = captureInvocationContext({
      toolName: 'property:list_for_tenant',
      callerId: 'u-1',
      portalId: 'estate-manager',
      userRole: 'estate_manager',
      tier: 'growth',
      tenantId: 't-1',
      enqueuedAt: new Date('2026-05-23T12:00:00Z'),
    });
    expect(ctx.toolName).toBe('property:list_for_tenant');
    expect(ctx.originalCallerId).toBe('u-1');
    expect(ctx.originalTier).toBe('growth');
    expect(ctx.enqueuedAt).toBe('2026-05-23T12:00:00.000Z');
  });

  it('defaults enqueuedAt to now when omitted', () => {
    const before = Date.now();
    const ctx = captureInvocationContext({
      toolName: 'property:list_for_tenant',
      callerId: 'u-1',
      portalId: 'estate-manager',
      userRole: 'estate_manager',
      tier: 'growth',
      tenantId: 't-1',
    });
    const after = Date.now();
    const enq = Date.parse(ctx.enqueuedAt);
    expect(enq).toBeGreaterThanOrEqual(before);
    expect(enq).toBeLessThanOrEqual(after);
  });
});
