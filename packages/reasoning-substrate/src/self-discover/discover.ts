/**
 * discoverReasoningStructure — top-level Self-Discover orchestrator.
 *
 * Pipeline:
 *   1. Cache lookup by (taskClass, jurisdiction).
 *      - hit  → return cached (10-40× cheaper than re-CoT-SC).
 *      - miss → step 2.
 *   2. Build SELECT prompt → DiscovererPort returns chosen primitive ids.
 *   3. Build ADAPT prompt   → DiscovererPort returns adapted narrative.
 *   4. Build IMPLEMENT prompt → DiscovererPort returns JSON steps.
 *   5. Validate the structure (every primitive id resolvable, no DAG
 *      cycles, no unknown depends-on).
 *   6. Store in cache.
 *   7. Return.
 *
 * The DiscovererPort is duck-typed. In production it is backed by an
 * Anthropic Opus 4.7 call wrapped in `createThinkingMessage`. In tests
 * it is an in-memory stub that emits fixtures.
 */

import {
  ALL_PRIMITIVES,
  findPrimitiveById,
  type ReasoningPrimitive,
} from './module-library.js';
import {
  buildAdaptPrompt,
  buildImplementPrompt,
  buildSelectPrompt,
} from './meta-prompts.js';
import {
  REASONING_STRUCTURE_SCHEMA_VERSION,
  type BossnyumbaTaskClass,
  type DiscovererPort,
  type ReasoningStructure,
  type ReasoningStructureCachePort,
  type ReasoningStep,
  type TaskSampleInput,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface DiscoverArgs {
  readonly taskClass: BossnyumbaTaskClass;
  readonly jurisdiction: string;
  readonly samples: ReadonlyArray<TaskSampleInput>;
  readonly cache?: ReasoningStructureCachePort;
  readonly discoverer: DiscovererPort;
  /** Override the default library — useful for tests + ablation. */
  readonly library?: ReadonlyArray<ReasoningPrimitive>;
  /** Caller-supplied clock — defaults to wall clock. */
  readonly clock?: () => Date;
  /** Caller-supplied id generator — defaults to crypto.randomUUID. */
  readonly idGen?: () => string;
}

export interface DiscoverResult {
  readonly structure: ReasoningStructure;
  readonly cacheHit: boolean;
}

export class ReasoningStructureValidationError extends Error {
  override readonly name = 'ReasoningStructureValidationError';
}

export async function discoverReasoningStructure(
  args: DiscoverArgs,
): Promise<DiscoverResult> {
  if (!args.taskClass) {
    throw new Error('discoverReasoningStructure: taskClass is required');
  }
  if (!args.jurisdiction) {
    throw new Error('discoverReasoningStructure: jurisdiction is required');
  }
  if (!args.discoverer) {
    throw new Error('discoverReasoningStructure: discoverer is required');
  }
  const library = args.library ?? ALL_PRIMITIVES;
  const clock = args.clock ?? (() => new Date());
  const idGen = args.idGen ?? defaultIdGen;

  // Cache lookup.
  if (args.cache) {
    try {
      const hit = await args.cache.lookup({
        taskClass: args.taskClass,
        jurisdiction: args.jurisdiction,
      });
      if (hit && hit.schemaVersion === REASONING_STRUCTURE_SCHEMA_VERSION) {
        return { structure: hit, cacheHit: true };
      }
    } catch {
      // Cache side-channel — never fail discovery on cache error.
    }
  }

  const selectPrompt = buildSelectPrompt({
    taskClass: args.taskClass,
    jurisdiction: args.jurisdiction,
    samples: args.samples,
    library,
  });
  const adaptPrompt = buildAdaptPrompt({
    taskClass: args.taskClass,
    jurisdiction: args.jurisdiction,
    samples: args.samples,
    selectedPrimitives: [],
  });
  const implementPrompt = buildImplementPrompt({
    taskClass: args.taskClass,
    jurisdiction: args.jurisdiction,
    adaptedNarrative: '',
    selectedPrimitives: [],
  });

  const out = await args.discoverer.discover({
    taskClass: args.taskClass,
    jurisdiction: args.jurisdiction,
    selectPrompt,
    adaptPrompt,
    implementPrompt,
    library,
    samples: args.samples,
  });

  validateSteps(out.steps, out.selectedPrimitives, library);

  const structure: ReasoningStructure = {
    schemaVersion: REASONING_STRUCTURE_SCHEMA_VERSION,
    taskClass: args.taskClass,
    jurisdiction: args.jurisdiction,
    discoveredAt: clock().toISOString(),
    structureId: idGen(),
    steps: out.steps,
    selectedPrimitives: out.selectedPrimitives,
    adaptedNarrative: out.adaptedNarrative,
  };

  if (args.cache) {
    try {
      await args.cache.store(structure);
    } catch {
      // Cache writes are best-effort.
    }
  }

  return { structure, cacheHit: false };
}

// ─────────────────────────────────────────────────────────────────────
// Validation — surfacing errors here is what stops a malformed
// Claude response from corrupting the cache.
// ─────────────────────────────────────────────────────────────────────

function validateSteps(
  steps: ReadonlyArray<ReasoningStep>,
  selectedPrimitives: ReadonlyArray<string>,
  library: ReadonlyArray<ReasoningPrimitive>,
): void {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new ReasoningStructureValidationError('steps must be a non-empty array');
  }
  const selectedSet = new Set(selectedPrimitives);
  const knownPrimitives = new Set(library.map((p) => p.id));
  // Every selected primitive must be from the library.
  for (const id of selectedPrimitives) {
    if (!knownPrimitives.has(id)) {
      throw new ReasoningStructureValidationError(
        `selected primitive '${id}' not in library`,
      );
    }
  }
  const seenStepIds = new Set<string>();
  for (const step of steps) {
    if (!step.stepId || typeof step.stepId !== 'string') {
      throw new ReasoningStructureValidationError('step missing stepId');
    }
    if (seenStepIds.has(step.stepId)) {
      throw new ReasoningStructureValidationError(`duplicate stepId '${step.stepId}'`);
    }
    seenStepIds.add(step.stepId);
    if (!step.primitive || !findPrimitiveById(step.primitive)) {
      throw new ReasoningStructureValidationError(
        `step '${step.stepId}': unknown primitive '${step.primitive}'`,
      );
    }
    if (!selectedSet.has(step.primitive)) {
      throw new ReasoningStructureValidationError(
        `step '${step.stepId}': primitive '${step.primitive}' was not in SELECT output`,
      );
    }
    // depends_on must reference only PRIOR step ids — enforces DAG.
    for (const dep of step.dependsOn) {
      if (!seenStepIds.has(dep) || dep === step.stepId) {
        throw new ReasoningStructureValidationError(
          `step '${step.stepId}': dependsOn '${dep}' is forward-referencing or self`,
        );
      }
    }
  }
}

function defaultIdGen(): string {
  // crypto.randomUUID is available in Node 19+. Fallback for ancient
  // runtimes is irrelevant here — BORJIE requires Node >= 20.
  return `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
