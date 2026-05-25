/**
 * `@borjie/knowledge-graph` — public barrel.
 *
 * Headline consumer:
 *
 *   const kg = createKnowledgeGraph({
 *     store: createInMemoryStore(),
 *     embedder: createMockGraphEmbedder({ dimension: 64 }),
 *     brain: myBrainPort,
 *     ontology: realEstateOntology,
 *   });
 *
 *   await kg.upsertProperty({ id, name, tenantId, ... });
 *   const ans = await kg.ask({ question: "Which tenants in Karen are
 *     2+ months in arrears?", tenantId });
 */

// Types
export * from './types.js';

// Ontology
export {
  realEstateOntology,
  extendOntology,
  validateOntology,
} from './ontology/index.js';

// Store
export {
  createInMemoryStore,
  type InMemoryStoreOptions,
  createKuzuAdapter,
  createNeo4jAdapter,
  type KuzuAdapterOptions,
  type Neo4jAdapterOptions,
} from './store/index.js';

// Embeddings
export {
  createMockGraphEmbedder,
  createTextGraphEmbedder,
  cosineSimilarity,
  findRelevant,
  type TextEmbedder,
  type FindRelevantArgs,
} from './embeddings/index.js';

// GraphRAG
export {
  expandFromSeed,
  detectCommunities,
  summarizeCommunity,
  answerWithKG,
  type ExpandFromSeedArgs,
  type AnswerWithKGArgs,
} from './graphrag/index.js';

// Temporal
export {
  getStateAt,
  compareStates,
  type CompareStatesArgs,
} from './temporal/index.js';

// Provenance
export {
  attachProvenance,
  validateProvenance,
  hasProvenance,
  type ProvenanceValidation,
} from './provenance/index.js';

// Visualization spec builders
export {
  forceGraphSpec,
  cytoscapeSpec,
  sigmaSpec,
  chordSpec,
  sankeySpec,
  treeMapSpec,
  type ClassColorMap,
} from './viz/index.js';

// Headline factory
export { createKnowledgeGraph, type CreateKnowledgeGraphArgs } from './factory.js';
