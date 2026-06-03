/**
 * Cognitive composer wiring — LP-01.
 *
 * Covers the TTC routing (Self-Discover band, LATS hard edge, fast path),
 * the env-flag gate, and the fail-safe contract (composer error / disabled
 * → null so the caller falls back to memory-recall-only).
 */

import { describe, it, expect, vi } from 'vitest';
import type { CompositionDeps, WireProbeFn } from '@borjie/cognitive-composition';
import {
  routeReasoning,
  isCognitiveComposerEnabled,
  wireCognitiveComposer,
  COGNITIVE_COMPOSER_FLAG,
  __testables,
} from '../cognitive-composer-wiring.js';
import type { CognitiveLogger } from '../cognitive-wiring.js';

function silentLogger(): CognitiveLogger {
  const noop = (): void => undefined;
  return { debug: noop, info: noop, warn: noop, error: noop };
}

const okProbe: WireProbeFn = async () => ({ status: 'up' });

/** Minimal happy-path CompositionDeps — every wire resolves deterministically. */
function fakeCompositionDeps(overrides: Partial<CompositionDeps> = {}): CompositionDeps {
  const memTier = (tier: 'episodic' | 'semantic' | 'procedural' | 'reflective') => ({
    tier,
    recall: async () => [{ cellId: `${tier}-1`, text: `${tier} fact` }],
    probe: okProbe,
  });
  return {
    inference: {
      infer: async () => ({ text: 'draft', confidence: 0.82 }),
      probe: okProbe,
    },
    memoryTiers: {
      episodic: memTier('episodic'),
      semantic: memTier('semantic'),
      procedural: memTier('procedural'),
      reflective: memTier('reflective'),
    },
    cot: { cot: async () => ({ trace: ['step-1'] }), probe: okProbe },
    substrate: { compile: async () => ({ programId: 'prog-1' }), probe: okProbe },
    kernel: { hook: async () => undefined, probe: okProbe },
    calibration: { observe: async () => ({ driftScore: 0.1 }), probe: okProbe },
    conformal: { update: async () => ({ alpha: 0.1 }), probe: okProbe },
    audit: {
      append: async () => ({ rowHash: 'h1', prevHash: 'h0' }),
      verify: async () => ({ ok: true, firstBrokenIndex: null }),
      probe: okProbe,
    },
    brainRouter: {
      cascade: async () => ({ text: 'final answer', modelId: 'sonnet-4-6' }),
      probe: okProbe,
    },
    healthStore: {
      upsert: async () => undefined,
      list: async () => [],
    },
    ...overrides,
  };
}

describe('LP-01 — routeReasoning (TTC routing)', () => {
  it('routes critical stakes to LATS (hard edge)', () => {
    const r = routeReasoning({ stakes: 'critical', surface: 'owner-portal' });
    expect(r.strategy).toBe('lats');
  });

  it('routes very high ambiguity to LATS even at lower stakes', () => {
    const r = routeReasoning({
      stakes: 'high',
      surface: 'owner-portal',
      ambiguityScore: 0.95,
    });
    expect(r.strategy).toBe('lats');
  });

  it('routes the 0.5..0.8 ambiguity band to Self-Discover', () => {
    const r = routeReasoning({
      stakes: 'high',
      surface: 'owner-portal',
      ambiguityScore: 0.6,
    });
    expect(r.strategy).toBe('self-discover');
  });

  it('routes low stakes / low ambiguity to the fast path', () => {
    const r = routeReasoning({
      stakes: 'low',
      surface: 'tenant-app',
      ambiguityScore: 0.1,
    });
    expect(r.strategy).toBe('fast');
  });

  it('uses the documented band thresholds', () => {
    expect(__testables.LATS_DIFFICULTY_EDGE).toBe(0.8);
    expect(__testables.SELF_DISCOVER_LOWER).toBe(0.5);
  });
});

describe('LP-01 — flag gate', () => {
  it('is OFF by default', () => {
    expect(isCognitiveComposerEnabled({})).toBe(false);
  });
  it('is ON for "1" / "true"', () => {
    expect(isCognitiveComposerEnabled({ [COGNITIVE_COMPOSER_FLAG]: '1' })).toBe(true);
    expect(isCognitiveComposerEnabled({ [COGNITIVE_COMPOSER_FLAG]: 'true' })).toBe(true);
  });
  it('is OFF for any other value', () => {
    expect(isCognitiveComposerEnabled({ [COGNITIVE_COMPOSER_FLAG]: 'yes' })).toBe(false);
  });
});

describe('LP-01 — wireCognitiveComposer (enabled path)', () => {
  it('runs the deep compose for a routed (non-fast) turn when enabled', async () => {
    const wired = wireCognitiveComposer({
      compositionDeps: fakeCompositionDeps(),
      env: { [COGNITIVE_COMPOSER_FLAG]: '1' },
      logger: silentLogger(),
    });
    expect(wired).not.toBeNull();
    const result = await wired!.runForTurn({
      tenantId: 'tenant-1',
      turnId: 'turn-1',
      userMessage: 'Should we renew licence ML-4471 given the assay drop?',
      stakes: 'critical',
      surface: 'owner-portal',
    });
    expect(result).not.toBeNull();
    expect(result!.route.strategy).toBe('lats');
    expect(result!.output.text).toBe('final answer');
  });

  it('returns null on the fast path (memory-recall-only fallback)', async () => {
    const wired = wireCognitiveComposer({
      compositionDeps: fakeCompositionDeps(),
      env: { [COGNITIVE_COMPOSER_FLAG]: '1' },
      logger: silentLogger(),
    });
    const result = await wired!.runForTurn({
      tenantId: 'tenant-1',
      turnId: 'turn-2',
      userMessage: 'hello',
      stakes: 'low',
      surface: 'tenant-app',
      ambiguityScore: 0.05,
    });
    expect(result).toBeNull();
  });
});

describe('LP-01 — wireCognitiveComposer (disabled / fail-safe paths)', () => {
  it('returns null from runForTurn when the flag is disabled', async () => {
    const wired = wireCognitiveComposer({
      compositionDeps: fakeCompositionDeps(),
      env: {}, // flag OFF
      logger: silentLogger(),
    });
    const result = await wired!.runForTurn({
      tenantId: 'tenant-1',
      turnId: 'turn-3',
      userMessage: 'high stakes question',
      stakes: 'critical',
      surface: 'owner-portal',
    });
    expect(result).toBeNull();
    expect(wired!.enabled).toBe(false);
  });

  it('FAILS SAFE to null when the composer throws mid-turn', async () => {
    const warn = vi.fn();
    const explodingDeps = fakeCompositionDeps({
      brainRouter: {
        cascade: async () => {
          throw new Error('router exploded');
        },
        probe: okProbe,
      },
    });
    const wired = wireCognitiveComposer({
      compositionDeps: explodingDeps,
      env: { [COGNITIVE_COMPOSER_FLAG]: '1' },
      logger: { debug: () => undefined, info: () => undefined, warn, error: () => undefined },
    });
    const result = await wired!.runForTurn({
      tenantId: 'tenant-1',
      turnId: 'turn-4',
      userMessage: 'a hard branching capex decision',
      stakes: 'critical',
      surface: 'owner-portal',
    });
    // Never throws into the hot path; returns null so the caller falls
    // back to memory-recall-only enrichment.
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
