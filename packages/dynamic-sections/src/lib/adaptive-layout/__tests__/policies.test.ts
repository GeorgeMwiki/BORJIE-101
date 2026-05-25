/**
 * Policy-level unit tests.
 *
 * Each policy is tested individually + a few cross-policy scenarios
 * confirm the combinator behaviour at the engine boundary.
 */

import { describe, expect, it } from 'vitest';

import { decideLayout } from '../engine.js';
import { frustrationPolicy } from '../policies/frustration-policy.js';
import { roleMasteryPolicy } from '../policies/role-mastery-policy.js';
import { recencyPolicy } from '../policies/recency-policy.js';
import { intentPolicy } from '../policies/intent-policy.js';
import type { LayoutContext } from '../types.js';

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

// ─────────────────────────────────────────────────────────────────────
// Frustration policy
// ─────────────────────────────────────────────────────────────────────

describe('frustrationPolicy', () => {
  it('pushes support sections to the top when frustration >= 0.5', () => {
    const ctx = makeContext({
      affectiveProfile: {
        frustration: 0.65,
        comprehension: 0.5,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'reports', 'support-centre', 'tenant.help'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    expect(out.sections[0]).toBe('support-centre');
    expect(out.sections[1]).toBe('tenant.help');
    expect(out.pinned).toEqual(['support-centre', 'tenant.help']);
  });

  it('hides marketing/upsell sections when frustration is high', () => {
    const ctx = makeContext({
      affectiveProfile: {
        frustration: 0.7,
        comprehension: 0.5,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'promo-banner', 'support', 'upgrade-prompt'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    expect(out.hidden).toEqual(expect.arrayContaining(['promo-banner', 'upgrade-prompt']));
    expect(out.sections).not.toContain('promo-banner');
    expect(out.sections).not.toContain('upgrade-prompt');
  });

  it('abstains below the threshold', () => {
    const ctx = makeContext({
      affectiveProfile: {
        frustration: 0.3,
        comprehension: 0.5,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'support', 'promo-banner'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    expect(out.sections).toEqual(base);
    expect(out.pinned).toEqual([]);
    expect(out.hidden).toEqual([]);
  });

  it('abstains when no affective profile is available (cold-start)', () => {
    const ctx = makeContext({});
    const base = ['home', 'support', 'promo-banner'];
    const out = decideLayout(ctx, base, [frustrationPolicy]);
    expect(out.sections).toEqual(base);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Role-mastery policy
// ─────────────────────────────────────────────────────────────────────

describe('roleMasteryPolicy', () => {
  it('hides advanced sections for novice viewers', () => {
    const ctx = makeContext({ masteryLevel: 'novice' });
    const base = ['home', 'tax-filing.pro', 'reports', 'maintenance.advanced'];
    const out = decideLayout(ctx, base, [roleMasteryPolicy]);
    expect(out.hidden).toEqual(expect.arrayContaining(['tax-filing.pro', 'maintenance.advanced']));
    expect(out.sections).toEqual(['home', 'reports']);
  });

  it('boosts advanced sections for expert viewers (but does not hide)', () => {
    const ctx = makeContext({ masteryLevel: 'expert' });
    const base = ['home', 'tax-filing.pro', 'reports'];
    const out = decideLayout(ctx, base, [roleMasteryPolicy]);
    // Pro mode boosts but does NOT pin (boost weight is 1 * weight 3 = 3
    // out of 0 for the others). The advanced section moves to the top
    // because it has positive score, others have zero.
    expect(out.sections[0]).toBe('tax-filing.pro');
    expect(out.hidden).toEqual([]);
    expect(out.sections).toContain('home');
    expect(out.sections).toContain('reports');
  });

  it('is a no-op for intermediate viewers', () => {
    const ctx = makeContext({ masteryLevel: 'intermediate' });
    const base = ['home', 'tax-filing.pro', 'reports'];
    const out = decideLayout(ctx, base, [roleMasteryPolicy]);
    expect(out.sections).toEqual(base);
  });

  it('does not classify "improve" or "progress" as advanced (token check)', () => {
    const ctx = makeContext({ masteryLevel: 'novice' });
    const base = ['owner.improve', 'owner.progress', 'home'];
    const out = decideLayout(ctx, base, [roleMasteryPolicy]);
    expect(out.hidden).toEqual([]);
    expect(out.sections).toEqual(base);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Recency policy
// ─────────────────────────────────────────────────────────────────────

describe('recencyPolicy', () => {
  it('pins the top-3 most-recently-used sections to the top in recency order', () => {
    const ctx = makeContext({
      behavior: { recentActions: ['reports', 'maintenance', 'home', 'old-section'] },
    });
    const base = ['home', 'reports', 'maintenance', 'settings'];
    const out = decideLayout(ctx, base, [recencyPolicy]);
    expect(out.sections.slice(0, 3)).toEqual(['reports', 'maintenance', 'home']);
    expect(out.sections).toContain('settings');
  });

  it('only pins ids that still exist in baseSections', () => {
    const ctx = makeContext({
      behavior: { recentActions: ['ghost-section', 'home'] },
    });
    const base = ['home', 'settings'];
    const out = decideLayout(ctx, base, [recencyPolicy]);
    expect(out.pinned).toEqual(['home']);
    expect(out.sections).toEqual(['home', 'settings']);
  });

  it('abstains when there are no recent actions', () => {
    const ctx = makeContext({ behavior: { recentActions: [] } });
    const base = ['home', 'settings'];
    const out = decideLayout(ctx, base, [recencyPolicy]);
    expect(out.sections).toEqual(base);
    expect(out.pinned).toEqual([]);
  });

  it('de-dupes recent actions while preserving recency', () => {
    const ctx = makeContext({
      behavior: { recentActions: ['a', 'b', 'a', 'c', 'b'] },
    });
    const base = ['a', 'b', 'c', 'd'];
    const out = decideLayout(ctx, base, [recencyPolicy]);
    expect(out.pinned).toEqual(['a', 'b', 'c']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Intent policy
// ─────────────────────────────────────────────────────────────────────

describe('intentPolicy', () => {
  it('pins payment sections when intent="payment"', () => {
    const ctx = makeContext({ intent: 'payment' });
    const base = ['home', 'maintenance', 'tenant.payments', 'settings'];
    const out = decideLayout(ctx, base, [intentPolicy]);
    expect(out.sections[0]).toBe('tenant.payments');
  });

  it('overrides recency when both are present', () => {
    const ctx = makeContext({
      intent: 'payment',
      behavior: { recentActions: ['settings', 'maintenance'] },
    });
    const base = ['home', 'settings', 'maintenance', 'tenant.payments'];
    const out = decideLayout(ctx, base, [intentPolicy, recencyPolicy]);
    // Intent (weight 25) > recency (weight 5) → payments first.
    expect(out.sections[0]).toBe('tenant.payments');
    // Recency-pinned settings + maintenance follow.
    expect(out.sections).toContain('settings');
    expect(out.sections).toContain('maintenance');
  });

  it('abstains for unknown intents', () => {
    const ctx = makeContext({ intent: 'never-heard-of-this' });
    const base = ['home', 'tenant.payments'];
    const out = decideLayout(ctx, base, [intentPolicy]);
    expect(out.sections).toEqual(base);
  });

  it('abstains when intent is null', () => {
    const ctx = makeContext({ intent: null });
    const base = ['home', 'tenant.payments'];
    const out = decideLayout(ctx, base, [intentPolicy]);
    expect(out.sections).toEqual(base);
  });

  it('is case-insensitive on the intent string', () => {
    const ctx = makeContext({ intent: 'PAYMENT' });
    const base = ['home', 'tenant.payments'];
    const out = decideLayout(ctx, base, [intentPolicy]);
    expect(out.sections[0]).toBe('tenant.payments');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-policy scenarios
// ─────────────────────────────────────────────────────────────────────

describe('cross-policy interactions', () => {
  it('frustration policy hides upsell even when role-mastery is novice', () => {
    const ctx = makeContext({
      masteryLevel: 'novice',
      affectiveProfile: {
        frustration: 0.8,
        comprehension: 0.5,
        anxiety: 0.5,
        trust: 0.5,
        urgency: 0.5,
      },
    });
    const base = ['home', 'reports.pro', 'upgrade-banner', 'help-centre'];
    const out = decideLayout(ctx, base, [frustrationPolicy, roleMasteryPolicy]);
    expect(out.hidden).toEqual(expect.arrayContaining(['reports.pro', 'upgrade-banner']));
    expect(out.sections[0]).toBe('help-centre');
  });

  it('intent + frustration converge on the same section', () => {
    const ctx = makeContext({
      intent: 'support',
      affectiveProfile: {
        frustration: 0.9,
        comprehension: 0.4,
        anxiety: 0.6,
        trust: 0.5,
        urgency: 0.7,
      },
    });
    const base = ['home', 'support-centre', 'reports'];
    const out = decideLayout(ctx, base, [intentPolicy, frustrationPolicy]);
    expect(out.sections[0]).toBe('support-centre');
    // Score from both policies → very high
  });

  it('all four policies merge into a coherent ordering', () => {
    const ctx = makeContext({
      masteryLevel: 'expert',
      intent: 'reports',
      behavior: { recentActions: ['home', 'settings'] },
      affectiveProfile: {
        frustration: 0.2,
        comprehension: 0.8,
        anxiety: 0.2,
        trust: 0.8,
        urgency: 0.4,
      },
    });
    const base = [
      'home',
      'settings',
      'tenant.reports',
      'tenant.reports.pro',
      'maintenance',
    ];
    const out = decideLayout(ctx, base, [
      intentPolicy,
      frustrationPolicy,
      roleMasteryPolicy,
      recencyPolicy,
    ]);
    // Intent → tenant.reports + tenant.reports.pro pinned (weight 25 each).
    // tenant.reports.pro also gets expert boost.
    // Recency → home, settings (weight 5).
    expect(out.sections[0]).toMatch(/tenant\.reports/);
    expect(out.sections.slice(0, 2)).toEqual(
      expect.arrayContaining(['tenant.reports', 'tenant.reports.pro']),
    );
  });
});
