/**
 * loop-spec — validation + factory tests for the CognitiveLoop primitive.
 */

import { describe, it, expect } from 'vitest';
import {
  defineLoopSpec,
  parseLoopSpec,
  InvalidLoopSpecError,
  LoopSpecDataSchema,
  LOOP_AUTONOMY_TIERS,
  type LoopContext,
} from '../loop-spec.js';

const ctx = (over: Partial<LoopContext> = {}): LoopContext =>
  Object.freeze({ nowMs: 1_000, ports: {}, ...over });

const base = {
  id: 'loop:test',
  title: 'Test loop',
  trigger: { kind: 'tick', everyMs: 1000 } as const,
  actPort: 'host.act',
  learnPort: 'host.learn',
  createdAtMs: 0,
};

describe('defineLoopSpec', () => {
  it('builds a frozen spec with safe inert defaults for the optional hooks', () => {
    const spec = defineLoopSpec(base);
    expect(Object.isFrozen(spec)).toBe(true);
    // Default predicate never fires; default decide is observe-only.
    expect(spec.evaluate(ctx())).toBe(false);
    expect(spec.decide(ctx())).toBeNull();
    expect(spec.retireCondition(ctx())).toBe(false);
    // Defaults: efficacy null, tier T1 (propose), origin builtin, empty bindings.
    expect(spec.efficacy).toBeNull();
    expect(spec.autonomyTier).toBe('T1');
    expect(spec.origin).toBe('builtin');
    expect(spec.organBindings).toEqual([]);
  });

  it('preserves provided pure hooks + serialisable facets', () => {
    const spec = defineLoopSpec({
      ...base,
      organBindings: ['snapshotPort'],
      efficacy: 0.5,
      autonomyTier: 'T0',
      origin: 'formed',
      evaluate: (c) => c.nowMs > 500,
      decide: () => ({
        actPort: 'host.act',
        autonomyTier: 'T0',
        summary: 'go',
        args: { x: 1 },
      }),
      retireCondition: (c) => c.nowMs > 10_000,
    });
    expect(spec.evaluate(ctx({ nowMs: 600 }))).toBe(true);
    expect(spec.evaluate(ctx({ nowMs: 400 }))).toBe(false);
    expect(spec.decide(ctx())).toMatchObject({ actPort: 'host.act', summary: 'go' });
    expect(spec.retireCondition(ctx({ nowMs: 20_000 }))).toBe(true);
    expect(spec.efficacy).toBe(0.5);
    expect(spec.origin).toBe('formed');
    expect(spec.organBindings).toEqual(['snapshotPort']);
  });

  it('accepts an event trigger', () => {
    const spec = defineLoopSpec({
      ...base,
      trigger: { kind: 'event', eventType: 'ledger.posted' },
    });
    expect(spec.trigger).toEqual({ kind: 'event', eventType: 'ledger.posted' });
  });

  it('throws InvalidLoopSpecError on a malformed tick cadence', () => {
    expect(() =>
      defineLoopSpec({ ...base, trigger: { kind: 'tick', everyMs: 0 } }),
    ).toThrow(InvalidLoopSpecError);
    expect(() =>
      defineLoopSpec({ ...base, trigger: { kind: 'tick', everyMs: -5 } }),
    ).toThrow(InvalidLoopSpecError);
  });

  it('throws InvalidLoopSpecError on an out-of-range efficacy', () => {
    expect(() => defineLoopSpec({ ...base, efficacy: 1.5 })).toThrow(
      InvalidLoopSpecError,
    );
    expect(() => defineLoopSpec({ ...base, efficacy: -0.1 })).toThrow(
      InvalidLoopSpecError,
    );
  });

  it('throws InvalidLoopSpecError on empty id / title / ports', () => {
    expect(() => defineLoopSpec({ ...base, id: '' })).toThrow(InvalidLoopSpecError);
    expect(() => defineLoopSpec({ ...base, title: '' })).toThrow(
      InvalidLoopSpecError,
    );
    expect(() => defineLoopSpec({ ...base, actPort: '' })).toThrow(
      InvalidLoopSpecError,
    );
    expect(() => defineLoopSpec({ ...base, learnPort: '' })).toThrow(
      InvalidLoopSpecError,
    );
  });

  it('exposes the canonical four-tier autonomy ladder', () => {
    expect([...LOOP_AUTONOMY_TIERS]).toEqual(['T0', 'T1', 'T2', 'T3']);
  });
});

describe('parseLoopSpec (untrusted / formed specs)', () => {
  it('returns ok:true + a spec for a valid input (honest-degrade form)', () => {
    const res = parseLoopSpec({ ...base, origin: 'formed' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.id).toBe('loop:test');
      expect(res.spec.origin).toBe('formed');
    }
  });

  it('returns ok:false + issues for a malformed input — never throws', () => {
    const res = parseLoopSpec({ ...base, trigger: { kind: 'tick', everyMs: -1 } });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('LoopSpecDataSchema (persistence guard)', () => {
  it('validates the serialisable projection of a defined loop', () => {
    const spec = defineLoopSpec(base);
    const data = {
      id: spec.id,
      title: spec.title,
      trigger: spec.trigger,
      organBindings: spec.organBindings,
      actPort: spec.actPort,
      learnPort: spec.learnPort,
      efficacy: spec.efficacy,
      autonomyTier: spec.autonomyTier,
      createdAtMs: spec.createdAtMs,
      origin: spec.origin,
    };
    expect(LoopSpecDataSchema.safeParse(data).success).toBe(true);
  });
});
