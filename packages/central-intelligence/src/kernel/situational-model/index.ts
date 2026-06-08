/**
 * `situational-model` — public surface of the standing situational-state organ
 * (Wave 1, organ #2). The resident `EstateMind` Slow Loop WRITES it each tick;
 * the per-request `think(req)` Fast Loop READS it. Activation/salience is a
 * COMPUTED field (ACT-R base-level recency×frequency + spreading).
 *
 * Adapters:
 *   - `createInMemorySituationalModelStore` — volatile fallback (no infra).
 *   - `createBlackboardSituationalModelStore` — persists on the shared-state
 *     spine (`@borjie/blackboard-sota` slots, via a narrow structural port).
 *   - The Drizzle adapter is wired at the composition root (it needs
 *     `@borjie/database`); it implements the same `SituationalModelStore` port.
 */

export {
  SITUATION_ENTITY_KINDS,
  DEFAULT_ACTIVATION_PARAMS,
  entityKeyOf,
  type SituationEntityKind,
  type SituationEntity,
  type SituationEntityKey,
  type ActivatedEntity,
  type SituationalSnapshot,
  type RecordEntityInput,
  type ActivationParams,
  type SituationalModelStore,
} from './types.js';

export {
  baseLevelActivation,
  spreadingActivation,
  activateAll,
  BASE_LEVEL_FLOOR,
} from './activation.js';

export { mergeObservation, parseRecordInput } from './merge.js';

export {
  createSituationalModel,
  type SituationalModel,
  type SituationalModelDeps,
} from './situational-model.js';

export {
  createInMemorySituationalModelStore,
  type InMemorySituationalStoreDeps,
} from './store-inmemory.js';

export {
  createBlackboardSituationalModelStore,
  type BlackboardSituationalStoreDeps,
  type SlotStorePort,
} from './store-blackboard.js';
