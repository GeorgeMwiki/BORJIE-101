/**
 * Tests for the default policy gate (spec §8).
 *
 * Night mode default: T0 only. T1 allowed only when the tool id is in
 * the night allowlist. T2 always blocked at night. T2-critical never
 * auto-fires.
 */

import { describe, it, expect } from 'vitest';

import { createDefaultPolicyGate } from '../tick/ports.js';

describe('policy-gate / night-mode T0 read-only default', () => {
  const gate = createDefaultPolicyGate();

  it('allows T0 at night', async () => {
    const decision = await gate.check({
      tenantId: 't',
      mode: 'night',
      toolTier: 't0',
      toolId: 'telemetry_sweep_v1',
    });
    expect(decision.allowed).toBe(true);
  });

  it('blocks T1 at night when no allowlist', async () => {
    const decision = await gate.check({
      tenantId: 't',
      mode: 'night',
      toolTier: 't1',
      toolId: 'draft_buyer_reply_v1',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('night_restriction');
  });

  it('allows T1 at night when in allowlist', async () => {
    const allow = createDefaultPolicyGate({
      nightAllowlist: ['draft_tumemadini_return_v1'],
    });
    const decision = await allow.check({
      tenantId: 't',
      mode: 'night',
      toolTier: 't1',
      toolId: 'draft_tumemadini_return_v1',
    });
    expect(decision.allowed).toBe(true);
  });

  it('blocks T2 at night even with allowlist', async () => {
    const allow = createDefaultPolicyGate({
      nightAllowlist: ['file_return_v1'],
    });
    const decision = await allow.check({
      tenantId: 't',
      mode: 'night',
      toolTier: 't2',
      toolId: 'file_return_v1',
    });
    expect(decision.allowed).toBe(false);
  });

  it('blocks T2-critical in every mode', async () => {
    for (const mode of ['active', 'idle', 'night', 'observe'] as const) {
      const decision = await gate.check({
        tenantId: 't',
        mode,
        toolTier: 't2-critical',
        toolId: 'kill_recipe_v1',
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('killswitch');
    }
  });
});

describe('policy-gate / non-night modes', () => {
  const gate = createDefaultPolicyGate();

  it('allows T0 + T1 in active mode', async () => {
    const t0 = await gate.check({
      tenantId: 't',
      mode: 'active',
      toolTier: 't0',
      toolId: 'recall_v1',
    });
    const t1 = await gate.check({
      tenantId: 't',
      mode: 'active',
      toolTier: 't1',
      toolId: 'draft_v1',
    });
    expect(t0.allowed).toBe(true);
    expect(t1.allowed).toBe(true);
  });

  it('blocks T2 in active mode (queues for owner approval upstream)', async () => {
    const decision = await gate.check({
      tenantId: 't',
      mode: 'active',
      toolTier: 't2',
      toolId: 'send_email_v1',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('tier_blocked');
  });

  it('observe mode is T0-only', async () => {
    const t0 = await gate.check({
      tenantId: 't',
      mode: 'observe',
      toolTier: 't0',
      toolId: 'observe_v1',
    });
    expect(t0.allowed).toBe(true);
    const t1 = await gate.check({
      tenantId: 't',
      mode: 'observe',
      toolTier: 't1',
      toolId: 'draft_v1',
    });
    expect(t1.allowed).toBe(false);
  });
});
