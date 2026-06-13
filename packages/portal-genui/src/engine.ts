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
import {
  applyTabPatch,
  type PortalTabPatch,
  type ApplyTabPatchResult,
  type ApplyTabPatchOptions,
} from './patch/index.js';
import type { PortalTab, TabGenerationIntent } from './types.js';
import {
  assertSpecUrlsAllowed,
  type UrlEgressPolicy,
} from './security/url-egress.js';
import { sealAuditChain } from './audit/audit-chain.js';

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
  /**
   * Render-egress URL allowlist. When supplied, every tab routed through
   * `persist`/`patch` is walked for URL-typed values and rejected
   * (`PortalGenUiEgressError`) if any fails the policy — the membrane that
   * stops a poisoned spec from smuggling an attacker URL the renderer would
   * auto-fetch. Injected by the composition root so the package stays
   * `process.env`-free. When omitted, no egress check runs (test/stub mode).
   */
  readonly urlEgressPolicy?: UrlEgressPolicy;
}

/** Input for the incremental-patch path (the MD edits a live surface). */
export interface PatchTabInput {
  /** The patch to apply. `patch.tabId` selects the target tab. */
  readonly patch: PortalTabPatch;
  /** Audit / clock options forwarded to the reducer. */
  readonly options: ApplyTabPatchOptions;
  /**
   * When true (default) the patched tab is persisted on success. Pass
   * `false` to compute a preview without writing (proposal-chip flow).
   */
  readonly persist?: boolean;
}

export interface GenUIEngine {
  detectIntent(input: DetectTabIntentInput): Promise<TabGenerationIntent | null>;
  generate(input: GenerateTabInput): Promise<GenerateTabResult>;
  persist(input: SaveTabInput): Promise<SaveTabResult>;
  list(input: ListTabsInput): Promise<ReadonlyArray<PortalTab>>;
  get(id: string): Promise<PortalTab | null>;
  delete(input: DeleteTabInput): Promise<{ deleted: boolean }>;
  /**
   * Apply an A2UI-style incremental patch to a persisted tab. Fetches the
   * target tab, applies the patch immutably (re-validating the result),
   * and (when `persist !== false`) writes it back. Returns the reducer
   * result; a `tab-not-found` reason means `patch.tabId` had no row.
   */
  patch(input: PatchTabInput): Promise<ApplyTabPatchResult>;
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
  const egressPolicy = deps.urlEgressPolicy;

  /**
   * Persist chokepoint: seal the audit chain (tamper-evident, append-only) and
   * screen every URL against the egress policy before a tab can be stored.
   * Returns the sealed tab so the stored record always carries chain hashes.
   */
  const guardForPersist = (tab: SaveTabInput['tab']): SaveTabInput['tab'] => {
    const sealed = { ...tab, audit: sealAuditChain(tab.audit) };
    if (egressPolicy) assertSpecUrlsAllowed(sealed, egressPolicy);
    return sealed;
  };

  return {
    detectIntent: (input) => detectTabGenerationIntent(input, detectorDeps),
    generate: (input) => generator.generate(input),
    persist: async (input) => {
      const tab = guardForPersist(input.tab);
      return persistence.save({ ...input, tab });
    },
    list: (input) => persistence.list(input),
    get: (id) => persistence.get(id),
    delete: (input) => persistence.delete(input),
    async patch(input): Promise<ApplyTabPatchResult> {
      const target = await persistence.get(input.patch.tabId);
      if (!target) {
        return {
          ok: false,
          reason: 'tab-not-found',
          message: `tab '${input.patch.tabId}' not found`,
          opIndex: -1,
        };
      }
      const result = applyTabPatch(target, input.patch, input.options);
      if (result.ok && input.persist !== false) {
        const tab = guardForPersist(result.tab);
        await persistence.save({ tab, parentTabId: target.id });
      }
      return result;
    },
    generator,
    persistence,
  };
}
