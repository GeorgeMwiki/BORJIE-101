/**
 * @borjie/skill-library/voyager-library — public API.
 *
 * R3 #1 + #3 closure: Voyager-style executable code skill library —
 * accumulated reusable procedures indexed by embedding, composable, no
 * fine-tuning required. Code-skill I/O routed through the J1
 * IEntityStoreService contract (no global state).
 */

export type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
  SkillSituation,
  RetrievedSkill,
  SkillExecutionResult,
  SkillTrace,
} from './types.js';

export {
  RETRIEVAL_THRESHOLD,
  COMPOSITION_THRESHOLD,
  FAILURE_QUARANTINE_LIMIT,
} from './types.js';

export {
  cosineSimilarity,
  successBoost,
  retrieveSkills,
  type RetrievalResult,
} from './retrieval.js';

export { VoyagerSkillLibrary, type VoyagerLibraryOptions } from './library.js';

export {
  validateCompilationRequest,
  EchoSkillCompiler,
  type SkillCompiler,
  type SkillCompilationRequest,
  type CompiledSkillProposal,
} from './compile-from-traces.js';

export {
  StubEntityStore,
  type IEntityStoreService,
  type EntityTypeDescriptor,
  type AttributeWrite,
  type CreateEntityInput,
  type CreateEntityResult,
  type Provenance,
} from './entity-store-port.js';
