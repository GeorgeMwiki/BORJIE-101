import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  curateExamples,
  shapeReward,
} from '../curator/example-curator.js';
import { DEFAULT_REWARD_SHAPING } from '../types.js';
import type {
  ClockPort,
  PIIRedactor,
  RawTrace,
  UuidPort,
} from '../types.js';

const clock: ClockPort = Object.freeze({
  nowIso: () => '2026-05-26T10:00:00.000Z',
  nowMs: () => Date.parse('2026-05-26T10:00:00Z'),
});

function makeUuid(): UuidPort {
  let n = 0;
  return Object.freeze({
    next: () => {
      n += 1;
      return `uuid-${n}`;
    },
  });
}

const identityRedactor: PIIRedactor = Object.freeze({
  redact: (value: unknown) => value,
});

function makeTrace(overrides: Partial<RawTrace>): RawTrace {
  return Object.freeze({
    id: overrides.id ?? 't-1',
    tenantId: overrides.tenantId ?? 'tenant-a',
    capabilityId: overrides.capabilityId ?? 'cap-1',
    prompt: overrides.prompt ?? { q: 'hi' },
    completion: overrides.completion ?? { a: 'hello' },
    baseReward: overrides.baseReward ?? 0.5,
    coverageScore: overrides.coverageScore ?? 0.5,
    confidenceScore: overrides.confidenceScore ?? 0.8,
    redactionPenalty: overrides.redactionPenalty ?? 0.0,
    occurredAt: overrides.occurredAt ?? '2026-05-25T00:00:00Z',
  });
}

describe('canonicalJson', () => {
  it('produces a stable key regardless of key order', () => {
    const a = canonicalJson({ z: 1, a: 2 });
    const b = canonicalJson({ a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it('handles nested arrays + objects + nulls', () => {
    const k = canonicalJson({
      list: [1, 'two', { three: null }],
      missing: undefined,
    });
    expect(k).toBe('{"list":[1,"two",{"three":null}]}');
  });

  it('coerces non-finite numbers to null', () => {
    expect(canonicalJson(NaN)).toBe('null');
    expect(canonicalJson(Infinity)).toBe('null');
  });
});

describe('shapeReward', () => {
  it('applies α/β/γ in the documented formula', () => {
    const trace = makeTrace({
      baseReward: 0.4,
      coverageScore: 0.6,
      redactionPenalty: 0.2,
    });
    const r = shapeReward(trace, DEFAULT_REWARD_SHAPING);
    // 1.0 * 0.4 + 0.5 * 0.6 - 0.5 * 0.2 = 0.4 + 0.3 - 0.1 = 0.6
    expect(r).toBeCloseTo(0.6, 6);
  });

  it('clips above 1.0', () => {
    const trace = makeTrace({
      baseReward: 1,
      coverageScore: 1,
      redactionPenalty: 0,
    });
    expect(shapeReward(trace)).toBe(1);
  });

  it('clips below -1.0', () => {
    const trace = makeTrace({
      baseReward: -1,
      coverageScore: 0,
      redactionPenalty: 1,
    });
    expect(shapeReward(trace)).toBe(-1);
  });
});

describe('curateExamples', () => {
  it('redacts, dedups, and shapes rewards', () => {
    const uuid = makeUuid();
    const traces = [
      makeTrace({ id: 't1', prompt: { q: 'x' }, completion: { a: 'y' } }),
      makeTrace({ id: 't2', prompt: { q: 'x' }, completion: { a: 'y' } }),
      makeTrace({ id: 't3', prompt: { q: 'z' }, completion: { a: 'w' } }),
    ];

    const outcome = curateExamples({
      tenantId: 'tenant-a',
      metaRunId: 'run-1',
      traces,
      redactor: identityRedactor,
      clock,
      uuid,
      auditChain: () => 'hash-deterministic',
    });

    expect(outcome.examples).toHaveLength(2);
    expect(outcome.droppedDuplicates).toBe(1);
    expect(outcome.examples[0]?.tenantId).toBe('tenant-a');
    expect(outcome.examples[0]?.included).toBe(true);
  });

  it('drops examples above the redaction penalty ceiling', () => {
    const uuid = makeUuid();
    const traces = [
      makeTrace({ id: 't1', redactionPenalty: 0.9 }),
      makeTrace({ id: 't2', redactionPenalty: 0.1, prompt: { q: 'y' } }),
    ];
    const outcome = curateExamples({
      tenantId: 'tenant-a',
      metaRunId: 'run-1',
      traces,
      redactor: identityRedactor,
      clock,
      uuid,
      auditChain: () => 'h',
    });
    expect(outcome.droppedHighRedaction).toBe(1);
    expect(outcome.examples).toHaveLength(1);
  });

  it('refuses cross-tenant traces silently', () => {
    const uuid = makeUuid();
    const traces = [
      makeTrace({ id: 't1' }),
      makeTrace({ id: 't2', tenantId: 'tenant-b', prompt: { q: 'q' } }),
    ];
    const outcome = curateExamples({
      tenantId: 'tenant-a',
      metaRunId: 'run-1',
      traces,
      redactor: identityRedactor,
      clock,
      uuid,
      auditChain: () => 'h',
    });
    expect(outcome.examples).toHaveLength(1);
    expect(outcome.examples[0]?.tenantId).toBe('tenant-a');
  });
});
