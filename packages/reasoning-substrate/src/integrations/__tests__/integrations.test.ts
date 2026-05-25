/**
 * Integration shim tests.
 *
 *   - K-D prefix cache: deterministic prefix bytes; structureId
 *     stability; sorted keys; same input → same bytes.
 *   - K-E constitutional: reflection blob includes the structure +
 *     outputs + final text; relevant primitives detected.
 *   - K-D reflexion: tagged reflections are written with taskClass +
 *     jurisdiction; truncation behaves; rejects missing identifiers.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EVICTION_TZ_DSM_STRUCTURE,
  TENANT_DISPUTE_GLOBAL_STRUCTURE,
} from '../../self-discover/canonical-structures.js';
import {
  buildReasoningPrefix,
  stableStringify,
} from '../kd-prefix-cache.js';
import {
  buildConstitutionalReflection,
  constitutionallyRelevantSteps,
  scoreWithKEConstitutional,
} from '../ke-constitutional.js';
import {
  buildTaggedReflectionText,
  recordTaggedReflection,
} from '../kd-reflexion.js';

describe('K-D prefix-cache shim — buildReasoningPrefix', () => {
  it('produces byte-identical output for the same structure', () => {
    const a = buildReasoningPrefix({ structure: EVICTION_TZ_DSM_STRUCTURE });
    const b = buildReasoningPrefix({ structure: EVICTION_TZ_DSM_STRUCTURE });
    expect(a).toBe(b);
  });

  it('omits the discoveredAt timestamp (would defeat prefix cache)', () => {
    const s1 = { ...EVICTION_TZ_DSM_STRUCTURE, discoveredAt: '2026-01-01T00:00:00.000Z' };
    const s2 = { ...EVICTION_TZ_DSM_STRUCTURE, discoveredAt: '2026-12-31T00:00:00.000Z' };
    const a = buildReasoningPrefix({ structure: s1 });
    const b = buildReasoningPrefix({ structure: s2 });
    expect(a).toBe(b);
  });

  it('changes when structureId changes (cache key correctness)', () => {
    const s1 = { ...EVICTION_TZ_DSM_STRUCTURE, structureId: 'rs_a' };
    const s2 = { ...EVICTION_TZ_DSM_STRUCTURE, structureId: 'rs_b' };
    expect(buildReasoningPrefix({ structure: s1 })).not.toBe(
      buildReasoningPrefix({ structure: s2 }),
    );
  });

  it('places callerVoice at the top, plan-and-solve skeleton at the bottom', () => {
    const out = buildReasoningPrefix({
      structure: EVICTION_TZ_DSM_STRUCTURE,
      callerVoice: 'You are BORJIE MD. Tone: firm.',
    });
    const voiceIdx = out.indexOf('You are BORJIE MD');
    const skelIdx = out.indexOf('Plan-and-Solve+ reasoning protocol');
    expect(voiceIdx).toBe(0);
    expect(skelIdx).toBeGreaterThan(voiceIdx);
  });

  it('stableStringify produces sorted-key JSON', () => {
    const x = stableStringify({ b: 1, a: { z: 2, y: 3 } });
    const expected = JSON.stringify({ a: { y: 3, z: 2 }, b: 1 }, null, 2);
    expect(x).toBe(expected);
  });
});

describe('K-E constitutional shim — buildConstitutionalReflection', () => {
  it('renders the structured plan + step outputs into the text blob', () => {
    const reflection = buildConstitutionalReflection({
      tenantId: 'tenant-42',
      structure: EVICTION_TZ_DSM_STRUCTURE,
      stepOutputs: [
        { stepId: 's4', output: { canEvict: false, rationale: 'mediation clause active' } },
        { stepId: 's10', output: { displayCurrency: 'KES', amount: 130000 } },
      ],
      finalResponse: 'Recommend Notice of Mediation Offer.',
    });
    expect(reflection.tenantId).toBe('tenant-42');
    expect(reflection.intentLabel).toBe('eviction');
    expect(reflection.text).toContain('Task class: eviction');
    expect(reflection.text).toContain('mediation clause active');
    expect(reflection.text).toContain('Notice of Mediation Offer');
  });

  it('clusterId is deterministic given the same finalResponse', () => {
    const args = {
      tenantId: null,
      structure: EVICTION_TZ_DSM_STRUCTURE,
      stepOutputs: [],
      finalResponse: 'same response',
    };
    const a = buildConstitutionalReflection(args);
    const b = buildConstitutionalReflection(args);
    expect(a.clusterId).toBe(b.clusterId);
  });

  it('constitutionallyRelevantSteps picks apply-tz-rental-act + check-mediation-clause', () => {
    const relevant = constitutionallyRelevantSteps(EVICTION_TZ_DSM_STRUCTURE);
    const primitives = relevant.map((s) => s.primitive);
    expect(primitives).toContain('apply-tz-rental-act');
    expect(primitives).toContain('check-mediation-clause');
    expect(primitives).toContain('check-pii-boundary');
    expect(primitives).toContain('check-currency-chain');
  });

  it('scoreWithKEConstitutional forwards reflection to the port', async () => {
    const spy = vi.fn(async (r: { clusterId: string }) => ({
      clusterId: r.clusterId,
      overall: 0.9,
      passed: true,
      scores: [],
    }));
    const verdict = await scoreWithKEConstitutional(
      { score: spy },
      {
        tenantId: 't',
        structure: TENANT_DISPUTE_GLOBAL_STRUCTURE,
        stepOutputs: [],
        finalResponse: 'ok',
      },
    );
    expect(verdict.passed).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('K-D reflexion shim — recordTaggedReflection', () => {
  it('writes a tagged reflection with taskClass + jurisdiction', async () => {
    const writes: unknown[] = [];
    const port = {
      async record(args: unknown) {
        writes.push(args);
        return { id: 'r_1' };
      },
    };
    const result = await recordTaggedReflection(port, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      sessionId: 'sess-1',
      structure: EVICTION_TZ_DSM_STRUCTURE,
      outcome: 'success',
      body: 'Tenant accepted mediation offer.',
      lessons: ['Always check mediation clause first.'],
    });
    expect(result?.id).toBe('r_1');
    expect(writes).toHaveLength(1);
    const w = writes[0] as Record<string, unknown>;
    expect(w.taskClass).toBe('eviction');
    expect(w.jurisdiction).toBe('TZ-DSM');
    expect((w.reflection as string)).toContain('[eviction/TZ-DSM]');
    expect((w.reflection as string)).toContain('Always check mediation clause first.');
  });

  it('returns null when tenantId is missing', async () => {
    const port = { record: async () => ({ id: 'x' }) };
    const result = await recordTaggedReflection(port, {
      tenantId: '',
      userId: 'u',
      sessionId: 's',
      structure: EVICTION_TZ_DSM_STRUCTURE,
      outcome: 'mixed',
      body: 'body',
    });
    expect(result).toBeNull();
  });

  it('returns null when the writer throws', async () => {
    const port = {
      async record() {
        throw new Error('db down');
      },
    };
    const result = await recordTaggedReflection(port, {
      tenantId: 't',
      userId: 'u',
      sessionId: 's',
      structure: EVICTION_TZ_DSM_STRUCTURE,
      outcome: 'failure',
      body: 'body',
    });
    expect(result).toBeNull();
  });

  it('buildTaggedReflectionText truncates beyond 1200 chars', () => {
    const longBody = 'x'.repeat(2000);
    const out = buildTaggedReflectionText({
      structure: EVICTION_TZ_DSM_STRUCTURE,
      outcome: 'mixed',
      body: longBody,
    });
    expect(out.length).toBeLessThanOrEqual(1200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('caps lessons to 3 even if more are supplied', () => {
    const out = buildTaggedReflectionText({
      structure: EVICTION_TZ_DSM_STRUCTURE,
      outcome: 'success',
      body: 'short',
      lessons: ['a', 'b', 'c', 'd', 'e'],
    });
    const matches = out.match(/^- /gm) ?? [];
    expect(matches).toHaveLength(3);
  });
});
