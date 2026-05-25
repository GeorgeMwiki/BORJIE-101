/**
 * Self-Discover tests.
 *
 *   - Module library shape (exactly 39 universal + 6 BORJIE = 45).
 *   - 8 task-class structures discovered through a stub DiscovererPort.
 *   - Cache-hit verification: second discovery reads from cache,
 *     DiscovererPort is NOT called.
 *   - Cache-invalidation: stale schemaVersion entries are evicted and
 *     a re-discovery triggers DiscovererPort.
 *   - Validation: malformed responses throw
 *     ReasoningStructureValidationError.
 *   - Seed structures are valid against the validator.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ALL_PRIMITIVES,
  BORJIE_PRIMITIVES,
  UNIVERSAL_PRIMITIVES,
  findPrimitiveById,
  primitiveCounts,
} from '../module-library.js';
import {
  ReasoningStructureValidationError,
  discoverReasoningStructure,
} from '../discover.js';
import { createInMemoryReasoningStructureCache } from '../in-memory-cache.js';
import {
  EVICTION_TZ_DSM_STRUCTURE,
  SEED_STRUCTURES,
  TENANT_DISPUTE_GLOBAL_STRUCTURE,
} from '../canonical-structures.js';
import {
  REASONING_STRUCTURE_SCHEMA_VERSION,
  type DiscovererPort,
  type ReasoningStep,
  type ReasoningStructure,
} from '../types.js';
import { FIXTURES } from './fixtures.js';

function stubDiscoverer(
  emit: (taskClass: string) => {
    selectedPrimitives: ReadonlyArray<string>;
    adaptedNarrative: string;
    steps: ReadonlyArray<ReasoningStep>;
  },
): DiscovererPort & { calls: number } {
  let calls = 0;
  const port: DiscovererPort = {
    async discover(args) {
      calls += 1;
      return emit(args.taskClass);
    },
  };
  return Object.assign(port, {
    get calls() {
      return calls;
    },
  } as { calls: number });
}

describe('module-library — 39 + 6 = 45 primitives', () => {
  it('has exactly 39 universal primitives', () => {
    expect(UNIVERSAL_PRIMITIVES).toHaveLength(39);
  });
  it('has exactly 6 BORJIE domain primitives', () => {
    expect(BORJIE_PRIMITIVES).toHaveLength(6);
  });
  it('total = 45', () => {
    expect(ALL_PRIMITIVES).toHaveLength(45);
    expect(primitiveCounts().total).toBe(45);
  });
  it('every primitive id is unique', () => {
    const ids = new Set(ALL_PRIMITIVES.map((p) => p.id));
    expect(ids.size).toBe(ALL_PRIMITIVES.length);
  });
  it('every primitive id is resolvable via findPrimitiveById', () => {
    for (const p of ALL_PRIMITIVES) {
      expect(findPrimitiveById(p.id)?.id).toBe(p.id);
    }
  });
  it('returns undefined for unknown ids', () => {
    expect(findPrimitiveById('not-a-real-primitive')).toBeUndefined();
  });
});

describe('discoverReasoningStructure — 8 task-class fixtures', () => {
  for (const fixture of FIXTURES) {
    it(`fixture '${fixture.id}' produces a valid structure`, async () => {
      const discoverer = stubDiscoverer(() => ({
        selectedPrimitives: fixture.expectedPrimitives,
        adaptedNarrative: `Adapted narrative for ${fixture.id}.`,
        steps: fixture.expectedPrimitives.map((primitive, i) => ({
          stepId: `s${i + 1}`,
          primitive,
          dependsOn: i === 0 ? [] : [`s${i}`],
          outputSchema: { value: 'unknown' },
          narrative: `Step ${i + 1} — ${primitive}`,
        })),
      }));
      const cache = createInMemoryReasoningStructureCache();
      const { structure, cacheHit } = await discoverReasoningStructure({
        taskClass: fixture.taskClass,
        jurisdiction: fixture.jurisdiction,
        samples: fixture.samples,
        cache,
        discoverer,
      });
      expect(cacheHit).toBe(false);
      expect(structure.taskClass).toBe(fixture.taskClass);
      expect(structure.jurisdiction).toBe(fixture.jurisdiction);
      expect(structure.schemaVersion).toBe(REASONING_STRUCTURE_SCHEMA_VERSION);
      expect(structure.steps.length).toBeGreaterThanOrEqual(fixture.expectedMinSteps);
      expect(structure.selectedPrimitives).toEqual(fixture.expectedPrimitives);
      // The structure was stored in cache.
      const cached = await cache.lookup({
        taskClass: fixture.taskClass,
        jurisdiction: fixture.jurisdiction,
      });
      expect(cached?.structureId).toBe(structure.structureId);
    });
  }
});

describe('discoverReasoningStructure — cache behaviour', () => {
  const fixture = FIXTURES[0]!; // eviction-tz-dsm

  function makeStubResponse() {
    return {
      selectedPrimitives: fixture.expectedPrimitives,
      adaptedNarrative: 'Adapted',
      steps: fixture.expectedPrimitives.map((primitive, i) => ({
        stepId: `s${i + 1}`,
        primitive,
        dependsOn: i === 0 ? [] : [`s${i}`],
        outputSchema: { value: 'unknown' },
        narrative: `Step ${i + 1}`,
      })),
    };
  }

  it('second call with same (task, jurisdiction) hits cache and DOES NOT call discoverer', async () => {
    const discoverSpy = vi.fn(async () => makeStubResponse());
    const port: DiscovererPort = { discover: discoverSpy };
    const cache = createInMemoryReasoningStructureCache();
    const first = await discoverReasoningStructure({
      taskClass: fixture.taskClass,
      jurisdiction: fixture.jurisdiction,
      samples: fixture.samples,
      cache,
      discoverer: port,
    });
    expect(first.cacheHit).toBe(false);
    expect(discoverSpy).toHaveBeenCalledTimes(1);

    const second = await discoverReasoningStructure({
      taskClass: fixture.taskClass,
      jurisdiction: fixture.jurisdiction,
      samples: fixture.samples,
      cache,
      discoverer: port,
    });
    expect(second.cacheHit).toBe(true);
    expect(second.structure.structureId).toBe(first.structure.structureId);
    // Discoverer NOT called a second time.
    expect(discoverSpy).toHaveBeenCalledTimes(1);
  });

  it('different jurisdiction does NOT hit cache', async () => {
    const discoverSpy = vi.fn(async () => makeStubResponse());
    const port: DiscovererPort = { discover: discoverSpy };
    const cache = createInMemoryReasoningStructureCache();
    await discoverReasoningStructure({
      taskClass: 'eviction',
      jurisdiction: 'TZ-DSM',
      samples: fixture.samples,
      cache,
      discoverer: port,
    });
    await discoverReasoningStructure({
      taskClass: 'eviction',
      jurisdiction: 'KE-NRB',
      samples: fixture.samples,
      cache,
      discoverer: port,
    });
    expect(discoverSpy).toHaveBeenCalledTimes(2);
  });

  it('invalidateStaleSchemaVersions removes structures from older schemaVersions', async () => {
    const cache = createInMemoryReasoningStructureCache();
    // Manually seed a stale entry from an older schemaVersion.
    const stale: ReasoningStructure = {
      ...EVICTION_TZ_DSM_STRUCTURE,
      schemaVersion: REASONING_STRUCTURE_SCHEMA_VERSION - 1,
      jurisdiction: 'TZ-DSM',
    };
    cache._entries.set('eviction::TZ-DSM', stale);
    const fresh: ReasoningStructure = {
      ...TENANT_DISPUTE_GLOBAL_STRUCTURE,
      jurisdiction: 'GLOBAL',
    };
    cache._entries.set('tenant-dispute::GLOBAL', fresh);

    const removed = await cache.invalidateStaleSchemaVersions(
      REASONING_STRUCTURE_SCHEMA_VERSION,
    );
    expect(removed).toBe(1);
    expect(cache._entries.has('eviction::TZ-DSM')).toBe(false);
    expect(cache._entries.has('tenant-dispute::GLOBAL')).toBe(true);
  });

  it('cache lookup returns null when stored entry has stale schemaVersion', async () => {
    const cache = createInMemoryReasoningStructureCache();
    const stale: ReasoningStructure = {
      ...EVICTION_TZ_DSM_STRUCTURE,
      schemaVersion: REASONING_STRUCTURE_SCHEMA_VERSION - 1,
    };
    cache._entries.set('eviction::TZ-DSM', stale);
    const hit = await cache.lookup({ taskClass: 'eviction', jurisdiction: 'TZ-DSM' });
    expect(hit).toBeNull();
  });

  it('cache failure does not break discovery — falls through to discoverer', async () => {
    const failingCache = {
      async lookup() {
        throw new Error('cache down');
      },
      async store() {
        throw new Error('cache down');
      },
      async invalidateStaleSchemaVersions() {
        throw new Error('cache down');
      },
    };
    const discoverSpy = vi.fn(async () => makeStubResponse());
    const port: DiscovererPort = { discover: discoverSpy };
    const result = await discoverReasoningStructure({
      taskClass: 'eviction',
      jurisdiction: 'TZ-DSM',
      samples: fixture.samples,
      cache: failingCache,
      discoverer: port,
    });
    expect(result.cacheHit).toBe(false);
    expect(discoverSpy).toHaveBeenCalledTimes(1);
  });
});

describe('discoverReasoningStructure — validation', () => {
  const baseDiscoverer = (overrides: Partial<{
    selectedPrimitives: ReadonlyArray<string>;
    steps: ReadonlyArray<ReasoningStep>;
  }>): DiscovererPort => ({
    async discover() {
      return {
        selectedPrimitives: overrides.selectedPrimitives ?? ['apply-formula'],
        adaptedNarrative: '',
        steps: overrides.steps ?? [
          {
            stepId: 's1',
            primitive: 'apply-formula',
            dependsOn: [],
            outputSchema: { v: 'number' },
            narrative: 'compute',
          },
        ],
      };
    },
  });

  it('throws when a selected primitive is not in the library', async () => {
    await expect(
      discoverReasoningStructure({
        taskClass: 'rent-proration',
        jurisdiction: 'GLOBAL',
        samples: [],
        discoverer: baseDiscoverer({
          selectedPrimitives: ['not-a-real-primitive'],
          steps: [
            {
              stepId: 's1',
              primitive: 'not-a-real-primitive',
              dependsOn: [],
              outputSchema: {},
              narrative: '',
            },
          ],
        }),
      }),
    ).rejects.toThrow(ReasoningStructureValidationError);
  });

  it('throws on duplicate stepIds', async () => {
    await expect(
      discoverReasoningStructure({
        taskClass: 'rent-proration',
        jurisdiction: 'GLOBAL',
        samples: [],
        discoverer: baseDiscoverer({
          selectedPrimitives: ['apply-formula'],
          steps: [
            { stepId: 's1', primitive: 'apply-formula', dependsOn: [], outputSchema: {}, narrative: '' },
            { stepId: 's1', primitive: 'apply-formula', dependsOn: [], outputSchema: {}, narrative: '' },
          ],
        }),
      }),
    ).rejects.toThrow(/duplicate stepId/);
  });

  it('throws on forward-referencing dependsOn (DAG violation)', async () => {
    await expect(
      discoverReasoningStructure({
        taskClass: 'rent-proration',
        jurisdiction: 'GLOBAL',
        samples: [],
        discoverer: baseDiscoverer({
          selectedPrimitives: ['apply-formula', 'check-output-format'],
          steps: [
            { stepId: 's1', primitive: 'apply-formula', dependsOn: ['s2'], outputSchema: {}, narrative: '' },
            { stepId: 's2', primitive: 'check-output-format', dependsOn: [], outputSchema: {}, narrative: '' },
          ],
        }),
      }),
    ).rejects.toThrow(/forward-referencing/);
  });

  it('throws on self-dependency', async () => {
    await expect(
      discoverReasoningStructure({
        taskClass: 'rent-proration',
        jurisdiction: 'GLOBAL',
        samples: [],
        discoverer: baseDiscoverer({
          selectedPrimitives: ['apply-formula'],
          steps: [
            { stepId: 's1', primitive: 'apply-formula', dependsOn: ['s1'], outputSchema: {}, narrative: '' },
          ],
        }),
      }),
    ).rejects.toThrow(/forward-referencing or self/);
  });

  it('throws when step.primitive was not in SELECT output', async () => {
    await expect(
      discoverReasoningStructure({
        taskClass: 'rent-proration',
        jurisdiction: 'GLOBAL',
        samples: [],
        discoverer: baseDiscoverer({
          selectedPrimitives: ['apply-formula'],
          steps: [
            { stepId: 's1', primitive: 'critical-thinking', dependsOn: [], outputSchema: {}, narrative: '' },
          ],
        }),
      }),
    ).rejects.toThrow(/was not in SELECT output/);
  });
});

describe('seed structures — must pass validator + cache round-trip', () => {
  for (const seed of SEED_STRUCTURES) {
    it(`seed '${seed.structureId}' validates and survives cache round-trip`, async () => {
      const cache = createInMemoryReasoningStructureCache();
      await cache.store(seed);
      const round = await cache.lookup({
        taskClass: seed.taskClass,
        jurisdiction: seed.jurisdiction,
      });
      expect(round?.structureId).toBe(seed.structureId);
      // Validate by feeding through a stub discoverer that returns the seed.
      const port: DiscovererPort = {
        async discover() {
          return {
            selectedPrimitives: seed.selectedPrimitives,
            adaptedNarrative: seed.adaptedNarrative,
            steps: seed.steps,
          };
        },
      };
      const freshCache = createInMemoryReasoningStructureCache();
      const { structure } = await discoverReasoningStructure({
        taskClass: seed.taskClass,
        jurisdiction: seed.jurisdiction,
        samples: [],
        cache: freshCache,
        discoverer: port,
      });
      expect(structure.steps).toHaveLength(seed.steps.length);
    });
  }

  it('EVICTION_TZ_DSM_STRUCTURE includes all the critical primitives the L1 audit calls out', () => {
    expect(EVICTION_TZ_DSM_STRUCTURE.selectedPrimitives).toContain('apply-tz-rental-act');
    expect(EVICTION_TZ_DSM_STRUCTURE.selectedPrimitives).toContain('check-mediation-clause');
    expect(EVICTION_TZ_DSM_STRUCTURE.selectedPrimitives).toContain('check-pii-boundary');
    expect(EVICTION_TZ_DSM_STRUCTURE.selectedPrimitives).toContain('check-currency-chain');
  });
});
