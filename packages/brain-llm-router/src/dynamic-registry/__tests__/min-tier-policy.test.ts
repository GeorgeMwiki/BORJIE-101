/**
 * Tests for `min-tier-policy.ts`.
 *
 * Covers: pass-through, upgrade, ring buffer cap, audit sink, logger,
 * unknown category, requiresOpusFamily / requiresSonnetOrBetter,
 * stats grouping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetEnforcementLog,
  clearEnforcementAuditSink,
  clearMinTierLogger,
  enforceMinTier,
  getEnforcementLog,
  getEnforcementStats,
  MODEL_REQUIREMENTS,
  requiresOpusFamily,
  requiresSonnetOrBetter,
  setEnforcementAuditSink,
  setMinTierLogger,
} from '../min-tier-policy.js';

beforeEach(() => {
  __resetEnforcementLog();
  clearMinTierLogger();
  clearEnforcementAuditSink();
});

afterEach(() => {
  __resetEnforcementLog();
  clearMinTierLogger();
  clearEnforcementAuditSink();
});

describe('enforceMinTier — pass through (no upgrade)', () => {
  it('passes through when selected meets floor (opus on lease_drafting)', () => {
    const r = enforceMinTier('lease_drafting', 'opus');
    expect(r.upgraded).toBe(false);
    expect(r.resolved).toBe('opus');
    expect(r.reason).toBeNull();
  });

  it('passes through when selected exceeds floor (opus on tenant_screening)', () => {
    const r = enforceMinTier('tenant_screening', 'opus');
    expect(r.upgraded).toBe(false);
    expect(r.resolved).toBe('opus');
  });

  it('passes through when sonnet meets sonnet floor (rent_calculation)', () => {
    const r = enforceMinTier('rent_calculation', 'sonnet');
    expect(r.upgraded).toBe(false);
    expect(r.resolved).toBe('sonnet');
  });

  it('passes through unknown category unchanged', () => {
    const r = enforceMinTier('some_brand_new_task' as never, 'haiku');
    expect(r.upgraded).toBe(false);
    expect(r.resolved).toBe('haiku');
    expect(r.reason).toBeNull();
  });
});

describe('enforceMinTier — upgrade enforced', () => {
  it('upgrades haiku → opus for lease_drafting', () => {
    const r = enforceMinTier('lease_drafting', 'haiku');
    expect(r.upgraded).toBe(true);
    expect(r.resolved).toBe('opus');
    expect(r.original).toBe('haiku');
    expect(r.reason?.toLowerCase()).toContain('lease');
  });

  it('upgrades sonnet → opus for eviction_notice', () => {
    const r = enforceMinTier('eviction_notice', 'sonnet');
    expect(r.upgraded).toBe(true);
    expect(r.resolved).toBe('opus');
  });

  it('upgrades haiku → sonnet for tenant_screening', () => {
    const r = enforceMinTier('tenant_screening', 'haiku');
    expect(r.upgraded).toBe(true);
    expect(r.resolved).toBe('sonnet');
    expect(r.original).toBe('haiku');
  });

  it('upgrades gpt-5-mini → sonnet for compliance_check (cross-family)', () => {
    const r = enforceMinTier('compliance_check', 'gpt-5-mini');
    expect(r.upgraded).toBe(true);
    expect(r.resolved).toBe('sonnet');
  });
});

describe('enforceMinTier — audit log', () => {
  it('appends to the enforcement log on upgrade only', () => {
    enforceMinTier('lease_drafting', 'opus'); // no upgrade
    enforceMinTier('lease_drafting', 'haiku'); // upgrade
    const log = getEnforcementLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.taskCategory).toBe('lease_drafting');
    expect(log[0]?.enforcedFamily).toBe('opus');
  });

  it('groups stats by task category', () => {
    enforceMinTier('lease_drafting', 'haiku');
    enforceMinTier('lease_drafting', 'sonnet');
    enforceMinTier('eviction_notice', 'haiku');
    const stats = getEnforcementStats();
    expect(stats.lease_drafting).toBe(2);
    expect(stats.eviction_notice).toBe(1);
  });

  it('bounds the log at 500 entries (ring buffer)', () => {
    for (let i = 0; i < 600; i += 1) {
      enforceMinTier('lease_drafting', 'haiku');
    }
    expect(getEnforcementLog()).toHaveLength(500);
  });
});

describe('enforceMinTier — logger + audit-sink wiring', () => {
  it('calls the injected logger on upgrade', () => {
    const warn = vi.fn();
    setMinTierLogger({ warn });
    enforceMinTier('lease_drafting', 'haiku');
    expect(warn).toHaveBeenCalledOnce();
    const call = warn.mock.calls[0];
    expect(call?.[0]).toMatchObject({ from: 'haiku', to: 'opus' });
  });

  it('does NOT call the logger on pass-through', () => {
    const warn = vi.fn();
    setMinTierLogger({ warn });
    enforceMinTier('lease_drafting', 'opus');
    expect(warn).not.toHaveBeenCalled();
  });

  it('calls the injected audit sink on upgrade', () => {
    const sink = vi.fn();
    setEnforcementAuditSink(sink);
    enforceMinTier('lease_drafting', 'haiku');
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]?.[0]).toMatchObject({
      taskCategory: 'lease_drafting',
      enforcedFamily: 'opus',
    });
  });

  it('swallows audit-sink errors (LLM path never crashes)', () => {
    setEnforcementAuditSink(() => {
      throw new Error('boom');
    });
    expect(() => enforceMinTier('lease_drafting', 'haiku')).not.toThrow();
  });
});

describe('helpers', () => {
  it('requiresOpusFamily is true for lease_drafting', () => {
    expect(requiresOpusFamily('lease_drafting')).toBe(true);
  });

  it('requiresOpusFamily is false for casual_chat', () => {
    expect(requiresOpusFamily('casual_chat')).toBe(false);
  });

  it('requiresSonnetOrBetter is true for tenant_screening', () => {
    expect(requiresSonnetOrBetter('tenant_screening')).toBe(true);
  });

  it('requiresSonnetOrBetter is true for opus-tier (transitivity)', () => {
    expect(requiresSonnetOrBetter('lease_drafting')).toBe(true);
  });

  it('requiresSonnetOrBetter is false for unknown', () => {
    expect(requiresSonnetOrBetter('something_new' as never)).toBe(false);
  });

  it('MODEL_REQUIREMENTS is frozen', () => {
    expect(Object.isFrozen(MODEL_REQUIREMENTS)).toBe(true);
  });
});
