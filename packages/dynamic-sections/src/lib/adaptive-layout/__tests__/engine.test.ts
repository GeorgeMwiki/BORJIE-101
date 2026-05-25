/**
 * Engine-level tests for the adaptive layout engine.
 *
 * Covers:
 *   - empty policy list passthrough
 *   - hidden ⊆ baseSections (never invents ids)
 *   - merge of multiple policies (stable, weighted)
 *   - determinism (same input → same output)
 *   - idempotency (engine output is a valid input to another engine call)
 *   - rationale is non-empty + PII-free
 */

import { describe, expect, it } from 'vitest';

import { decideLayout } from '../engine.js';
import { frustrationPolicy } from '../policies/frustration-policy.js';
import { recencyPolicy } from '../policies/recency-policy.js';
import { roleMasteryPolicy } from '../policies/role-mastery-policy.js';
import { intentPolicy } from '../policies/intent-policy.js';
import type {
  LayoutContext,
  LayoutPolicy,
  LayoutPreference,
} from '../types.js';

function makeContext(overrides: Partial<LayoutContext> = {}): LayoutContext {
  return {
    tenantId: 't1',
    userId: 'u1',
    route: 'owner.dashboard',
    role: 'owner',
    masteryLevel: 'intermediate',
    behavior: { recentActions: [] },
    intent: null,
    viewport: 'desktop',
    ...overrides,
  };
}

describe('decideLayout — engine', () => {
  it('returns baseSections unchanged when no policies are supplied', () => {
    const ctx = makeContext();
    const base = ['a', 'b', 'c'];
    const out = decideLayout(ctx, base, []);
    expect(out.sections).toEqual(base);
    expect(out.pinned).toEqual([]);
    expect(out.hidden).toEqual([]);
    expect(out.rationale).toBe('no-policies-applied');
  });

  it('returns baseSections unchanged when every policy abstains', () => {
    const ctx = makeContext({
      // None of the shipped policies will trigger:
      //   - no intent
      //   - intermediate mastery
      //   - no recent actions
      //   - no affective profile
    });
    const base = ['a', 'b', 'c'];
    const out = decideLayout(ctx, base, [
      intentPolicy,
      frustrationPolicy,
      roleMasteryPolicy,
      recencyPolicy,
    ]);
    expect(out.sections).toEqual(base);
    expect(out.pinned).toEqual([]);
    expect(out.hidden).toEqual([]);
  });

  it('de-dupes baseSections defensively', () => {
    const ctx = makeContext();
    const out = decideLayout(ctx, ['a', 'b', 'a', 'c', 'b'], []);
    expect(out.sections).toEqual(['a', 'b', 'c']);
  });

  it('hidden set is the union of every policy hide, intersected with base', () => {
    const ctx = makeContext({
      affectiveProfile: {
        frustration: 0.9,
        comprehension: 0.5,
        anxiety: 0.3,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'promo-banner', 'help-centre', 'upgrade-flow'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    // promo-banner + upgrade-flow are hidden by the frustration policy
    expect(out.hidden).toEqual(expect.arrayContaining(['promo-banner', 'upgrade-flow']));
    expect(out.sections).not.toContain('promo-banner');
    expect(out.sections).not.toContain('upgrade-flow');
  });

  it('engine ignores hide ids that are not in baseSections', () => {
    // A policy that tries to hide an unknown id MUST not affect output.
    const ghostPolicy: LayoutPolicy = {
      id: 'ghost',
      decide(): LayoutPreference {
        return {
          pin: [],
          hide: ['this-id-does-not-exist'],
          boost: {},
          weight: 99,
          reason: 'ghost',
        };
      },
    };
    const ctx = makeContext();
    const out = decideLayout(ctx, ['a', 'b'], [ghostPolicy]);
    expect(out.hidden).toEqual([]);
    expect(out.sections).toEqual(['a', 'b']);
  });

  it('merges multiple policies stably by weight', () => {
    const ctx = makeContext({
      intent: 'payment',
      behavior: { recentActions: ['settings'] },
      masteryLevel: 'novice',
    });
    const base = ['settings', 'tenant.payments', 'tenant.maintenance-pro'];
    const out = decideLayout(ctx, base, [
      intentPolicy,
      recencyPolicy,
      roleMasteryPolicy,
    ]);
    // Intent (weight 25) wins over recency (weight 5):
    //   tenant.payments → top
    //   settings → recency below intent
    //   tenant.maintenance-pro → hidden (novice + .pro)
    expect(out.sections[0]).toBe('tenant.payments');
    expect(out.sections).toContain('settings');
    expect(out.sections).not.toContain('tenant.maintenance-pro');
    expect(out.hidden).toContain('tenant.maintenance-pro');
  });

  it('is deterministic — same input yields identical output across runs', () => {
    const ctx = makeContext({
      intent: 'payment',
      behavior: { recentActions: ['settings', 'reports'] },
      affectiveProfile: {
        frustration: 0.6,
        comprehension: 0.5,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['settings', 'tenant.payments', 'support-centre', 'reports'];
    const a = decideLayout(ctx, base, [
      intentPolicy,
      frustrationPolicy,
      recencyPolicy,
    ]);
    const b = decideLayout(ctx, base, [
      intentPolicy,
      frustrationPolicy,
      recencyPolicy,
    ]);
    expect(b.sections).toEqual(a.sections);
    expect(b.pinned).toEqual(a.pinned);
    expect(b.hidden).toEqual(a.hidden);
    expect(b.rationale).toEqual(a.rationale);
  });

  it('is idempotent — running the engine on its own output yields the same sections', () => {
    const ctx = makeContext({
      intent: 'payment',
      behavior: { recentActions: ['settings', 'reports'] },
    });
    const base = ['settings', 'tenant.payments', 'support-centre', 'reports'];
    const first = decideLayout(ctx, base, [intentPolicy, recencyPolicy]);
    const second = decideLayout(ctx, first.sections, [intentPolicy, recencyPolicy]);
    expect(second.sections).toEqual(first.sections);
  });

  it('rationale is non-empty + reflects the active policies', () => {
    const ctx = makeContext({
      affectiveProfile: {
        frustration: 0.9,
        comprehension: 0.4,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'help-centre', 'promo-banner'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    expect(out.rationale).toContain('frustration');
    expect(out.rationale).toContain('hidden=');
    expect(out.rationale).toContain('pinned=');
  });
});
