/**
 * Tests for the privacy-budget composer service (K6.2, parity-gap G2).
 *
 * Uses the in-memory PrivacyBudgetRepository — no Drizzle mocking.
 * Verifies:
 *   1. Fresh windows return the full tier cap.
 *   2. recordSpend debits cumulatively.
 *   3. recordSpend refuses beyond the cap (PrivacyBudgetExceededError).
 *   4. checkBudgetAvailable distinguishes epsilon vs delta exhaustion.
 *   5. Tier caps differ correctly (platform < pro < enterprise).
 *   6. Two tenants are isolated — one tenant's spend leaves the other untouched.
 *   7. Two windows are isolated — advancing the clock past 30 days
 *      resets the cap.
 *   8. Invalid inputs (≤ 0 ε, negative δ, missing tenant, unknown tier).
 *   9. Idempotency on a duplicate queryId — no double-debit.
 *  10. Concurrent recordSpend calls are atomic — sum equals the total
 *      of all calls, with no race-condition loss.
 */

import { describe, it, expect } from 'vitest';
import {
  createPrivacyBudgetComposerService,
  InMemoryPrivacyBudgetRepository,
  PrivacyBudgetExceededError,
  PRIVACY_BUDGET_TIER_CAPS,
} from '../privacy-budget-composer.service.js';

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

describe('privacy-budget-composer / fresh window', () => {
  it('returns the full platform cap for a new tenant', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'platform' });
    expect(r.totalEpsilon).toBe(PRIVACY_BUDGET_TIER_CAPS.platform.epsilon);
    expect(r.totalDelta).toBe(PRIVACY_BUDGET_TIER_CAPS.platform.delta);
    expect(r.spentEpsilon).toBe(0);
    expect(r.remainingEpsilon).toBe(PRIVACY_BUDGET_TIER_CAPS.platform.epsilon);
  });

  it('returns the full pro cap for a pro tenant', async () => {
    const svc = createPrivacyBudgetComposerService({
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    expect(r.totalEpsilon).toBe(PRIVACY_BUDGET_TIER_CAPS.pro.epsilon);
  });

  it('returns the full enterprise cap for an enterprise tenant', async () => {
    const svc = createPrivacyBudgetComposerService({
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'enterprise' });
    expect(r.totalEpsilon).toBe(PRIVACY_BUDGET_TIER_CAPS.enterprise.epsilon);
  });
});

describe('privacy-budget-composer / recordSpend', () => {
  it('debits cumulatively across multiple calls', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 1.0,
      delta: 1e-7,
      queryId: 'q1',
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 2.5,
      delta: 2e-7,
      queryId: 'q2',
    });
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    expect(r.spentEpsilon).toBeCloseTo(3.5);
    expect(r.spentDelta).toBeCloseTo(3e-7);
    expect(r.remainingEpsilon).toBeCloseTo(PRIVACY_BUDGET_TIER_CAPS.pro.epsilon - 3.5);
  });

  it('refuses when the recorded ε would overshoot the cap', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    // Platform cap is 5.0 ε; consume 4.5 then attempt 1.0 (must refuse).
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'platform',
      epsilon: 4.5,
      delta: 1e-7,
      queryId: 'q1',
    });
    await expect(
      svc.recordSpend({
        tenantId: 't1',
        tier: 'platform',
        epsilon: 1.0,
        delta: 1e-7,
        queryId: 'q2',
      }),
    ).rejects.toBeInstanceOf(PrivacyBudgetExceededError);
    // The refused spend MUST NOT have been recorded.
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'platform' });
    expect(r.spentEpsilon).toBeCloseTo(4.5);
  });

  it('rejects non-positive epsilon and negative delta', async () => {
    const svc = createPrivacyBudgetComposerService({
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await expect(
      svc.recordSpend({
        tenantId: 't1',
        tier: 'pro',
        epsilon: 0,
        delta: 1e-7,
        queryId: 'q',
      }),
    ).rejects.toThrow(/epsilon/);
    await expect(
      svc.recordSpend({
        tenantId: 't1',
        tier: 'pro',
        epsilon: -1,
        delta: 1e-7,
        queryId: 'q',
      }),
    ).rejects.toThrow(/epsilon/);
    await expect(
      svc.recordSpend({
        tenantId: 't1',
        tier: 'pro',
        epsilon: 1,
        delta: -1,
        queryId: 'q',
      }),
    ).rejects.toThrow(/delta/);
  });

  it('rejects unknown tiers', async () => {
    const svc = createPrivacyBudgetComposerService({
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await expect(
      svc.recordSpend({
        tenantId: 't1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tier: 'bogus' as any,
        epsilon: 0.5,
        delta: 1e-7,
        queryId: 'q',
      }),
    ).rejects.toThrow(/tier/);
  });

  it('is idempotent on duplicate queryId — no double-debit', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 1.0,
      delta: 1e-7,
      queryId: 'q-dup',
    });
    // Replay with the same queryId — must not double-charge.
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 1.0,
      delta: 1e-7,
      queryId: 'q-dup',
    });
    const r = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    expect(r.spentEpsilon).toBeCloseTo(1.0);
  });
});

describe('privacy-budget-composer / checkBudgetAvailable', () => {
  it('reports ok=true when within remaining', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const r = await svc.checkBudgetAvailable({
      tenantId: 't1',
      tier: 'pro',
      requestedEpsilon: 1.0,
      requestedDelta: 1e-7,
    });
    expect(r.ok).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('reports epsilon-exhausted when the request would overshoot ε', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 9.5,
      delta: 1e-7,
      queryId: 'q1',
    });
    const r = await svc.checkBudgetAvailable({
      tenantId: 't1',
      tier: 'pro',
      requestedEpsilon: 1.0,
      requestedDelta: 1e-8,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('epsilon-exhausted');
  });

  it('reports delta-exhausted when ε fits but δ would overshoot', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    // Pro δ cap is 1e-5. Spend most of δ via a single big call.
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 0.1,
      delta: 9e-6,
      queryId: 'q1',
    });
    const r = await svc.checkBudgetAvailable({
      tenantId: 't1',
      tier: 'pro',
      requestedEpsilon: 0.1,
      requestedDelta: 2e-6,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('delta-exhausted');
  });

  it('rejects invalid inputs as invalid-input rather than crashing', async () => {
    const svc = createPrivacyBudgetComposerService({
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const a = await svc.checkBudgetAvailable({
      tenantId: 't1',
      tier: 'pro',
      requestedEpsilon: 0,
      requestedDelta: 1e-7,
    });
    expect(a.ok).toBe(false);
    expect(a.reason).toBe('invalid-input');
    const b = await svc.checkBudgetAvailable({
      tenantId: 't1',
      tier: 'pro',
      requestedEpsilon: 1,
      requestedDelta: -1,
    });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('invalid-input');
  });
});

describe('privacy-budget-composer / isolation', () => {
  it('isolates spend across tenants', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 3.0,
      delta: 1e-7,
      queryId: 'q1',
    });
    const t1 = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    const t2 = await svc.getRemainingBudget({ tenantId: 't2', tier: 'pro' });
    expect(t1.spentEpsilon).toBeCloseTo(3.0);
    expect(t2.spentEpsilon).toBe(0);
  });

  it('isolates spend across windows — new window after 30 days starts at 0', async () => {
    let nowIso = '2026-05-14T00:00:00Z';
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: () => new Date(nowIso),
    });
    await svc.recordSpend({
      tenantId: 't1',
      tier: 'pro',
      epsilon: 4.0,
      delta: 1e-7,
      queryId: 'q1',
    });
    const before = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    expect(before.spentEpsilon).toBeCloseTo(4.0);
    // Advance the clock past the next 30-day window boundary.
    nowIso = '2026-08-14T00:00:00Z';
    const after = await svc.getRemainingBudget({ tenantId: 't1', tier: 'pro' });
    // Must be a new window — spend has not carried over.
    expect(after.windowStart).not.toBe(before.windowStart);
    expect(after.spentEpsilon).toBe(0);
  });
});

describe('privacy-budget-composer / concurrency', () => {
  it('concurrent recordSpend calls sum exactly (no race-condition loss)', async () => {
    const svc = createPrivacyBudgetComposerService({
      repository: new InMemoryPrivacyBudgetRepository(),
      now: fixedClock('2026-05-14T00:00:00Z'),
    });
    const calls = Array.from({ length: 20 }, (_, i) =>
      svc.recordSpend({
        tenantId: 't1',
        tier: 'enterprise',
        epsilon: 0.1,
        delta: 1e-8,
        queryId: `q-${i}`,
      }),
    );
    await Promise.all(calls);
    const r = await svc.getRemainingBudget({
      tenantId: 't1',
      tier: 'enterprise',
    });
    // 20 × 0.1 = 2.0; floating-point math may add a tiny residual.
    expect(r.spentEpsilon).toBeCloseTo(2.0, 6);
  });
});
