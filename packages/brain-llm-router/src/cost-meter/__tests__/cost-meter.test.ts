/**
 * Tests for `cost-meter.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTenantSpend,
  meterCall,
  resetAllTenantSpend,
  resetCostMeterEmitter,
  resetTenantSpend,
  setCostMeterEmitter,
} from '../cost-meter.js';

beforeEach(() => {
  resetAllTenantSpend();
  resetCostMeterEmitter();
});

afterEach(() => {
  resetAllTenantSpend();
  resetCostMeterEmitter();
});

describe('meterCall', () => {
  it('returns a CostMeterEvent with usd > 0 for non-zero tokens', () => {
    const e = meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(e.usd).toBeGreaterThan(0);
    expect(e.tenantId).toBe('t1');
    expect(e.inputTokens).toBe(1000);
    expect(e.outputTokens).toBe(500);
  });

  it('returns usd === 0 for zero tokens', () => {
    const e = meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(e.usd).toBe(0);
  });

  it('includes cache tokens when supplied', () => {
    const e = meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
    expect(e.cacheReadTokens).toBe(10);
    expect(e.cacheWriteTokens).toBe(5);
  });

  it('defaults cache tokens to 0 when omitted', () => {
    const e = meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(e.cacheReadTokens).toBe(0);
    expect(e.cacheWriteTokens).toBe(0);
  });
});

describe('per-tenant accumulator', () => {
  it('accumulates total USD per tenant', () => {
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
    });
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
    });
    const snap = getTenantSpend('t1');
    expect(snap?.callCount).toBe(2);
    expect(snap?.totalUsd).toBeGreaterThan(0);
  });

  it('keeps tenants isolated', () => {
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 500,
    });
    expect(getTenantSpend('t2')).toBeNull();
    expect(getTenantSpend('t1')).not.toBeNull();
  });

  it('resetTenantSpend wipes one tenant only', () => {
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'gpt-5',
      inputTokens: 100,
      outputTokens: 50,
    });
    meterCall({
      tenantId: 't2',
      taskKind: 'chat',
      model: 'gpt-5',
      inputTokens: 100,
      outputTokens: 50,
    });
    resetTenantSpend('t1');
    expect(getTenantSpend('t1')).toBeNull();
    expect(getTenantSpend('t2')).not.toBeNull();
  });
});

describe('emitter wiring', () => {
  it('fires the injected emitter on each call', () => {
    const emit = vi.fn();
    setCostMeterEmitter(emit);
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'gpt-5',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(emit).toHaveBeenCalledOnce();
    const event = emit.mock.calls[0]?.[0];
    expect(event.tenantId).toBe('t1');
    expect(event.usd).toBeGreaterThan(0);
  });

  it('swallows emitter errors (hot path never crashes)', () => {
    setCostMeterEmitter(() => {
      throw new Error('observability boom');
    });
    expect(() =>
      meterCall({
        tenantId: 't1',
        taskKind: 'chat',
        model: 'gpt-5',
        inputTokens: 100,
        outputTokens: 50,
      }),
    ).not.toThrow();
  });

  it('still accumulates spend when emitter throws', () => {
    setCostMeterEmitter(() => {
      throw new Error('boom');
    });
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'gpt-5',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(getTenantSpend('t1')?.callCount).toBe(1);
  });
});

describe('snapshot shape', () => {
  it('records firstCallMs and lastCallMs', () => {
    const before = Date.now();
    meterCall({
      tenantId: 't1',
      taskKind: 'chat',
      model: 'gpt-5',
      inputTokens: 100,
      outputTokens: 50,
    });
    const snap = getTenantSpend('t1');
    expect(snap?.firstCallMs).toBeGreaterThanOrEqual(before);
    expect(snap?.lastCallMs).toBeGreaterThanOrEqual(snap?.firstCallMs ?? 0);
  });
});
