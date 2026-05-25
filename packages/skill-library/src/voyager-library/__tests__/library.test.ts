import { describe, expect, it } from 'vitest';
import {
  VoyagerSkillLibrary,
  cosineSimilarity,
  retrieveSkills,
  successBoost,
  RETRIEVAL_THRESHOLD,
  FAILURE_QUARANTINE_LIMIT,
  EchoSkillCompiler,
  StubEntityStore,
  type CodeSkill,
  type SkillSituation,
  type SerializableFunction,
} from '../index.js';

function mkSkill<TInput = unknown, TOutput = unknown>(
  id: string,
  description: string,
  emb: ReadonlyArray<number>,
  opts: Partial<CodeSkill<TInput, TOutput>> = {}
): Omit<CodeSkill<TInput, TOutput>, 'success_count' | 'failure_count' | 'consecutive_failures' | 'quarantined'> {
  const fn: SerializableFunction<TInput, TOutput> = {
    source: '',
    input_schema: { type: 'object' },
    output_schema: { type: 'object' },
    run: async (_ctx, input) => ({ echoed: input }) as unknown as TOutput,
  };
  return {
    id,
    name: id,
    description,
    embedding: emb,
    jurisdiction: 'platform',
    code: fn,
    ...opts,
  };
}

const v1 = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const v2 = [0.95, 0.05, 0, 0, 0, 0, 0, 0, 0, 0];
const v3 = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0];

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors (mapped from [-1,1] to [0,1])', () => {
    expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 5);
  });

  it('returns 0.5 for orthogonal vectors', () => {
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for an empty pair', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for length-mismatch', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it('handles a zero vector without NaN', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('successBoost', () => {
  it('rewards skills with high success ratio', () => {
    expect(successBoost(10, 0)).toBeGreaterThan(successBoost(0, 0));
  });

  it('caps at 0.1', () => {
    expect(successBoost(1_000_000, 0)).toBeLessThanOrEqual(0.1);
  });

  it('returns 0 for a skill with no usage (Laplace smoothing)', () => {
    expect(successBoost(0, 0)).toBe(0);
  });
});

describe('retrieveSkills', () => {
  it('returns retrieve-list when situation matches above threshold', () => {
    const lib: ReadonlyArray<CodeSkill> = [
      { ...mkSkill('a', 'handles X', v1), success_count: 0, failure_count: 0, consecutive_failures: 0, quarantined: false },
    ];
    const sit: SkillSituation = {
      description: 'X happened',
      embedding: v1,
      jurisdiction: 'KE',
      tenant_id: 't1',
    };
    const r = retrieveSkills(lib, sit);
    expect(r.retrieve).toHaveLength(1);
    expect(r.retrieve[0]?.score).toBeGreaterThan(RETRIEVAL_THRESHOLD);
  });

  it('filters by jurisdiction — only platform OR matching tenant jurisdiction', () => {
    const lib: ReadonlyArray<CodeSkill> = [
      {
        ...mkSkill('ke-only', 'desc', v1, { jurisdiction: 'KE' }),
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        quarantined: false,
      },
      {
        ...mkSkill('tz-only', 'desc', v1, { jurisdiction: 'TZ' }),
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        quarantined: false,
      },
      {
        ...mkSkill('platform', 'desc', v1),
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        quarantined: false,
      },
    ];
    const sit: SkillSituation = {
      description: 'X',
      embedding: v1,
      jurisdiction: 'KE',
      tenant_id: 't',
    };
    const r = retrieveSkills(lib, sit);
    const ids = r.retrieve.map((x) => x.skill.id);
    expect(ids).toContain('ke-only');
    expect(ids).toContain('platform');
    expect(ids).not.toContain('tz-only');
  });

  it('excludes quarantined skills entirely', () => {
    const lib: ReadonlyArray<CodeSkill> = [
      {
        ...mkSkill('quar', 'desc', v1),
        success_count: 0,
        failure_count: 5,
        consecutive_failures: 5,
        quarantined: true,
      },
    ];
    const sit: SkillSituation = {
      description: 'X',
      embedding: v1,
      jurisdiction: 'KE',
      tenant_id: 't',
    };
    const r = retrieveSkills(lib, sit);
    expect(r.retrieve).toHaveLength(0);
    expect(r.top_3).toHaveLength(0);
  });

  it('returns top_3 even if all below retrieval threshold', () => {
    const lib: ReadonlyArray<CodeSkill> = [
      {
        ...mkSkill('weak', 'desc', v3),
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        quarantined: false,
      },
    ];
    const sit: SkillSituation = {
      description: 'X',
      embedding: v1,
      jurisdiction: 'KE',
      tenant_id: 't',
    };
    const r = retrieveSkills(lib, sit);
    expect(r.retrieve).toHaveLength(0);
    expect(r.top_3.length).toBe(1);
  });

  it('successful skills outrank cold ones on a tie', () => {
    const lib: ReadonlyArray<CodeSkill> = [
      {
        ...mkSkill('cold', 'desc', v1),
        success_count: 0,
        failure_count: 0,
        consecutive_failures: 0,
        quarantined: false,
      },
      {
        ...mkSkill('hot', 'desc', v1),
        success_count: 100,
        failure_count: 1,
        consecutive_failures: 0,
        quarantined: false,
      },
    ];
    const sit: SkillSituation = {
      description: 'X',
      embedding: v1,
      jurisdiction: 'KE',
      tenant_id: 't',
    };
    const r = retrieveSkills(lib, sit);
    expect(r.top_3[0]?.skill.id).toBe('hot');
  });
});

describe('VoyagerSkillLibrary — register/get/retrieve', () => {
  it('registers and retrieves a skill', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    expect(lib.get('x')?.id).toBe('x');
    expect(lib.size()).toBe(1);
  });

  it('rejects double registration of same id', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    expect(() => lib.register(mkSkill('x', 'desc2', v1))).toThrow(/already registered/);
  });

  it('all() returns all skills', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('a', 'd1', v1));
    lib.register(mkSkill('b', 'd2', v3));
    expect(lib.all().map((s) => s.id).sort()).toEqual(['a', 'b']);
  });
});

describe('VoyagerSkillLibrary — recordOutcome + quarantine', () => {
  it('increments success_count on ok and resets consecutive_failures', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    lib.recordOutcome('x', 'ok');
    expect(lib.get('x')?.success_count).toBe(1);
    expect(lib.get('x')?.consecutive_failures).toBe(0);
  });

  it('increments failure_count + consecutive_failures on error', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    lib.recordOutcome('x', 'error');
    expect(lib.get('x')?.failure_count).toBe(1);
    expect(lib.get('x')?.consecutive_failures).toBe(1);
  });

  it('auto-quarantines after FAILURE_QUARANTINE_LIMIT consecutive failures', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    for (let i = 0; i < FAILURE_QUARANTINE_LIMIT; i++) lib.recordOutcome('x', 'error');
    expect(lib.get('x')?.quarantined).toBe(true);
  });

  it('does NOT quarantine before threshold', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    for (let i = 0; i < FAILURE_QUARANTINE_LIMIT - 1; i++)
      lib.recordOutcome('x', 'error');
    expect(lib.get('x')?.quarantined).toBe(false);
  });

  it('a successful run resets consecutive_failures', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    lib.recordOutcome('x', 'error');
    lib.recordOutcome('x', 'error');
    lib.recordOutcome('x', 'ok');
    expect(lib.get('x')?.consecutive_failures).toBe(0);
    expect(lib.get('x')?.failure_count).toBe(2);
    expect(lib.get('x')?.success_count).toBe(1);
  });

  it('unquarantine resets quarantine flag + consecutive', () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('x', 'desc', v1));
    for (let i = 0; i < FAILURE_QUARANTINE_LIMIT; i++) lib.recordOutcome('x', 'error');
    lib.unquarantine('x');
    expect(lib.get('x')?.quarantined).toBe(false);
    expect(lib.get('x')?.consecutive_failures).toBe(0);
  });

  it('records last_used_at on every outcome', () => {
    const fixed = new Date('2026-05-19T10:00:00Z');
    const lib = new VoyagerSkillLibrary({ now: () => fixed });
    lib.register(mkSkill('x', 'desc', v1));
    lib.recordOutcome('x', 'ok');
    expect(lib.get('x')?.last_used_at).toBe('2026-05-19T10:00:00.000Z');
  });
});

describe('VoyagerSkillLibrary — executeFirstMatch', () => {
  it('executes the top match and records a success', async () => {
    const lib = new VoyagerSkillLibrary({ now: () => new Date('2026-05-19T00:00:00Z') });
    lib.register(mkSkill<{ key: string }, { echoed: { key: string } }>('x', 'desc', v1));
    const store = new StubEntityStore();
    const result = await lib.executeFirstMatch<{ key: string }, { echoed: { key: string } }>({
      situation: {
        description: 'fits x',
        embedding: v1,
        jurisdiction: 'platform',
        tenant_id: 't',
      },
      input: { key: 'val' },
      entity_store: store,
      correlation_id: 'c1',
    });
    expect(result.status).toBe('ok');
    expect(result.output?.echoed.key).toBe('val');
    expect(lib.get('x')?.success_count).toBe(1);
  });

  it('returns no_match when nothing crosses the threshold', async () => {
    const lib = new VoyagerSkillLibrary();
    lib.register(mkSkill('weak', 'desc', v3));
    const r = await lib.executeFirstMatch({
      situation: {
        description: 'mismatch',
        embedding: v1,
        jurisdiction: 'platform',
        tenant_id: 't',
      },
      input: {},
      entity_store: new StubEntityStore(),
      correlation_id: 'c',
    });
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('no_match');
    expect(r.error?.message).toContain('weak');
  });

  it('records failure when the skill code throws', async () => {
    const failingFn: SerializableFunction = {
      source: '',
      input_schema: {},
      output_schema: {},
      run: async () => {
        throw new Error('skill blew up');
      },
    };
    const failing = {
      id: 'fail',
      name: 'fail',
      description: 'always fails',
      embedding: v1,
      jurisdiction: 'platform' as const,
      code: failingFn,
    };
    const lib = new VoyagerSkillLibrary();
    lib.register(failing);
    const r = await lib.executeFirstMatch({
      situation: {
        description: 's',
        embedding: v1,
        jurisdiction: 'platform',
        tenant_id: 't',
      },
      input: {},
      entity_store: new StubEntityStore(),
      correlation_id: 'c',
    });
    expect(r.status).toBe('error');
    expect(r.error?.code).toBe('execution_failed');
    expect(r.error?.message).toContain('skill blew up');
    expect(lib.get('fail')?.failure_count).toBe(1);
  });

  it('3 consecutive throwing runs quarantine the skill', async () => {
    const failingFn: SerializableFunction = {
      source: '',
      input_schema: {},
      output_schema: {},
      run: async () => {
        throw new Error('boom');
      },
    };
    const failing = {
      id: 'fail3',
      name: 'fail3',
      description: 'flaky',
      embedding: v1,
      jurisdiction: 'platform' as const,
      code: failingFn,
    };
    const lib = new VoyagerSkillLibrary();
    lib.register(failing);
    const sit = {
      description: 's',
      embedding: v1,
      jurisdiction: 'platform',
      tenant_id: 't',
    };
    for (let i = 0; i < FAILURE_QUARANTINE_LIMIT; i++) {
      await lib.executeFirstMatch({
        situation: sit,
        input: {},
        entity_store: new StubEntityStore(),
        correlation_id: `c${i}`,
      });
    }
    expect(lib.get('fail3')?.quarantined).toBe(true);
    // 4th attempt: quarantined -> retrieve returns nothing -> no_match.
    const r = await lib.executeFirstMatch({
      situation: sit,
      input: {},
      entity_store: new StubEntityStore(),
      correlation_id: 'final',
    });
    expect(r.error?.code).toBe('no_match');
  });
});

describe('EchoSkillCompiler — learn by example', () => {
  it('rejects invalid proposed_id', async () => {
    const c = new EchoSkillCompiler();
    await expect(
      c.compile({
        description: 'd',
        traces: [{ input: 1, expected_output: 1 }],
        proposed_id: 'INVALID NAME',
        jurisdiction: 'platform',
        description_embedding: v1,
      })
    ).rejects.toThrow(/proposed_id/);
  });

  it('rejects zero traces', async () => {
    const c = new EchoSkillCompiler();
    await expect(
      c.compile({
        description: 'd',
        traces: [],
        proposed_id: 'x',
        jurisdiction: 'platform',
        description_embedding: v1,
      })
    ).rejects.toThrow(/1-3 examples/);
  });

  it('rejects > 3 traces', async () => {
    const c = new EchoSkillCompiler();
    const traces = Array.from({ length: 4 }, () => ({ input: 1, expected_output: 1 }));
    await expect(
      c.compile({
        description: 'd',
        traces,
        proposed_id: 'x',
        jurisdiction: 'platform',
        description_embedding: v1,
      })
    ).rejects.toThrow(/1-3 examples/);
  });

  it('produces a proposal with the supplied id, description, embedding, jurisdiction', async () => {
    const c = new EchoSkillCompiler();
    const p = await c.compile({
      description: 'echo skill',
      traces: [{ input: { a: 1 }, expected_output: { echoed: { a: 1 } } }],
      proposed_id: 'echo-skill',
      jurisdiction: 'platform',
      description_embedding: v1,
    });
    expect(p.skill.id).toBe('echo-skill');
    expect(p.skill.description).toBe('echo skill');
    expect(p.skill.jurisdiction).toBe('platform');
    expect(p.skill.embedding).toEqual(v1);
  });
});
