/**
 * Tests for `policy-decision-ocsf.ts` + `cross-family-alert.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bindCrossFamilyFallbackToLogger,
  bindMinTierToOcsf,
  formatPolicyDecisionOcsf,
} from '../index.js';
import {
  __resetEnforcementLog,
  clearEnforcementAuditSink,
  enforceMinTier,
} from '../../dynamic-registry/min-tier-policy.js';

beforeEach(() => {
  __resetEnforcementLog();
  clearEnforcementAuditSink();
});

afterEach(() => {
  __resetEnforcementLog();
  clearEnforcementAuditSink();
});

describe('formatPolicyDecisionOcsf', () => {
  it('produces a valid OCSF 6003 (Policy Decision) shape', () => {
    const out = formatPolicyDecisionOcsf({
      timestampMs: 1_700_000_000_000,
      taskCategory: 'lease_drafting',
      originalFamily: 'haiku',
      enforcedFamily: 'opus',
      reason: 'Lease contracts are legally binding',
    });
    expect(out.category_uid).toBe(6);
    expect(out.class_uid).toBe(6003);
    expect(out.activity_id).toBe(1);
    expect(out.status).toBe('enforced');
    expect(out.policy.name).toBe('min-tier');
    expect(out.time).toBe(1_700_000_000_000);
    expect(out.enrichments).toContainEqual({
      name: 'task_category',
      value: 'lease_drafting',
    });
    expect(out.enrichments).toContainEqual({
      name: 'original_family',
      value: 'haiku',
    });
    expect(out.enrichments).toContainEqual({
      name: 'enforced_family',
      value: 'opus',
    });
  });

  it('includes the policy desc from the enforcement reason', () => {
    const out = formatPolicyDecisionOcsf({
      timestampMs: 1,
      taskCategory: 'lease_drafting',
      originalFamily: 'haiku',
      enforcedFamily: 'opus',
      reason: 'Custom reason text',
    });
    expect(out.policy.desc).toBe('Custom reason text');
  });
});

describe('bindMinTierToOcsf', () => {
  it('fires the emitter on min-tier upgrade', () => {
    const emit = vi.fn();
    bindMinTierToOcsf(emit);
    enforceMinTier('lease_drafting', 'haiku');
    expect(emit).toHaveBeenCalledOnce();
    const ocsf = emit.mock.calls[0]?.[0];
    expect(ocsf.class_uid).toBe(6003);
    expect(ocsf.enrichments.find((e: { name: string }) => e.name === 'task_category')?.value).toBe(
      'lease_drafting',
    );
  });

  it('does NOT fire on pass-through (no upgrade)', () => {
    const emit = vi.fn();
    bindMinTierToOcsf(emit);
    enforceMinTier('lease_drafting', 'opus');
    expect(emit).not.toHaveBeenCalled();
  });

  it('swallows emitter errors', () => {
    bindMinTierToOcsf(() => {
      throw new Error('OCSF sink down');
    });
    expect(() => enforceMinTier('lease_drafting', 'haiku')).not.toThrow();
  });
});

describe('bindCrossFamilyFallbackToLogger', () => {
  it('returns a hook that fires the emitter', () => {
    const emit = vi.fn();
    const hook = bindCrossFamilyFallbackToLogger(emit);
    hook({
      fromProvider: 'anthropic',
      toProvider: 'openai',
      taskKind: 'chat',
      reason: 'anthropic 5xx',
    });
    expect(emit).toHaveBeenCalledOnce();
    const event = emit.mock.calls[0]?.[0];
    expect(event.fromFamily).toBe('anthropic');
    expect(event.toFamily).toBe('openai');
    expect(event.taskKind).toBe('chat');
  });

  it('maps unknown providers to "unknown" family', () => {
    const emit = vi.fn();
    const hook = bindCrossFamilyFallbackToLogger(emit);
    hook({
      fromProvider: 'something-weird',
      toProvider: 'something-else',
      taskKind: 'chat',
    });
    expect(emit.mock.calls[0]?.[0].fromFamily).toBe('unknown');
  });

  it('defaults reason to "unknown" when omitted', () => {
    const emit = vi.fn();
    const hook = bindCrossFamilyFallbackToLogger(emit);
    hook({
      fromProvider: 'anthropic',
      toProvider: 'openai',
      taskKind: 'chat',
    });
    expect(emit.mock.calls[0]?.[0].reason).toBe('unknown');
  });

  it('swallows emitter errors', () => {
    const hook = bindCrossFamilyFallbackToLogger(() => {
      throw new Error('alert sink down');
    });
    expect(() =>
      hook({
        fromProvider: 'anthropic',
        toProvider: 'openai',
        taskKind: 'chat',
      }),
    ).not.toThrow();
  });

  it('maps gemini → google family', () => {
    const emit = vi.fn();
    const hook = bindCrossFamilyFallbackToLogger(emit);
    hook({
      fromProvider: 'gemini',
      toProvider: 'anthropic',
      taskKind: 'chat',
    });
    expect(emit.mock.calls[0]?.[0].fromFamily).toBe('google');
  });

  it('maps ollama → local family', () => {
    const emit = vi.fn();
    const hook = bindCrossFamilyFallbackToLogger(emit);
    hook({
      fromProvider: 'ollama',
      toProvider: 'vllm',
      taskKind: 'chat',
    });
    expect(emit.mock.calls[0]?.[0].fromFamily).toBe('local');
    expect(emit.mock.calls[0]?.[0].toFamily).toBe('local');
  });
});
