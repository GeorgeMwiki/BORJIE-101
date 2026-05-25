/**
 * `GenUIEngine` — the top-level facade that composes the intent
 * detector, schema generator, and persistence layer into a single
 * dependency the kernel + the API gateway routes consume.
 *
 * Construction is straightforward; the composition root supplies the
 * brain + persistence implementations:
 *
 *   const engine = createGenUIEngine({
 *     brain: makeBrainPortFromSynthesizer(synthesizer),
 *     persistence: createDrizzleTabRegistry({ db }),
 *   });
 *
 *   if (await engine.detectIntent({ message })) {
 *     const result = await engine.generate({ intent, tenantId, userId });
 *     await engine.persist({ tab: result.tab });
 *   }
 */

import {
  detectTabGenerationIntent,
  type BrainPort as IntentBrainPort,
  type DetectorDeps,
  type DetectTabIntentInput,
} from './intent/index.js';
import {
  createTabGenerator,
  type GeneratorBrainPort,
  type GeneratorDeps,
  type GenerateTabInput,
  type GenerateTabResult,
  type TabGenerator,
} from './generator/index.js';
import {
  createInMemoryTabRegistry,
  type TabRegistry,
  type SaveTabInput,
  type SaveTabResult,
  type ListTabsInput,
  type DeleteTabInput,
} from './persistence/index.js';
import type { PortalTab, TabGenerationIntent } from './types.js';

export interface GenUIEngineBrainPort {
  /** Intent classification call — `text` is JSON. */
  classify: IntentBrainPort['classify'];
  /** Generation call — `text` is a JSON PortalTab. */
  generate: GeneratorBrainPort['generate'];
}

export interface CreateGenUIEngineDeps {
  readonly brain?: GenUIEngineBrainPort;
  readonly persistence?: TabRegistry;
  readonly detector?: Omit<DetectorDeps, 'brain'>;
  readonly generator?: Omit<GeneratorDeps, 'brain'>;
}

export interface GenUIEngine {
  detectIntent(input: DetectTabIntentInput): Promise<TabGenerationIntent | null>;
  generate(input: GenerateTabInput): Promise<GenerateTabResult>;
  persist(input: SaveTabInput): Promise<SaveTabResult>;
  list(input: ListTabsInput): Promise<ReadonlyArray<PortalTab>>;
  get(id: string): Promise<PortalTab | null>;
  delete(input: DeleteTabInput): Promise<{ deleted: boolean }>;
  /** Direct access to the constructed generator (advanced use). */
  readonly generator: TabGenerator;
  /** Direct access to the persistence layer (advanced use). */
  readonly persistence: TabRegistry;
}

/**
 * Compose the engine. Every dep is optional — when nothing is wired,
 * the engine works in "stub" mode using heuristic-only intent
 * detection, the deterministic fallback generator, and an in-memory
 * registry. That mode is what the unit tests exercise.
 */
export function createGenUIEngine(
  deps: CreateGenUIEngineDeps = {},
): GenUIEngine {
  const intentBrain: IntentBrainPort | undefined = deps.brain
    ? { classify: deps.brain.classify.bind(deps.brain) }
    : undefined;
  const generatorBrain: GeneratorBrainPort | undefined = deps.brain
    ? { generate: deps.brain.generate.bind(deps.brain) }
    : undefined;

  const detectorDeps: DetectorDeps = {
    ...(deps.detector ?? {}),
    ...(intentBrain !== undefined ? { brain: intentBrain } : {}),
  };
  const generatorDeps: GeneratorDeps = {
    ...(deps.generator ?? {}),
    ...(generatorBrain !== undefined ? { brain: generatorBrain } : {}),
  };

  const generator = createTabGenerator(generatorDeps);
  const persistence = deps.persistence ?? createInMemoryTabRegistry();

  return {
    detectIntent: (input) => detectTabGenerationIntent(input, detectorDeps),
    generate: (input) => generator.generate(input),
    persist: (input) => persistence.save(input),
    list: (input) => persistence.list(input),
    get: (id) => persistence.get(id),
    delete: (input) => persistence.delete(input),
    generator,
    persistence,
  };
}
